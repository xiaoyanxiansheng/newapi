package model

import (
	"errors"
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

type UpstreamAccount struct {
	BalancePageURL   string                   `json:"balance_page_url" gorm:"type:text"`
	BalanceCNY       string                   `json:"balance_cny" gorm:"type:varchar(48)"`
	BalanceReadTime  int64                    `json:"balance_read_time" gorm:"bigint"`
	BalanceIssue     string                   `json:"balance_issue" gorm:"type:varchar(32)"`
	Disabled         bool                     `json:"disabled"`
	Id               int                      `json:"id"`
	Name             string                   `json:"name" gorm:"type:varchar(255)"`
	Website          string                   `json:"website" gorm:"type:text"`
	KeyPageURL       string                   `json:"key_page_url" gorm:"type:text"`
	Username         string                   `json:"username" gorm:"type:varchar(255)"`
	Password         string                   `json:"-" gorm:"type:text"`
	AuthType         string                   `json:"auth_type" gorm:"type:varchar(32)"`
	BrowserSession   string                   `json:"-" gorm:"type:text"`
	BrowserDiscovery UpstreamDiscoveryStorage `json:"-"`
	DiscoveryRecipe  string                   `json:"discovery_recipe,omitempty" gorm:"type:text"`
	DiscoveryMode    string                   `json:"discovery_mode,omitempty" gorm:"type:varchar(32)"`
	DiscoveryTime    int64                    `json:"discovery_time,omitempty" gorm:"bigint"`
	RemoteUserId     int                      `json:"remote_user_id"`
	HasSession       bool                     `json:"has_session" gorm:"-"`
	Markup           string                   `json:"markup" gorm:"type:varchar(48)"`
	Revision         int64                    `json:"revision" gorm:"bigint"`
	LastSync         int64                    `json:"last_sync" gorm:"bigint"`
	LastError        string                   `json:"last_error" gorm:"type:text"`
	Workflow         string                   `json:"workflow" gorm:"type:varchar(64)"`
	CreatedTime      int64                    `json:"created_time" gorm:"bigint"`
}

type UpstreamDiscoveryStorage string

func (UpstreamDiscoveryStorage) GormDataType() string { return "text" }
func (UpstreamDiscoveryStorage) GormDBDataType(db *gorm.DB, _ *schema.Field) string {
	if db.Dialector.Name() == "mysql" {
		return "longtext"
	}
	return "text"
}

type UpstreamKeyMetadata struct {
	RouteSelectionChanged bool `json:"-"`
	UsedCNY               string
	RemoteId              int
	Name                  string
	Masked                string
	Group                 string
	Status                int
	ModelsJSON            string
	ExpiresAt             int64
	Issue                 string
}

// SaveUpstreamBrowserAuthorization accepts a site session only after the
// service has verified its identity. Renewing a pinned identity preserves price
// snapshots and existing listings, relay Keys, and selling prices.
func SaveUpstreamBrowserAuthorization(account UpstreamAccount, sealedSession string, remoteID int, username, email string) error {
	if sealedSession == "" || remoteID <= 0 {
		return errors.New("invalid upstream browser authorization")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var current UpstreamAccount
		if err := lockForUpdate(tx).First(&current, account.Id).Error; err != nil {
			return err
		}
		if current.Revision != account.Revision {
			return errors.New("account changed; reload before saving")
		}
		if current.RemoteUserId > 0 && current.RemoteUserId != remoteID {
			return errors.New("browser authorization belongs to a different upstream account")
		}
		identityMatches := current.Username != "" && (current.Username == username || current.Username == email)
		if current.RemoteUserId == 0 && !identityMatches {
			var count int64
			if err := tx.Model(&UpstreamSource{}).Where("account_id = ?", current.Id).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return errors.New("browser authorization belongs to a different upstream account")
			}
		}
		renewal := current.RemoteUserId == remoteID
		if current.Username == "" {
			current.Username = username
		}
		result := tx.Model(&current).Where("revision = ?", account.Revision).Updates(map[string]any{
			"browser_session": sealedSession, "remote_user_id": remoteID, "auth_type": "browser",
			"browser_discovery": "", "discovery_recipe": "", "discovery_mode": "", "discovery_time": 0,
			"username": current.Username,
			"password": "", "last_error": "", "revision": account.Revision + 1,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("account changed; reload before saving")
		}
		if renewal {
			return nil
		}
		return tx.Model(&UpstreamSource{}).Where("account_id = ?", current.Id).Updates(map[string]any{
			"latest_time": 0, "revision": gorm.Expr("revision + 1"),
		}).Error
	})
}

// Metadata sync never creates or edits Keys at the upstream website.
func SyncUpstreamKeys(account UpstreamAccount, keys []UpstreamKeyMetadata) error {
	err := DB.Transaction(func(tx *gorm.DB) error {
		return syncUpstreamKeys(tx, account, keys, true)
	})
	if err == nil {
		InitChannelCache()
		InvalidateMarketListings()
	}
	return err
}

func syncUpstreamKeys(tx *gorm.DB, account UpstreamAccount, keys []UpstreamKeyMetadata, complete bool) error {
	var current UpstreamAccount
	if err := lockForUpdate(tx).First(&current, account.Id).Error; err != nil {
		return err
	}
	if current.Revision != account.Revision {
		return errors.New("upstream account changed; reload before refreshing Keys")
	}
	var sources []UpstreamSource
	if err := tx.Where("account_id = ?", account.Id).Find(&sources).Error; err != nil {
		return err
	}
	byId := map[int]UpstreamSource{}
	for _, s := range sources {
		byId[s.RemoteKeyId] = s
	}
	seen := map[int]bool{}
	for _, key := range keys {
		if err := ValidateUpstreamCNY(key.UsedCNY, false); err != nil {
			return err
		}
		if key.RemoteId <= 0 || seen[key.RemoteId] {
			return errors.New("invalid or duplicate upstream Key identity")
		}
		seen[key.RemoteId] = true
		s, exists := byId[key.RemoteId]
		if !exists {
			s = UpstreamSource{AccountId: account.Id, RemoteKeyId: key.RemoteId, Name: key.Name, BaseURL: account.Website, Adapter: "account", PriceGroup: key.Group, Markup: account.Markup, PurchaseMultiplier: "1", KeyMasked: key.Masked, KeyStatus: key.Status, AllowedModelsJSON: key.ModelsJSON, KeyExpiresAt: key.ExpiresAt, KeyIssue: key.Issue, CreatedTime: common.GetTimestamp(), KeyUsedCNY: key.UsedCNY}
			if key.UsedCNY != "" {
				s.KeyUsageReadTime = common.GetTimestamp()
			}
			if err := tx.Create(&s).Error; err != nil {
				return err
			}
			continue
		}
		permissionsChanged := s.AllowedModelsJSON != key.ModelsJSON
		changed := key.RouteSelectionChanged || s.PriceGroup != key.Group || permissionsChanged || s.KeyStatus != key.Status || s.KeyMissing || s.KeyExpiresAt != key.ExpiresAt || s.KeyIssue != key.Issue || s.KeyMasked != key.Masked
		updates := map[string]any{"name": key.Name, "key_masked": key.Masked, "price_group": key.Group, "key_status": key.Status, "allowed_models_json": key.ModelsJSON, "key_missing": false, "key_expires_at": key.ExpiresAt, "key_issue": key.Issue, "revision": s.Revision + 1}
		if key.UsedCNY != "" {
			updates["key_used_cny"] = key.UsedCNY
			updates["key_usage_read_time"] = common.GetTimestamp()
		}
		if changed {
			updates["latest_time"] = 0
		}
		result := tx.Model(&s).Where("revision = ?", s.Revision).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("Key changed while refreshing the account; retry")
		}
		if key.Status != 1 || key.Issue != "" || (key.ExpiresAt > 0 && key.ExpiresAt <= common.GetTimestamp()) || current.Disabled || s.Disabled {
			if err := pauseUpstreamSource(tx, s, nil); err != nil {
				return err
			}
		} else if permissionsChanged && key.ModelsJSON != "null" && key.ModelsJSON != "" {
			var names []string
			if err := common.UnmarshalJsonStr(key.ModelsJSON, &names); err != nil {
				return err
			}
			allowed := upstreamAllowedModels(names)
			if err := pauseUpstreamSource(tx, s, allowed); err != nil {
				return err
			}
		}
	}
	missing := []UpstreamSource{}
	for _, s := range sources {
		if complete && !seen[s.RemoteKeyId] {
			missing = append(missing, s)
		}
	}
	if err := DeleteUpstreamSourcesTx(tx, missing); err != nil {
		return err
	}
	// Removing saved Key material may advance this transaction's account
	// revision. The initial lock/revision check already excluded stale readers.
	if err := tx.Select("id", "revision").First(&current, account.Id).Error; err != nil {
		return err
	}
	result := tx.Model(&current).Where("revision = ?", current.Revision).Updates(map[string]any{"revision": current.Revision + 1, "last_sync": common.GetTimestamp(), "last_error": ""})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("account changed; refresh again")
	}
	return nil
}

// Browser snapshots and metadata are saved together. Partial page reads never
// remove unseen Keys, listings, or prices. A recipe contains no credentials.
func SaveUpstreamBrowserDiscovery(account UpstreamAccount, sealed, recipe, mode string, remoteID int, username, email string, keys []UpstreamKeyMetadata, complete bool) error {
	err := DB.Transaction(func(tx *gorm.DB) error {
		var current UpstreamAccount
		if err := lockForUpdate(tx).First(&current, account.Id).Error; err != nil {
			return err
		}
		if current.Revision != account.Revision {
			return errors.New("account changed; reload before saving")
		}
		if current.RemoteUserId > 0 && current.RemoteUserId != remoteID {
			return errors.New("browser authorization belongs to a different upstream account")
		}
		if current.RemoteUserId == 0 && current.Username != "" && username != "" && current.Username != username && current.Username != email {
			var count int64
			if err := tx.Model(&UpstreamSource{}).Where("account_id = ?", current.Id).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return errors.New("browser authorization belongs to a different upstream account")
			}
		}
		if current.Username == "" {
			current.Username = username
		}
		updates := map[string]any{"browser_discovery": sealed, "discovery_recipe": recipe, "discovery_mode": mode, "discovery_time": common.GetTimestamp(), "key_page_url": account.KeyPageURL, "auth_type": "browser", "username": current.Username, "remote_user_id": remoteID, "password": "", "last_error": "", "revision": current.Revision + 1}
		if account.BalanceCNY != "" {
			updates["balance_cny"] = account.BalanceCNY
			updates["balance_read_time"] = common.GetTimestamp()
			updates["balance_issue"] = ""
		} else if account.BalanceIssue != "" {
			updates["balance_issue"] = account.BalanceIssue
		}
		if err := tx.Model(&current).Where("revision = ?", current.Revision).Updates(updates).Error; err != nil {
			return err
		}
		current.Revision = account.Revision + 1
		return syncUpstreamKeys(tx, current, keys, complete)
	})
	if err == nil {
		InitChannelCache()
		InvalidateMarketListings()
	}
	return err
}

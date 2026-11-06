package model

import (
	"errors"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type UpstreamSource struct {
	PricingMode           string `json:"pricing_mode,omitempty" gorm:"type:varchar(32)"`
	KeyUsedCNY            string `json:"key_used_cny" gorm:"type:varchar(48)"`
	KeyUsageReadTime      int64  `json:"key_usage_read_time" gorm:"bigint"`
	Disabled              bool   `json:"disabled"`
	AccountDisabled       bool   `json:"account_disabled" gorm:"-"`
	PreviousChannelStatus int    `json:"-"`
	AccountId             int    `json:"account_id" gorm:"index"`
	RemoteKeyId           int    `json:"remote_key_id"`
	KeyMasked             string `json:"key_masked" gorm:"type:varchar(128)"`
	KeyStatus             int    `json:"key_status"`
	KeyMissing            bool   `json:"key_missing"`
	KeyIssue              string `json:"key_issue" gorm:"type:text"`
	KeyExpiresAt          int64  `json:"key_expires_at" gorm:"bigint"`
	AllowedModelsJSON     string `json:"-" gorm:"type:text"`
	Id                    int    `json:"id"`
	Name                  string `json:"name" gorm:"type:varchar(255)"`
	BaseURL               string `json:"base_url" gorm:"type:text"`
	CatalogURL            string `json:"catalog_url" gorm:"type:text"`
	Adapter               string `json:"adapter" gorm:"type:varchar(32)"`
	PriceGroup            string `json:"price_group" gorm:"type:varchar(64)"`
	PurchaseMultiplier    string `json:"purchase_multiplier" gorm:"type:varchar(48)"`
	Markup                string `json:"markup" gorm:"type:varchar(48)"`
	CatalogKey            string `json:"-" gorm:"type:text"`
	RelayKey              string `json:"-" gorm:"type:text"`
	ChannelId             int    `json:"channel_id"`
	Revision              int64  `json:"revision" gorm:"bigint"`
	LatestJSON            string `json:"-" gorm:"type:text"`
	LatestTime            int64  `json:"latest_time" gorm:"bigint"`
	LastError             string `json:"last_error" gorm:"type:text"`
	CreatedTime           int64  `json:"created_time" gorm:"bigint"`
}
type UpstreamReview struct {
	Id             int    `json:"id"`
	SourceId       int    `json:"source_id" gorm:"uniqueIndex:idx_upstream_review,priority:1"`
	ModelName      string `json:"model_name" gorm:"type:varchar(255);uniqueIndex:idx_upstream_review,priority:2"`
	QuoteJSON      string `json:"-" gorm:"type:text"`
	Reviewed       bool   `json:"reviewed"`
	Missing        bool   `json:"missing"`
	ListingId      int    `json:"listing_id"`
	MarkupOverride string `json:"markup_override" gorm:"type:varchar(48)"`
	AppliedMarkup  string `json:"applied_markup" gorm:"type:varchar(48)"`
	ReviewedMarkup string `json:"reviewed_markup" gorm:"type:varchar(48)"`
}
type UpstreamRefresh struct {
	Id           int    `json:"id"`
	SourceId     int    `json:"source_id" gorm:"index"`
	Revision     int64  `json:"revision" gorm:"bigint"`
	SnapshotJSON string `json:"-" gorm:"type:text"`
	CreatedTime  int64  `json:"created_time" gorm:"bigint"`
}

func NormalizeUpstreamCatalog(quotes []UpstreamQuote) ([]UpstreamQuote, error) {
	if len(quotes) > 10000 {
		return nil, errors.New("catalog exceeds 10000 models")
	}
	seen := map[string]bool{}
	for i := range quotes {
		q := &quotes[i]
		q.Model = strings.TrimSpace(q.Model)
		if err := q.Validate(); err != nil {
			return nil, err
		}
		if seen[q.Model] {
			return nil, errors.New("duplicate model identifier")
		}
		seen[q.Model] = true
		if q.PriceIssue != "" {
			q.Original = UpstreamPrices{}
			q.Cost = UpstreamPrices{}
			q.BillingExpr = ""
			q.CostExpr = ""
			continue
		}
		var err error
		one, _ := ParseUpstreamAmount("1")
		q.Original, err = q.Original.Scale(one)
		if err != nil {
			return nil, err
		}
		q.Cost, err = q.Cost.Scale(one)
		if err != nil {
			return nil, err
		}
	}
	sort.Slice(quotes, func(i, j int) bool { return quotes[i].Model < quotes[j].Model })
	return quotes, nil
}

func SaveUpstreamSnapshot(id int, revision int64, quotes []UpstreamQuote) error {
	return SaveUpstreamKeySnapshot(id, revision, quotes, "")
}

func SaveUpstreamKeySnapshot(id int, revision int64, quotes []UpstreamQuote, encryptedKey string) error {
	quotes, err := NormalizeUpstreamCatalog(quotes)
	if err != nil {
		return err
	}
	data, err := common.Marshal(quotes)
	if err != nil {
		return err
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var source UpstreamSource
		if err := lockForUpdate(tx).First(&source, id).Error; err != nil {
			return err
		}
		if source.Revision != revision {
			return errors.New("source changed; reload before refreshing")
		}
		now := common.GetTimestamp()
		updates := map[string]any{"revision": revision + 1, "latest_json": string(data), "latest_time": now, "last_error": ""}
		pricingMode := ""
		if len(quotes) == 0 && source.PricingMode == "model_routes" {
			pricingMode = "model_routes"
		}
		for _, quote := range quotes {
			if quote.PricingMode == "model_routes" {
				pricingMode = "model_routes"
				break
			}
		}
		updates["pricing_mode"] = pricingMode
		if encryptedKey != "" {
			updates["relay_key"] = encryptedKey
		}
		result := tx.Model(&source).Where("revision = ?", revision).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("source changed; refresh again")
		}
		for _, q := range quotes {
			encoded, err := common.Marshal(q)
			if err != nil {
				return err
			}
			review := UpstreamReview{SourceId: id, ModelName: q.Model, QuoteJSON: string(encoded)}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&review).Error; err != nil {
				return err
			}
		}
		return tx.Create(&UpstreamRefresh{SourceId: id, Revision: revision + 1, SnapshotJSON: string(data), CreatedTime: now}).Error
	})
}

type UpstreamProposal struct {
	BillingMode         string         `json:"billing_mode,omitempty"`
	BillingExpr         string         `json:"billing_expr,omitempty"`
	OriginalExpr        string         `json:"original_expr,omitempty"`
	CostExpr            string         `json:"cost_expr,omitempty"`
	CurrentBillingMode  string         `json:"current_billing_mode,omitempty"`
	CurrentBillingExpr  string         `json:"current_billing_expr,omitempty"`
	CurrentOriginalExpr string         `json:"current_original_expr,omitempty"`
	DisplayCurrency     string         `json:"display_currency,omitempty"`
	Model               string         `json:"model"`
	Markup              string         `json:"markup"`
	MarkupOverride      string         `json:"markup_override"`
	Original            UpstreamPrices `json:"original"`
	Cost                UpstreamPrices `json:"cost"`
	Sale                UpstreamPrices `json:"sale"`
	Unit                string         `json:"unit"`
	Ratio               float64        `json:"ratio"`
	ListingId           int            `json:"listing_id"`
	CurrentRatio        float64        `json:"current_ratio"`
	Enabled             bool           `json:"enabled"`
	Issue               string         `json:"issue,omitempty"`
}

// Only an explicitly reviewed selection changes live channel models/listings.
func ApplyUpstreamSelection(id int, revision int64, proposals []UpstreamProposal) error {
	if len(proposals) == 0 || len(proposals) > 500 {
		return errors.New("select between 1 and 500 models")
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var s UpstreamSource
		if err := lockForUpdate(tx).First(&s, id).Error; err != nil {
			return err
		}
		if s.Revision != revision {
			return errors.New("catalog changed; review the latest prices again")
		}
		if err := EnsureUpstreamPublishingEnabled(tx, s); err != nil {
			return err
		}
		if (s.AccountId > 0 || s.Adapter == "direct-key") && (s.KeyMissing || s.KeyStatus != 1 || s.KeyIssue != "" || s.LatestTime == 0 || s.LastError != "" || (s.KeyExpiresAt > 0 && s.KeyExpiresAt <= common.GetTimestamp())) {
			return errors.New("this upstream Key is unavailable or needs a model refresh before publishing")
		}
		var quotes []UpstreamQuote
		if err := common.UnmarshalJsonStr(s.LatestJSON, &quotes); err != nil {
			return err
		}
		catalog := map[string]UpstreamQuote{}
		for _, q := range quotes {
			catalog[q.Model] = q
		}
		var ch Channel
		if s.ChannelId == 0 {
			if s.RelayKey == "" || s.BaseURL == "" {
				return errors.New("provide a relay API key or link an existing channel first")
			}
			relayKey := s.RelayKey
			if s.AccountId > 0 || s.Adapter == "direct-key" {
				var err error
				relayKey, err = common.OpenUpstreamSecret(s.RelayKey)
				if err != nil {
					return err
				}
				if s.AccountId > 0 && !strings.HasPrefix(relayKey, "sk-") {
					relayKey = "sk-" + relayKey
				}
			}
			ch = Channel{Type: 1, Name: s.Name, Key: relayKey, BaseURL: &s.BaseURL, Group: "default", Status: common.ChannelStatusEnabled, CreatedTime: common.GetTimestamp()}
			if err := tx.Create(&ch).Error; err != nil {
				return err
			}
			s.ChannelId = ch.Id
		} else {
			if err := lockForUpdate(tx).First(&ch, s.ChannelId).Error; err != nil {
				return err
			}
			if strings.TrimRight(ch.GetBaseURL(), "/") != strings.TrimRight(s.BaseURL, "/") {
				return errors.New("linked channel API base URL differs from this source")
			}
		}
		models := ch.GetModels()
		present := map[string]bool{}
		for _, m := range models {
			present[m] = true
		}
		now := common.GetTimestamp()
		seen := map[string]bool{}
		for _, p := range proposals {
			q, ok := catalog[p.Model]
			if !ok || seen[p.Model] || p.Issue != "" || p.Ratio <= 0 {
				return errors.New("selection contains an unavailable or unverified model")
			}
			if err := q.Validate(); err != nil {
				return err
			}
			if p.BillingMode == "tiered_expr" {
				m, err := ParseUpstreamMarkup(p.Markup)
				if err != nil {
					return err
				}
				expected, err := billingexpr.ScalePrices(q.CostExpr, m.String())
				if err != nil {
					return err
				}
				if p.Ratio != 1 || p.BillingExpr != expected || p.OriginalExpr != q.BillingExpr || p.CostExpr != q.CostExpr {
					return errors.New("dynamic selling contract changed; preview prices again")
				}
			} else if p.BillingMode == "fixed_expr" || p.BillingMode == "fixed_request" {
				if q.BillingMode == "tiered_expr" || q.PriceIssue != "" {
					return errors.New("selection contains an unavailable or unverified model")
				}
				m, err := ParseUpstreamMarkup(p.Markup)
				if err != nil {
					return err
				}
				sale, err := q.Cost.Scale(m)
				if err != nil {
					return err
				}
				mode, expected, err := sale.FixedBillingContract(q.Unit)
				if err != nil {
					return err
				}
				_, original, err := q.Original.FixedBillingContract(q.Unit)
				if err != nil {
					return err
				}
				if mode != p.BillingMode || p.Ratio != 1 || p.BillingExpr != expected || p.OriginalExpr != original || p.Original != q.Original || p.Sale != sale {
					return errors.New("selling contract changed; preview prices again")
				}
			} else if q.BillingMode == "tiered_expr" {
				return errors.New("dynamic pricing cannot be published as static pricing")
			}
			seen[p.Model] = true
			var review UpstreamReview
			if err := lockForUpdate(tx).Where("source_id = ? AND model_name = ?", id, p.Model).First(&review).Error; err != nil {
				return err
			}
			var l MarketListing
			err := lockForUpdate(tx).Where("channel_id = ? AND model_name = ?", ch.Id, p.Model).First(&l).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if l.Id != p.ListingId || (l.Id > 0 && (l.Ratio != p.CurrentRatio || l.Enabled != p.Enabled || l.BillingMode != p.CurrentBillingMode || l.BillingExpr != p.CurrentBillingExpr || l.OriginalBillingExpr != p.CurrentOriginalExpr)) {
				return errors.New("listing changed; preview prices again")
			}
			if l.Id == 0 {
				description := q.GroupDescription
				if description == "" {
					description = q.Description
				}
				l = MarketListing{BillingMode: p.BillingMode, BillingExpr: p.BillingExpr, OriginalBillingExpr: p.OriginalExpr, ChannelId: ch.Id, ModelName: p.Model, Ratio: p.Ratio, Enabled: true, Description: description, CreatedTime: now, UpdatedTime: now, ListedAt: now}
				if err := tx.Create(&l).Error; err != nil {
					return err
				}
			} else {
				updates := map[string]any{"ratio": p.Ratio, "billing_mode": p.BillingMode, "billing_expr": p.BillingExpr, "original_billing_expr": p.OriginalExpr, "updated_time": now, "listed_at": gorm.Expr("CASE WHEN listed_at = 0 THEN ? ELSE listed_at END", now)}
				if l.Description == "" {
					updates["description"] = q.GroupDescription
					if q.GroupDescription == "" {
						updates["description"] = q.Description
					}
				}
				if err := tx.Model(&l).Updates(updates).Error; err != nil {
					return err
				}
			}
			encoded, err := common.Marshal(q)
			if err != nil {
				return err
			}
			if err := tx.Model(&review).Updates(map[string]any{"quote_json": string(encoded), "reviewed": true, "missing": false, "listing_id": l.Id, "markup_override": p.MarkupOverride, "applied_markup": p.Markup, "reviewed_markup": p.Markup}).Error; err != nil {
				return err
			}
			if !present[p.Model] {
				models = append(models, p.Model)
				present[p.Model] = true
			}
		}
		ch.Models = strings.Join(models, ",")
		updates := map[string]any{"models": ch.Models}
		if s.AccountId > 0 || s.Adapter == "direct-key" {
			relayKey, err := common.OpenUpstreamSecret(s.RelayKey)
			if err != nil {
				return err
			}
			updates["key"] = relayKey
		}
		if err := tx.Model(&ch).Updates(updates).Error; err != nil {
			return err
		}
		if err := ch.AddAbilities(tx); err != nil {
			return err
		}
		result := tx.Model(&s).Where("revision = ?", revision).Updates(map[string]any{"channel_id": ch.Id, "revision": revision + 1})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("source changed; review again")
		}
		return nil
	})
	if err == nil {
		InitChannelCache()
		InvalidateMarketListings()
	}
	return err
}

func ReviewUpstreamModels(id int, revision int64, names []string, pause bool) error {
	if len(names) == 0 || len(names) > 500 {
		return errors.New("select between 1 and 500 models")
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var s UpstreamSource
		if err := lockForUpdate(tx).First(&s, id).Error; err != nil {
			return err
		}
		if s.Revision != revision {
			return errors.New("catalog changed; reload before reviewing")
		}
		var quotes []UpstreamQuote
		if err := common.UnmarshalJsonStr(s.LatestJSON, &quotes); err != nil {
			return err
		}
		latest := map[string]UpstreamQuote{}
		for _, q := range quotes {
			latest[q.Model] = q
		}
		for _, name := range names {
			var r UpstreamReview
			if err := tx.Where("source_id = ? AND model_name = ?", id, name).First(&r).Error; err != nil {
				return err
			}
			updates := map[string]any{"reviewed": true, "missing": true}
			markup := s.Markup
			if r.MarkupOverride != "" {
				markup = r.MarkupOverride
			}
			updates["reviewed_markup"] = markup
			if q, ok := latest[name]; ok {
				data, err := common.Marshal(q)
				if err != nil {
					return err
				}
				updates["quote_json"] = string(data)
				updates["missing"] = false
			}
			if pause && s.ChannelId > 0 {
				if err := tx.Model(&MarketListing{}).Where("channel_id = ? AND model_name = ?", s.ChannelId, name).Updates(map[string]any{"enabled": false, "updated_time": common.GetTimestamp()}).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(&r).Updates(updates).Error; err != nil {
				return err
			}
		}
		result := tx.Model(&s).Where("revision = ?", revision).Update("revision", revision+1)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("source changed; reload")
		}
		return nil
	})
	if err == nil && pause {
		InvalidateMarketListings()
	}
	return err
}

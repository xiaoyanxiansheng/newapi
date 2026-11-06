package model

import (
	"errors"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// MarketListing prices one (channel, model) pair. A listing is only routable
// when it is enabled and has a positive ratio.
type MarketListing struct {
	BillingMode             string  `json:"billing_mode,omitempty"`
	BillingExpr             string  `json:"billing_expr,omitempty" gorm:"type:text"`
	OriginalBillingExpr     string  `json:"original_billing_expr,omitempty" gorm:"type:text"`
	Id                      int     `json:"id"`
	ChannelId               int     `json:"channel_id" gorm:"not null;uniqueIndex:idx_market_channel_model,priority:1"`
	ModelName               string  `json:"model_name" gorm:"type:varchar(255);not null;uniqueIndex:idx_market_channel_model,priority:2;index"`
	Ratio                   float64 `json:"ratio"`
	Enabled                 bool    `json:"enabled"`
	DefaultSuccess          bool    `json:"default_success"`
	ProbeEndpoint           string  `json:"probe_endpoint" gorm:"type:varchar(64)"`
	ProbeRequiresClaudeCode bool    `json:"probe_requires_claude_code"`
	Description             string  `json:"description" gorm:"type:varchar(255)"`
	SortOrder               int     `json:"sort_order"`
	CreatedTime             int64   `json:"created_time" gorm:"bigint"`
	UpdatedTime             int64   `json:"updated_time" gorm:"bigint"`
	ListedAt                int64   `json:"listed_at" gorm:"bigint;index"`
}

type listingKey struct {
	channelId int
	model     string
}

var marketListingCache struct {
	sync.RWMutex
	byKey    map[listingKey]*MarketListing
	byModel  map[string][]*MarketListing
	loadedAt time.Time
}

const marketListingCacheTTL = 20 * time.Second

func loadMarketListings() error {
	var rows []*MarketListing
	if err := DB.Find(&rows).Error; err != nil {
		return err
	}
	byKey := make(map[listingKey]*MarketListing, len(rows))
	byModel := make(map[string][]*MarketListing)
	for _, r := range rows {
		byKey[listingKey{r.ChannelId, r.ModelName}] = r
		byModel[r.ModelName] = append(byModel[r.ModelName], r)
	}
	marketListingCache.Lock()
	marketListingCache.byKey = byKey
	marketListingCache.byModel = byModel
	marketListingCache.loadedAt = time.Now()
	marketListingCache.Unlock()
	return nil
}

func ensureMarketListingCache() {
	marketListingCache.RLock()
	fresh := marketListingCache.byKey != nil && time.Since(marketListingCache.loadedAt) < marketListingCacheTTL
	marketListingCache.RUnlock()
	if fresh {
		return
	}
	if err := loadMarketListings(); err != nil {
		common.SysError("load market listings failed: " + err.Error())
	}
}

func InvalidateMarketListings() {
	marketListingCache.Lock()
	marketListingCache.byKey = nil
	marketListingCache.Unlock()
	invalidateMarketStatSummary()
	InvalidatePricingCache()
}

// SetMarketListingProbeRequiresClaudeCode persists only the probe restriction.
// It never changes listing availability, prices, or administrator presentation settings.
func SetMarketListingProbeRequiresClaudeCode(channelId int, modelName string, required bool) error {
	result := DB.Model(&MarketListing{}).
		Where("channel_id = ? AND model_name = ?", channelId, modelName).
		Where("probe_requires_claude_code IS NULL OR probe_requires_claude_code <> ?", required).
		Update("probe_requires_claude_code", required)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		InvalidateMarketListings()
	}
	return nil
}

func GetMarketListing(channelId int, modelName string) *MarketListing {
	ensureMarketListingCache()
	marketListingCache.RLock()
	defer marketListingCache.RUnlock()
	return marketListingCache.byKey[listingKey{channelId, modelName}]
}

func GetMarketListingByID(id int) *MarketListing {
	ensureMarketListingCache()
	marketListingCache.RLock()
	defer marketListingCache.RUnlock()
	for _, listing := range marketListingCache.byKey {
		if listing.Id == id {
			return listing
		}
	}
	return nil
}

func GetMarketListingsByModel(modelName string) []*MarketListing {
	ensureMarketListingCache()
	marketListingCache.RLock()
	defer marketListingCache.RUnlock()
	src := marketListingCache.byModel[modelName]
	out := make([]*MarketListing, len(src))
	copy(out, src)
	return out
}

func GetAllMarketListingsCached() []*MarketListing {
	ensureMarketListingCache()
	marketListingCache.RLock()
	defer marketListingCache.RUnlock()
	out := make([]*MarketListing, 0, len(marketListingCache.byKey))
	for _, l := range marketListingCache.byKey {
		out = append(out, l)
	}
	return out
}

func QueryMarketListings(channelId int, keyword string) ([]*MarketListing, error) {
	q := DB.Model(&MarketListing{})
	if channelId > 0 {
		q = q.Where("channel_id = ?", channelId)
	}
	if kw := strings.TrimSpace(keyword); kw != "" {
		if id, err := strconv.Atoi(strings.TrimPrefix(strings.ToLower(kw), "id")); err == nil && id > 0 {
			q = q.Where("id = ?", id)
		} else {
			q = q.Where("model_name LIKE ?", "%"+kw+"%")
		}
	}
	var rows []*MarketListing
	err := q.Order("channel_id asc, sort_order asc, model_name asc").Find(&rows).Error
	return rows, err
}

func (l *MarketListing) validate() error {
	l.ModelName = strings.TrimSpace(l.ModelName)
	if l.ChannelId <= 0 || l.ModelName == "" {
		return errors.New("channel_id and model_name are required")
	}
	if math.IsNaN(l.Ratio) || math.IsInf(l.Ratio, 0) || l.Ratio < 0 {
		return errors.New("ratio must not be negative")
	}
	if l.HasExpressionContract() {
		if l.Ratio != 1 {
			return errors.New("dynamic selling contracts must use ratio 1")
		}
		if err := billing_setting.SmokeTestExpr(l.BillingExpr); err != nil {
			return err
		}
	}
	if l.BillingMode == "fixed_request" {
		if l.Ratio != 1 {
			return errors.New("published request prices must use ratio 1")
		}
		if _, err := ParseUpstreamAmount(l.BillingExpr); err != nil {
			return err
		}
	}
	if len(l.Description) > 255 {
		return errors.New("description too long")
	}
	return nil
}

func (l *MarketListing) Insert() error {
	if err := l.validate(); err != nil {
		return err
	}
	now := common.GetTimestamp()
	l.CreatedTime, l.UpdatedTime = now, now
	if l.Enabled && l.ListedAt == 0 {
		l.ListedAt = now
	}
	if err := DB.Transaction(func(tx *gorm.DB) error {
		var channel Channel
		if err := lockForUpdate(tx).First(&channel, l.ChannelId).Error; err != nil {
			return err
		}
		if l.Enabled {
			var sources []UpstreamSource
			if err := lockForUpdate(tx).Where("channel_id = ?", l.ChannelId).Find(&sources).Error; err != nil {
				return err
			}
			for _, source := range sources {
				if err := EnsureUpstreamModelAllowed(tx, source, l.ModelName); err != nil {
					return err
				}
			}
		}
		return tx.Create(l).Error
	}); err != nil {
		return err
	}
	InvalidateMarketListings()
	return nil
}

func UpdateMarketListing(id int, ratio *float64, enabled *bool, description *string, sortOrder *int) (*MarketListing, error) {
	var l MarketListing
	if err := DB.First(&l, "id = ?", id).Error; err != nil {
		return nil, err
	}
	if ratio != nil {
		if math.IsNaN(*ratio) || math.IsInf(*ratio, 0) || *ratio < 0 || (l.HasPublishedPrice() && *ratio != 1) {
			return nil, errors.New("ratio must not be negative")
		}
		l.Ratio = *ratio
	}
	wasEnabled := l.Enabled
	if enabled != nil {
		l.Enabled = *enabled
		if *enabled && !wasEnabled && l.ListedAt == 0 {
			l.ListedAt = common.GetTimestamp()
		}
	}
	if description != nil {
		if len(*description) > 255 {
			return nil, errors.New("description too long")
		}
		l.Description = *description
	}
	if sortOrder != nil {
		l.SortOrder = *sortOrder
	}
	l.UpdatedTime = common.GetTimestamp()
	columns := []string{"updated_time"}
	if ratio != nil {
		columns = append(columns, "ratio")
	}
	if enabled != nil {
		columns = append(columns, "enabled", "listed_at")
	}
	if description != nil {
		columns = append(columns, "description")
	}
	if sortOrder != nil {
		columns = append(columns, "sort_order")
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var channel Channel
		if err := lockForUpdate(tx).First(&channel, l.ChannelId).Error; err != nil {
			return err
		}
		if enabled != nil && *enabled {
			var sources []UpstreamSource
			if err := lockForUpdate(tx).Where("channel_id = ?", l.ChannelId).Order("id asc").Find(&sources).Error; err != nil {
				return err
			}
			for _, source := range sources {
				if err := EnsureUpstreamModelAllowed(tx, source, l.ModelName); err != nil {
					return err
				}
			}
		}
		if enabled != nil && !*enabled {
			if err := PruneTokenRouteBindings(tx, nil, []MarketListing{l}); err != nil {
				return err
			}
		}
		return tx.Model(&l).Select(columns).Updates(&l).Error
	})
	if err != nil {
		return nil, err
	}
	InvalidateMarketListings()
	return &l, nil
}

func DeleteMarketListings(ids []int) error {
	if len(ids) == 0 {
		return nil
	}
	if err := DB.Transaction(func(tx *gorm.DB) error { return DeleteMarketListingsTx(tx, ids) }); err != nil {
		return err
	}
	InvalidateMarketListings()
	return nil
}

// GenerateMarketListings creates a disabled, unpriced listing for each model
// that has none yet for the channel, and returns how many were created.
func GenerateMarketListings(channelId int, models []string) (int, error) {
	created := 0
	now := common.GetTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		var channel Channel
		if err := lockForUpdate(tx).First(&channel, channelId).Error; err != nil {
			return err
		}
		for _, m := range models {
			m = strings.TrimSpace(m)
			if m == "" {
				continue
			}
			var cnt int64
			if err := tx.Model(&MarketListing{}).Where("channel_id = ? AND model_name = ?", channelId, m).Count(&cnt).Error; err != nil {
				return err
			}
			if cnt > 0 {
				continue
			}
			if err := tx.Create(&MarketListing{ChannelId: channelId, ModelName: m, CreatedTime: now, UpdatedTime: now}).Error; err != nil {
				return err
			}
			created++
		}
		return nil
	})
	if err == nil && created > 0 {
		InvalidateMarketListings()
	}
	return created, err
}

package model

import (
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// MarketListing prices one (channel, model) pair. A listing is only routable
// when it is enabled and has a positive ratio.
type MarketListing struct {
	Id          int     `json:"id"`
	ChannelId   int     `json:"channel_id" gorm:"not null;uniqueIndex:idx_market_channel_model,priority:1"`
	ModelName   string  `json:"model_name" gorm:"type:varchar(255);not null;uniqueIndex:idx_market_channel_model,priority:2;index"`
	Ratio       float64 `json:"ratio"`
	Enabled     bool    `json:"enabled"`
	Description string  `json:"description" gorm:"type:varchar(255)"`
	SortOrder   int     `json:"sort_order"`
	CreatedTime int64   `json:"created_time" gorm:"bigint"`
	UpdatedTime int64   `json:"updated_time" gorm:"bigint"`
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
	InvalidatePricingCache()
}

func GetMarketListing(channelId int, modelName string) *MarketListing {
	ensureMarketListingCache()
	marketListingCache.RLock()
	defer marketListingCache.RUnlock()
	return marketListingCache.byKey[listingKey{channelId, modelName}]
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
		q = q.Where("model_name LIKE ?", "%"+kw+"%")
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
	if l.Ratio < 0 {
		return errors.New("ratio must not be negative")
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
	if err := DB.Create(l).Error; err != nil {
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
		if *ratio < 0 {
			return nil, errors.New("ratio must not be negative")
		}
		l.Ratio = *ratio
	}
	if enabled != nil {
		l.Enabled = *enabled
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
	if err := DB.Model(&l).Select("ratio", "enabled", "description", "sort_order", "updated_time").Updates(&l).Error; err != nil {
		return nil, err
	}
	InvalidateMarketListings()
	return &l, nil
}

func DeleteMarketListings(ids []int) error {
	if len(ids) == 0 {
		return nil
	}
	if err := DB.Delete(&MarketListing{}, "id IN ?", ids).Error; err != nil {
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

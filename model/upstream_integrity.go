package model

import (
	"encoding/json"
	"errors"
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"strings"
)

// A relay's cached enabled status is insufficient: its owning Key and website
// must still exist and allow traffic. Authorization/price freshness alone does
// not revoke an otherwise valid published contract.
func UpstreamChannelUsable(channelID int, modelName ...string) bool {
	var channel Channel
	if err := DB.Select("id").First(&channel, channelID).Error; err != nil {
		return false
	}
	var sources []UpstreamSource
	if err := DB.Where("channel_id = ?", channelID).Find(&sources).Error; err != nil {
		return false
	}
	for _, source := range sources {
		name := ""
		if len(modelName) > 0 {
			name = modelName[0]
		}
		if err := EnsureUpstreamModelAllowed(DB, source, name); err != nil {
			return false
		}
	}
	return true
}

func EnsureUpstreamModelAllowed(tx *gorm.DB, source UpstreamSource, modelName string) error {
	if err := EnsureUpstreamPublishingEnabled(tx, source); err != nil {
		return err
	}
	if modelName == "" || source.AllowedModelsJSON == "" || source.AllowedModelsJSON == "null" {
		return nil
	}
	var allowed []string
	if err := common.UnmarshalJsonStr(source.AllowedModelsJSON, &allowed); err != nil {
		return err
	}
	if upstreamAllowsModel(upstreamAllowedModels(allowed), modelName) {
		return nil
	}
	return errors.New("this model is no longer allowed by its upstream Key")
}

// A base-model permission covers its generated supplier offers. An explicit
// supplier alias grants only that offer, never its siblings or model variants.
func upstreamAllowedModels(names []string) map[string]bool {
	allowed := map[string]bool{}
	for _, name := range names {
		allowed[name] = true
		if !strings.Contains(name, "@") {
			allowed[common.MarketBaseModel(name)] = true
		}
	}
	return allowed
}

func upstreamAllowsModel(allowed map[string]bool, name string) bool {
	return allowed[name] || allowed[common.MarketBaseModel(name)]
}

// Resolve route identities for display without retaining deleted parents.
// Paused listings remain explicitly unavailable; removed Keys never remain
// joined, and surviving routes keep a contiguous primary/fallback order.
func LiveTokenRoutes(routes []TokenRoute) []TokenRoute {
	result := make([]TokenRoute, 0, len(routes))
	for _, route := range routes {
		next := TokenRoute{Model: route.Model, Channels: []int{}}
		for index, id := range route.Channels {
			listing := route.Listing(index)
			if listing == nil || !UpstreamChannelUsable(id, listing.ModelName) {
				continue
			}
			channel, err := CacheGetChannel(id)
			if err != nil || channel == nil {
				continue
			}
			next.AppendChannel(id, listing.Id)
		}
		if len(next.Channels) > 0 || len(route.Channels) == 0 {
			result = append(result, next)
		}
	}
	return result
}

// Repair older databases using the same transactional operations as normal
// lifecycle changes. This never contacts or deletes remote upstream Keys and
// never changes the contracts of surviving models or historical usage logs.
func ReconcileUpstreamIntegrity() error {
	err := DB.Transaction(func(tx *gorm.DB) error {
		var sources []UpstreamSource
		if err := lockForUpdate(tx).Order("id asc").Find(&sources).Error; err != nil {
			return err
		}
		missing := []UpstreamSource{}
		for _, source := range sources {
			invalid := source.KeyMissing
			if source.AccountId > 0 {
				var account UpstreamAccount
				if err := tx.First(&account, source.AccountId).Error; errors.Is(err, gorm.ErrRecordNotFound) {
					invalid = true
				} else if err != nil {
					return err
				}
			}
			if source.ChannelId > 0 {
				var count int64
				if err := tx.Model(&Channel{}).Where("id = ?", source.ChannelId).Count(&count).Error; err != nil {
					return err
				}
				if count == 0 {
					invalid = true
				}
			}
			if invalid {
				missing = append(missing, source)
				continue
			}
			if err := EnsureUpstreamPublishingEnabled(tx, source); err != nil {
				if err := pauseUpstreamSource(tx, source, nil); err != nil {
					return err
				}
			} else if source.AllowedModelsJSON != "" && source.AllowedModelsJSON != "null" {
				var names []string
				if err := common.UnmarshalJsonStr(source.AllowedModelsJSON, &names); err != nil {
					return err
				}
				allowed := upstreamAllowedModels(names)
				if err := pauseUpstreamSource(tx, source, allowed); err != nil {
					return err
				}
			}
		}
		if err := DeleteUpstreamSourcesTx(tx, missing); err != nil {
			return err
		}
		var listings []MarketListing
		if err := tx.Find(&listings).Error; err != nil {
			return err
		}
		liveListings := map[int]MarketListing{}
		liveChannels := map[int]bool{}
		var channels []Channel
		if err := tx.Select("id").Find(&channels).Error; err != nil {
			return err
		}
		for _, channel := range channels {
			liveChannels[channel.Id] = true
		}
		orphanIDs := []int{}
		for _, l := range listings {
			if !liveChannels[l.ChannelId] {
				orphanIDs = append(orphanIDs, l.Id)
			} else {
				liveListings[l.Id] = l
			}
		}
		if err := DeleteMarketListingsTx(tx, orphanIDs); err != nil {
			return err
		}
		return pruneTokenRouteBindings(tx, nil, nil, liveListings, liveChannels)
	})
	if err == nil {
		InitChannelCache()
		InvalidateMarketListings()
	}
	return err
}

// PruneTokenRouteBindings removes only the affected selections, retaining the
// order and identities of all other options. Empty, deliberately added models
// are preserved; models emptied by a deletion are removed from the key.
func PruneTokenRouteBindings(tx *gorm.DB, channelIDs []int, listings []MarketListing) error {
	return pruneTokenRouteBindings(tx, channelIDs, listings, nil, nil)
}

func pruneTokenRouteBindings(tx *gorm.DB, channelIDs []int, listings []MarketListing, liveListings map[int]MarketListing, liveChannels map[int]bool) error {
	if len(channelIDs) == 0 && len(listings) == 0 && liveListings == nil {
		return nil
	}
	channels := map[int]bool{}
	listingIDs := map[int]bool{}
	legacy := map[listingKey]bool{}
	for _, id := range channelIDs {
		channels[id] = true
	}
	for _, l := range listings {
		listingIDs[l.Id] = true
		legacy[listingKey{l.ChannelId, l.ModelName}] = true
	}
	var rows []Token
	return lockForUpdate(tx).Select("id", "key", "routes").Where("routes <> ?", "").Order("id asc").FindInBatches(&rows, 100, func(batch *gorm.DB, _ int) error {
		for _, token := range rows {
			var routes []TokenRoute
			if err := common.UnmarshalJsonStr(token.Routes, &routes); err != nil {
				return errors.New("could not safely update a malformed token route")
			}
			kept := make([]TokenRoute, 0, len(routes))
			changed := false
			for _, route := range routes {
				next := TokenRoute{Model: route.Model, Channels: []int{}}
				removed := false
				for index, channelID := range route.Channels {
					listingID := route.ListingID(index)
					invalid := false
					if liveListings != nil {
						invalid = !liveChannels[channelID]
						if listingID > 0 {
							l, exists := liveListings[listingID]
							invalid = invalid || !exists || l.ChannelId != channelID || common.MarketBaseModel(l.ModelName) != common.MarketBaseModel(route.Model)
						} else {
							found := false
							for _, l := range liveListings {
								if l.ChannelId == channelID && l.ModelName == route.Model {
									found = true
									break
								}
							}
							invalid = invalid || !found
						}
					}
					if invalid || channels[channelID] || listingIDs[listingID] || (listingID == 0 && legacy[listingKey{channelID, route.Model}]) {
						removed, changed = true, true
						continue
					}
					next.AppendChannel(channelID, listingID)
				}
				if !removed {
					kept = append(kept, route)
				} else if len(next.Channels) > 0 {
					kept = append(kept, next)
				}
			}
			if !changed {
				continue
			}
			raw, err := common.Marshal(kept)
			if err != nil {
				return err
			}
			if err := invalidateTokenCacheForMutation(token.Key); err != nil {
				return err
			}
			// Keep the original JSON as a compare-and-swap guard as well as the
			// row lock, so a concurrent route edit can never be overwritten.
			result := tx.Model(&Token{}).Where("id = ? AND routes = ?", token.Id, token.Routes).Update("routes", string(raw))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errors.New("token routes changed during channel cleanup")
			}
		}
		return nil
	}).Error
}

// DeleteMarketListingsTx is shared by both listing management entry points.
// Routing references and reviews are changed atomically with the listing.
func DeleteMarketListingsTx(tx *gorm.DB, ids []int) error {
	if len(ids) == 0 {
		return nil
	}
	var listings []MarketListing
	if err := lockForUpdate(tx).Where("id IN ?", ids).Find(&listings).Error; err != nil {
		return err
	}
	if err := PruneTokenRouteBindings(tx, nil, listings); err != nil {
		return err
	}
	if err := tx.Model(&UpstreamReview{}).Where("listing_id IN ?", ids).Updates(map[string]any{"listing_id": 0, "applied_markup": ""}).Error; err != nil {
		return err
	}
	return tx.Where("id IN ?", ids).Delete(&MarketListing{}).Error
}

// Remove saved Key material as well as its source row. No upstream API is
// called: a later explicit authorization may discover that remote Key again.
func deleteUpstreamSourceRecords(tx *gorm.DB, sources []UpstreamSource) error {
	accounts := map[int]map[int]bool{}
	ids := make([]int, 0, len(sources))
	for _, source := range sources {
		ids = append(ids, source.Id)
		if source.AccountId > 0 {
			if accounts[source.AccountId] == nil {
				accounts[source.AccountId] = map[int]bool{}
			}
			accounts[source.AccountId][source.RemoteKeyId] = true
		}
	}
	for accountID, keys := range accounts {
		var account UpstreamAccount
		if err := lockForUpdate(tx).First(&account, accountID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		} else if err != nil {
			return err
		}
		if account.BrowserDiscovery == "" {
			continue
		}
		plain, err := common.OpenUpstreamSecret(string(account.BrowserDiscovery))
		if err != nil {
			return err
		}
		var snapshot map[string]json.RawMessage
		if err := common.UnmarshalJsonStr(plain, &snapshot); err != nil {
			return err
		}
		var stored []map[string]json.RawMessage
		if raw := snapshot["keys"]; len(raw) > 0 {
			if err := common.Unmarshal(raw, &stored); err != nil {
				return err
			}
		}
		kept := make([]map[string]json.RawMessage, 0, len(stored))
		for _, key := range stored {
			var id int
			if err := common.Unmarshal(key["id"], &id); err != nil {
				return err
			}
			if !keys[id] {
				kept = append(kept, key)
			}
		}
		if len(kept) == len(stored) {
			continue
		}
		snapshot["keys"], err = common.Marshal(kept)
		if err != nil {
			return err
		}
		raw, err := common.Marshal(snapshot)
		if err != nil {
			return err
		}
		sealed, err := common.SealUpstreamSecret(string(raw))
		if err != nil {
			return err
		}
		if err := tx.Model(&account).Updates(map[string]any{"browser_discovery": sealed, "revision": gorm.Expr("revision + 1")}).Error; err != nil {
			return err
		}
	}
	for start := 0; start < len(ids); start += 200 {
		chunk := ids[start:min(start+200, len(ids))]
		for _, entity := range []any{&UpstreamReview{}, &UpstreamRefresh{}} {
			if err := tx.Where("source_id IN ?", chunk).Delete(entity).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("id IN ?", chunk).Delete(&UpstreamSource{}).Error; err != nil {
			return err
		}
	}
	return nil
}

// Every channel deletion path uses this transaction, including batch/status
// deletion and deletion reached through an upstream website or missing Key.
func deleteChannelTree(tx *gorm.DB, ids []int) (int64, error) {
	var deleted int64
	for start := 0; start < len(ids); start += 200 {
		chunk := ids[start:min(start+200, len(ids))]
		var channels []Channel
		if err := lockForUpdate(tx).Where("id IN ?", chunk).Order("id asc").Find(&channels).Error; err != nil {
			return 0, err
		}
		var sources []UpstreamSource
		if err := lockForUpdate(tx).Where("channel_id IN ?", chunk).Find(&sources).Error; err != nil {
			return 0, err
		}
		if err := PruneTokenRouteBindings(tx, chunk, nil); err != nil {
			return 0, err
		}
		if err := deleteUpstreamSourceRecords(tx, sources); err != nil {
			return 0, err
		}
		for _, entity := range []any{&MarketListing{}, &MarketStat{}, &MarketProbeUsageRecord{}, &Ability{}} {
			if err := tx.Where("channel_id IN ?", chunk).Delete(entity).Error; err != nil {
				return 0, err
			}
		}
		result := tx.Where("id IN ?", chunk).Delete(&Channel{})
		if result.Error != nil {
			return 0, result.Error
		}
		deleted += result.RowsAffected
	}
	return deleted, nil
}

func DeleteUpstreamSourcesTx(tx *gorm.DB, sources []UpstreamSource) error {
	ids := make([]int, 0, len(sources))
	channels := []int{}
	seen := map[int]bool{}
	for _, source := range sources {
		ids = append(ids, source.Id)
		if source.ChannelId > 0 && !seen[source.ChannelId] {
			channels = append(channels, source.ChannelId)
			seen[source.ChannelId] = true
		}
	}
	for _, channelID := range channels {
		var shared int64
		if err := tx.Model(&UpstreamSource{}).Where("channel_id = ? AND id NOT IN ?", channelID, ids).Count(&shared).Error; err != nil {
			return err
		}
		if shared > 0 {
			return errors.New("this relay channel is shared with another upstream; unlink it before managing this channel")
		}
	}
	if _, err := deleteChannelTree(tx, channels); err != nil {
		return err
	}
	return deleteUpstreamSourceRecords(tx, sources)
}

// An unavailable Key loses its published options and user selections, while
// its price contracts remain available for explicit review after recovery.
func pauseUpstreamSource(tx *gorm.DB, source UpstreamSource, allowed map[string]bool) error {
	if source.ChannelId <= 0 {
		return nil
	}
	var listings []MarketListing
	if err := lockForUpdate(tx).Where("channel_id = ?", source.ChannelId).Find(&listings).Error; err != nil {
		return err
	}
	ids := []int{}
	removed := []MarketListing{}
	for _, listing := range listings {
		if allowed != nil && upstreamAllowsModel(allowed, listing.ModelName) {
			continue
		}
		ids = append(ids, listing.Id)
		removed = append(removed, listing)
	}
	if allowed == nil {
		if err := PruneTokenRouteBindings(tx, []int{source.ChannelId}, nil); err != nil {
			return err
		}
	} else if err := PruneTokenRouteBindings(tx, nil, removed); err != nil {
		return err
	}
	if len(ids) > 0 {
		if err := tx.Model(&MarketListing{}).Where("id IN ?", ids).Updates(map[string]any{"enabled": false, "updated_time": common.GetTimestamp()}).Error; err != nil {
			return err
		}
	}
	return nil
}

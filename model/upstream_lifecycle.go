package model

import (
	"errors"
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"sort"
)

// Disabled websites stay disabled when discovery adds or refreshes Keys.
// Checks run inside the publishing transaction after locking its source.
func EnsureUpstreamPublishingEnabled(tx *gorm.DB, source UpstreamSource) error {
	if source.Disabled {
		return errors.New("this upstream channel is disabled; enable it before publishing")
	}
	if (source.AccountId > 0 || source.Adapter == "direct-key") && (source.KeyMissing || source.KeyStatus != 1 || source.KeyIssue != "" || (source.KeyExpiresAt > 0 && source.KeyExpiresAt <= common.GetTimestamp())) {
		return errors.New("this upstream Key is unavailable; refresh and verify it before publishing")
	}
	if source.AccountId > 0 {
		var account UpstreamAccount
		err := tx.Select("id", "disabled").First(&account, source.AccountId).Error
		if err != nil {
			return err
		}
		if account.Disabled {
			return errors.New("this upstream channel is disabled; enable it before publishing")
		}
	}
	return nil
}

func DeleteUpstreamAccount(id int, revision int64) error {
	return changeUpstreamLifecycle(id, revision, true, nil)
}
func SetUpstreamAccountDisabled(id int, revision int64, disabled bool) error {
	return changeUpstreamLifecycle(id, revision, true, &disabled)
}
func DeleteUpstreamManualChannel(id int, revision int64) error {
	return changeUpstreamLifecycle(id, revision, false, nil)
}
func SetUpstreamManualChannelDisabled(id int, revision int64, disabled bool) error {
	return changeUpstreamLifecycle(id, revision, false, &disabled)
}

// All local Keys, snapshots, model bindings and routing changes commit together.
// A nil state is a deletion; remote websites are never contacted here.
func changeUpstreamLifecycle(id int, revision int64, website bool, disabled *bool) error {
	if id <= 0 || revision < 0 {
		return errors.New("invalid upstream channel identity")
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var account UpstreamAccount
		var sources []UpstreamSource
		if website {
			if err := lockForUpdate(tx).First(&account, id).Error; err != nil {
				return err
			}
			if account.Revision != revision {
				return errors.New("account changed; reload before managing this channel")
			}
			if err := lockForUpdate(tx).Where("account_id = ?", id).Order("id asc").Find(&sources).Error; err != nil {
				return err
			}
		} else {
			var source UpstreamSource
			if err := lockForUpdate(tx).First(&source, id).Error; err != nil {
				return err
			}
			if source.AccountId != 0 || source.Adapter != "direct-key" {
				return errors.New("manage an account Key through its upstream website channel")
			}
			if source.Revision != revision {
				return errors.New("Key changed; reload before managing this channel")
			}
			sources = []UpstreamSource{source}
		}
		channelSet := map[int]bool{}
		for _, source := range sources {
			if source.ChannelId > 0 {
				channelSet[source.ChannelId] = true
			}
		}
		channelIDs := make([]int, 0, len(channelSet))
		for channelID := range channelSet {
			channelIDs = append(channelIDs, channelID)
		}
		sort.Ints(channelIDs)
		// Older manually linked catalogs can share a relay. Never affect another site.
		owned := tx.Model(&UpstreamSource{}).Select("id")
		if website {
			owned = owned.Where("account_id = ?", id)
		} else {
			owned = owned.Where("id = ?", id)
		}
		for start := 0; start < len(channelIDs); start += 200 {
			end := min(start+200, len(channelIDs))
			var shared int64
			if err := tx.Model(&UpstreamSource{}).Where("channel_id IN ?", channelIDs[start:end]).Where("id NOT IN (?)", owned).Count(&shared).Error; err != nil {
				return err
			}
			if shared > 0 {
				return errors.New("this relay channel is shared with another upstream; unlink it before managing this channel")
			}
		}
		if disabled == nil {
			if website {
				// The whole account is being removed, so its encrypted snapshot
				// need not be decrypted merely to remove individual Keys.
				if err := tx.Model(&account).Update("browser_discovery", "").Error; err != nil {
					return err
				}
			}
			if err := DeleteUpstreamSourcesTx(tx, sources); err != nil {
				return err
			}
			if website {
				return tx.Delete(&account).Error
			}
			return nil
		}
		previousDisabled := account.Disabled
		if !website {
			previousDisabled = sources[0].Disabled
		}
		if previousDisabled == *disabled {
			return nil
		}
		channelStates := map[int]int{}
		for _, source := range sources {
			updates := map[string]any{"revision": source.Revision + 1}
			if !website {
				updates["disabled"] = *disabled
			}
			originalStatus, handled := channelStates[source.ChannelId]
			if handled {
				if *disabled {
					updates["previous_channel_status"] = originalStatus
				} else {
					updates["previous_channel_status"] = 0
				}
			}
			if source.ChannelId > 0 && !handled && (!website || !source.Disabled) {
				var channel Channel
				if err := lockForUpdate(tx).First(&channel, source.ChannelId).Error; err != nil {
					return err
				}
				if *disabled {
					channelStates[channel.Id] = channel.Status
					updates["previous_channel_status"] = channel.Status
					channel.Status = common.ChannelStatusManuallyDisabled
					if err := PruneTokenRouteBindings(tx, []int{channel.Id}, nil); err != nil {
						return err
					}
					if err := tx.Model(&MarketListing{}).Where("channel_id = ?", channel.Id).Updates(map[string]any{"enabled": false, "updated_time": common.GetTimestamp()}).Error; err != nil {
						return err
					}
				} else {
					channelStates[channel.Id] = source.PreviousChannelStatus
					channel.Status = source.PreviousChannelStatus
					if channel.Status == 0 {
						channel.Status = common.ChannelStatusEnabled
					}
					updates["previous_channel_status"] = 0
				}
				if err := tx.Model(&channel).Update("status", channel.Status).Error; err != nil {
					return err
				}
				if err := channel.UpdateAbilities(tx); err != nil {
					return err
				}
			}
			if err := tx.Model(&UpstreamSource{}).Where("id = ? AND revision = ?", source.Id, source.Revision).Updates(updates).Error; err != nil {
				return err
			}
		}
		if website {
			return tx.Model(&account).Updates(map[string]any{"disabled": *disabled, "revision": account.Revision + 1}).Error
		}
		return nil
	})
	if err == nil {
		InitChannelCache()
		InvalidateMarketListings()
		invalidateMarketStatSummary()
	}
	return err
}

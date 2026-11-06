package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// TokenRoute is one model with its ordered channel list inside a token.
type TokenRoute struct {
	Model      string `json:"model"`
	Channels   []int  `json:"channels"`
	ListingIDs []int  `json:"listing_ids,omitempty"`
}

func (r TokenRoute) ListingID(index int) int {
	if index < len(r.ListingIDs) {
		return r.ListingIDs[index]
	}
	return 0
}

func (r TokenRoute) Listing(index int) *MarketListing {
	if id := r.ListingID(index); id > 0 {
		listing := GetMarketListingByID(id)
		if listing != nil && listing.ChannelId == r.Channels[index] && common.MarketBaseModel(listing.ModelName) == r.Model {
			return listing
		}
		return nil
	}
	return GetMarketListing(r.Channels[index], r.Model)
}

func (r *TokenRoute) AppendChannel(channelID, listingID int) {
	if listingID > 0 || len(r.ListingIDs) > 0 {
		for len(r.ListingIDs) < len(r.Channels) {
			r.ListingIDs = append(r.ListingIDs, 0)
		}
		r.ListingIDs = append(r.ListingIDs, listingID)
	}
	r.Channels = append(r.Channels, channelID)
}

const maxTokenRouteModels = 200

func (token *Token) GetRoutes() []TokenRoute {
	if token.Routes == "" {
		return nil
	}
	var routes []TokenRoute
	if err := common.UnmarshalJsonStr(token.Routes, &routes); err != nil {
		common.SysError(fmt.Sprintf("failed to parse routes for token %d: %v", token.Id, err))
		return nil
	}
	return normalizeRoutes(routes)
}

func (token *Token) GetRouteMap() map[string][]int {
	routes := token.GetRoutes()
	m := make(map[string][]int, len(routes))
	for _, r := range routes {
		m[r.Model] = r.Channels
	}
	return m
}

// normalizeRoutes merges supplier aliases while retaining each listing and its order. A model without channels is kept: the user
// added it on purpose and picks its channels later; requests for it fail with "no available channel".
func normalizeRoutes(routes []TokenRoute) []TokenRoute {
	out := make([]TokenRoute, 0, len(routes))
	seen := make(map[string]int, len(routes))
	for _, r := range routes {
		if r.Model == "" {
			continue
		}
		name := common.MarketBaseModel(r.Model)
		index, exists := seen[name]
		if !exists {
			index = len(out)
			seen[name] = index
			out = append(out, TokenRoute{Model: name, Channels: []int{}})
		}
		for i, channelID := range r.Channels {
			listingID := r.ListingID(i)
			if listingID == 0 && name != r.Model {
				if listing := GetMarketListing(channelID, r.Model); listing != nil {
					listingID = listing.Id
				} else {
					// Keep an unavailable legacy alias separate rather than assigning another listing.
					out = append(out, TokenRoute{Model: r.Model, Channels: []int{channelID}})
					continue
				}
			}
			duplicate := false
			for j, existing := range out[index].Channels {
				if existing == channelID && out[index].ListingID(j) == listingID {
					duplicate = true
					break
				}
			}
			if !duplicate {
				out[index].AppendChannel(channelID, listingID)
			}
		}
	}
	return out
}

func (token *Token) setRoutes(routes []TokenRoute) error {
	routes = normalizeRoutes(routes)
	if len(routes) == 0 {
		token.Routes = ""
		return nil
	}
	data, err := common.Marshal(routes)
	if err != nil {
		return err
	}
	token.Routes = string(data)
	return nil
}

// MutateTokenRoutes loads the token row under a write lock, applies fn to its
// routes and saves them, so concurrent single-item edits do not overwrite each other.
func MutateTokenRoutes(tokenId int, userId int, fn func(routes []TokenRoute) ([]TokenRoute, error), requiredListingIDs ...int) (*Token, error) {
	var result *Token
	err := DB.Transaction(func(tx *gorm.DB) error {
		// Take the write lock first: on SQLite a read-then-write transaction fails
		// with SQLITE_BUSY as soon as another writer commits in between.
		lockResult := tx.Model(&Token{}).Where("id = ? and user_id = ?", tokenId, userId).Update("name", gorm.Expr("name"))
		if lockResult.Error != nil {
			return lockResult.Error
		}
		if lockResult.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		var token Token
		if err := lockForUpdate(tx).First(&token, "id = ? and user_id = ?", tokenId, userId).Error; err != nil {
			return err
		}
		// Recheck newly selected listings inside the write transaction. A cached
		// market response must never reinsert a selection after its parent was deleted.
		for _, id := range requiredListingIDs {
			var listing MarketListing
			if err := lockForUpdate(tx).First(&listing, id).Error; err != nil {
				return err
			}
			var channel Channel
			if err := lockForUpdate(tx).First(&channel, listing.ChannelId).Error; err != nil {
				return err
			}
			if !listing.Enabled || listing.Ratio <= 0 || channel.Status != common.ChannelStatusEnabled {
				return errors.New("this channel is not available in the market")
			}
			var sources []UpstreamSource
			if err := lockForUpdate(tx).Where("channel_id = ?", channel.Id).Find(&sources).Error; err != nil {
				return err
			}
			for _, source := range sources {
				if err := EnsureUpstreamModelAllowed(tx, source, listing.ModelName); err != nil {
					return err
				}
			}
		}
		next, err := fn(token.GetRoutes())
		if err != nil {
			return err
		}
		next = normalizeRoutes(next)
		if len(next) > maxTokenRouteModels {
			return errors.New("too many models in this key")
		}
		if err := token.setRoutes(next); err != nil {
			return err
		}
		if cacheErr := invalidateTokenCacheForMutation(token.Key); cacheErr != nil {
			common.SysLog("failed to invalidate token cache before route update: " + cacheErr.Error())
		}
		if err := tx.Model(&token).Select("routes").Updates(&token).Error; err != nil {
			return err
		}
		result = &token
		return nil
	})
	return result, err
}

func SetTokenAutoRoute(tokenId int, userId int, autoRoute bool) (*Token, error) {
	token, err := GetTokenByIds(tokenId, userId)
	if err != nil {
		return nil, err
	}
	if cacheErr := invalidateTokenCacheForMutation(token.Key); cacheErr != nil {
		common.SysLog("failed to invalidate token cache before auto route update: " + cacheErr.Error())
	}
	token.AutoRoute = autoRoute
	if err := DB.Model(token).Select("auto_route").Updates(token).Error; err != nil {
		return nil, err
	}
	return token, nil
}

package model

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// A model ID is a listing ID, never a channel ID. Exact access-model names
// distinguish supplier routes; a base name is usable only when unambiguous.
func resolveLogMarketListing(channelID int, modelName, upstreamModel string) int {
	if channelID <= 0 || modelName == "" || DB == nil {
		return 0
	}
	if upstreamModel != "" {
		if listing := GetMarketListing(channelID, upstreamModel); listing != nil &&
			common.MarketBaseModel(listing.ModelName) == common.MarketBaseModel(modelName) {
			return listing.Id
		}
	}
	if common.MarketBaseModel(modelName) != modelName {
		if listing := GetMarketListing(channelID, modelName); listing != nil {
			return listing.Id
		}
	}
	resolved := 0
	for _, listing := range GetAllMarketListingsCached() {
		if listing.ChannelId != channelID || common.MarketBaseModel(listing.ModelName) != common.MarketBaseModel(modelName) {
			continue
		}
		if resolved != 0 {
			return 0
		}
		resolved = listing.Id
	}
	return resolved
}

// Save the selected listing alongside existing billing metadata, without
// changing the internal channel foreign key or requiring a log-DB migration.
func snapshotLogMarketIdentity(log *Log, c *gin.Context) {
	if log == nil || log.ChannelId <= 0 || log.ModelName == "" {
		return
	}
	other, _ := common.StrToMap(log.Other)
	if other == nil {
		other = make(map[string]interface{})
	}
	if c != nil {
		if selected, exists := c.Get("market_selected_listing"); exists {
			if listing, ok := selected.(MarketListing); ok && listing.ChannelId == log.ChannelId &&
				common.MarketBaseModel(listing.ModelName) == common.MarketBaseModel(log.ModelName) {
				other["market_listing_id"] = listing.Id
			}
		}
		if used := c.GetStringSlice("market_used_listings"); len(used) > 0 {
			chain := make([]int, 0, len(used))
			for _, value := range used {
				id, _ := strconv.Atoi(value)
				chain = append(chain, id)
			}
			admin, _ := other["admin_info"].(map[string]interface{})
			if admin == nil {
				admin = make(map[string]interface{})
			}
			admin["use_market_listings"] = chain
			other["admin_info"] = admin
		}
	}
	log.Other = common.MapToJsonStr(other)
	populateLogMarketIdentity([]*Log{log})
	other, _ = common.StrToMap(log.Other)
	other["market_listing_id"] = log.MarketListingId
	log.Other = common.MapToJsonStr(other)
}

func populateLogMarketIdentity(logs []*Log) {
	for _, log := range logs {
		if log == nil || log.ChannelId <= 0 || log.ModelName == "" {
			continue
		}
		var metadata struct {
			ListingID     *int   `json:"market_listing_id"`
			UpstreamModel string `json:"upstream_model_name"`
			Admin         struct {
				UseChannels []interface{} `json:"use_channel"`
				UseListings []int         `json:"use_market_listings"`
			} `json:"admin_info"`
		}
		_ = common.UnmarshalJsonStr(log.Other, &metadata)
		log.MarketListingId = 0
		if metadata.ListingID != nil && *metadata.ListingID > 0 {
			log.MarketListingId = *metadata.ListingID
		}
		if metadata.ListingID == nil {
			log.MarketListingId = resolveLogMarketListing(log.ChannelId, log.ModelName, metadata.UpstreamModel)
		}
		if len(metadata.Admin.UseListings) > 0 || len(metadata.Admin.UseChannels) == 0 {
			continue
		}
		chain := make([]int, 0, len(metadata.Admin.UseChannels))
		for index, value := range metadata.Admin.UseChannels {
			channelID := 0
			switch v := value.(type) {
			case string:
				channelID, _ = strconv.Atoi(v)
			case float64:
				channelID = int(v)
			}
			id := resolveLogMarketListing(channelID, log.ModelName, "")
			if channelID == log.ChannelId && index == len(metadata.Admin.UseChannels)-1 {
				id = log.MarketListingId
			}
			chain = append(chain, id)
		}
		other, _ := common.StrToMap(log.Other)
		if admin, ok := other["admin_info"].(map[string]interface{}); ok {
			admin["use_market_listings"] = chain
			log.Other = common.MapToJsonStr(other)
		}
	}
}

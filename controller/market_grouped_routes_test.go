package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMarketGroupsSupplierOffersAndKeepsIndependentRouteIDs(t *testing.T) {
	redisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = redisEnabled })
	db := upstreamControllerDB(t)
	require.NoError(t, db.AutoMigrate(&model.Token{}, &model.MarketStat{}, &model.Model{}, &model.Vendor{}))
	channel := model.Channel{Id: 14, Type: 1, Status: common.ChannelStatusEnabled, Models: "claude-opus-5-5@s1c13,claude-opus-5-5@s46c260"}
	require.NoError(t, db.Create(&channel).Error)
	listings := []model.MarketListing{
		{ChannelId: 14, ModelName: "claude-opus-5-5@s1c13", Enabled: true, Ratio: 1, BillingMode: "fixed_expr", BillingExpr: `tier("base",p*1+c*5)`, OriginalBillingExpr: `tier("base",p*2+c*10)`},
		{ChannelId: 14, ModelName: "claude-opus-5-5@s46c260", Enabled: true, Ratio: 1, BillingMode: "fixed_expr", BillingExpr: `tier("base",p*3+c*15)`, OriginalBillingExpr: `tier("base",p*2+c*10)`},
	}
	require.NoError(t, db.Create(&listings).Error)
	model.InvalidateMarketListings()
	token := model.Token{UserId: 7, Key: "grouped-route-fixture", Name: "fixture"}
	require.NoError(t, db.Create(&token).Error)
	call := func(handler gin.HandlerFunc, method string, payload any) map[string]any {
		return upstreamControllerCall(t, func(c *gin.Context) { c.Set("id", 7); handler(c) }, method, "/api/token/routes", token.Id, payload)
	}
	result := call(GetMarketModels, http.MethodGet, nil)
	items := result["data"].([]any)
	require.Len(t, items, 1)
	item := items[0].(map[string]any)
	assert.Equal(t, "claude-opus-5-5", item["model_name"])
	require.Len(t, item["channels"].([]any), 2)
	for _, listing := range listings {
		result = call(AddTokenRoute, http.MethodPost, map[string]any{"model": "claude-opus-5-5", "channel_id": 14, "listing_id": listing.Id})
		require.Equal(t, true, result["success"])
	}
	require.NoError(t, db.First(&token, token.Id).Error)
	routes := token.GetRoutes()
	require.Len(t, routes, 1)
	assert.Equal(t, []int{14, 14}, routes[0].Channels)
	assert.Equal(t, []int{listings[0].Id, listings[1].Id}, routes[0].ListingIDs)
	// Reordering same-channel offers requires their independent listing identities.
	result = call(ReorderTokenRoute, http.MethodPut, map[string]any{"model": "claude-opus-5-5", "channels": []int{14, 14}, "listing_ids": []int{listings[1].Id, listings[0].Id}})
	require.Equal(t, true, result["success"])
	require.NoError(t, db.First(&token, token.Id).Error)
	assert.Equal(t, []int{listings[1].Id, listings[0].Id}, token.GetRoutes()[0].ListingIDs)
	result = call(RemoveTokenRoute, http.MethodDelete, map[string]any{"model": "claude-opus-5-5", "channel_id": 14, "listing_id": listings[0].Id})
	require.Equal(t, true, result["success"])
	require.NoError(t, db.First(&token, token.Id).Error)
	assert.Equal(t, []int{listings[1].Id}, token.GetRoutes()[0].ListingIDs)
	result = call(AddTokenRoute, http.MethodPost, map[string]any{"model": "claude-sonnet-5-5", "channel_id": 14, "listing_id": listings[0].Id})
	assert.Equal(t, false, result["success"])
	// Old clients sending a full alias are merged into the same public model.
	result = call(AddTokenRoute, http.MethodPost, map[string]any{"model": listings[0].ModelName, "channel_id": 14})
	require.Equal(t, true, result["success"])
	require.NoError(t, db.First(&token, token.Id).Error)
	require.Len(t, token.GetRoutes(), 1)
	assert.Equal(t, []int{listings[1].Id, listings[0].Id}, token.GetRoutes()[0].ListingIDs)
}

func TestTokenRouteViewOmitsDeletedListingReferences(t *testing.T) {
	db := upstreamControllerDB(t)
	require.NoError(t, db.AutoMigrate(&model.Token{}))
	channel := model.Channel{Id: 8, Type: 1, Status: common.ChannelStatusEnabled, Models: "claude-opus-5-5"}
	require.NoError(t, db.Create(&channel).Error)
	listing := model.MarketListing{ChannelId: channel.Id, ModelName: "claude-opus-5-5", Enabled: true, Ratio: 1, BillingMode: "fixed_expr", BillingExpr: `tier("base",p*1+c*5)`, OriginalBillingExpr: `tier("base",p*2+c*10)`}
	require.NoError(t, db.Create(&listing).Error)
	model.InvalidateMarketListings()
	routes, err := common.Marshal([]model.TokenRoute{{Model: "claude-opus-5-5", Channels: []int{24, channel.Id}, ListingIDs: []int{103, listing.Id}}})
	require.NoError(t, err)
	token := model.Token{UserId: 7, Key: "stale-listing-route-fixture", Name: "stale-listing-route", Routes: string(routes)}
	require.NoError(t, db.Create(&token).Error)
	result := upstreamControllerCall(t, func(c *gin.Context) { c.Set("id", 7); GetTokenRoutes(c) }, http.MethodGet, "/api/token/routes", token.Id, nil)
	require.Equal(t, true, result["success"])
	data := result["data"].(map[string]any)
	rows := data["routes"].([]any)
	require.Len(t, rows, 1)
	channels := rows[0].(map[string]any)["channels"].([]any)
	require.Len(t, channels, 1)
	assert.Equal(t, float64(listing.Id), channels[0].(map[string]any)["listing_id"])
}

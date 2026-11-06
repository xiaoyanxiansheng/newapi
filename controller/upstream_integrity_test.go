package controller

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpstreamDeletionUpdatesMarketTokenEditorAndSavedKeyTogether(t *testing.T) {
	for _, action := range []string{"website", "listing", "key-model-remove", "key-model-pause"} {
		t.Run(action, func(t *testing.T) {
			db := upstreamControllerDB(t)
			require.NoError(t, db.AutoMigrate(&model.Model{}, &model.Vendor{}))
			account := model.UpstreamAccount{Name: "parent", Website: "https://parent.example"}
			require.NoError(t, db.Create(&account).Error)
			channel := model.Channel{Models: "example", Group: "default", Status: common.ChannelStatusEnabled}
			require.NoError(t, db.Create(&channel).Error)
			source := model.UpstreamSource{AccountId: account.Id, ChannelId: channel.Id, KeyStatus: 1, AllowedModelsJSON: "null"}
			require.NoError(t, db.Create(&source).Error)
			listing := model.MarketListing{ChannelId: channel.Id, ModelName: "example", Enabled: true, Ratio: 1, BillingMode: "fixed_request", BillingExpr: "0.1", OriginalBillingExpr: "1"}
			require.NoError(t, db.Create(&listing).Error)
			raw, err := common.Marshal([]model.TokenRoute{{Model: "example", Channels: []int{channel.Id}, ListingIDs: []int{listing.Id}}})
			require.NoError(t, err)
			token := model.Token{UserId: 7, Key: "api-deletion-fixture", Routes: string(raw)}
			require.NoError(t, db.Create(&token).Error)
			model.InvalidateMarketListings()
			market := func() map[string]any {
				return upstreamControllerCall(t, func(c *gin.Context) { c.Set("id", 7); GetMarketModels(c) }, http.MethodGet, fmt.Sprintf("/api/market/models?token_id=%d", token.Id), 0, nil)
			}
			before := market()
			require.Len(t, before["data"].([]any), 1)
			var result map[string]any
			switch action {
			case "website":
				result = upstreamControllerCall(t, ManageUpstreamAccountLifecycle, http.MethodDelete, "/", account.Id, map[string]any{"revision": 0})
			case "listing":
				result = upstreamControllerCall(t, DeleteAdminMarketListings, http.MethodDelete, "/", 0, map[string]any{"ids": []int{listing.Id}})
			default:
				result = upstreamControllerCall(t, SetUpstreamListingState, http.MethodPut, "/", source.Id, map[string]any{"revision": 0, "model": "example", "remove": action == "key-model-remove", "enabled": false})
			}
			require.Equal(t, true, result["success"], result["message"])
			assert.Empty(t, market()["data"].([]any))
			response := upstreamControllerCall(t, func(c *gin.Context) { c.Set("id", 7); GetTokenRoutes(c) }, http.MethodGet, "/", token.Id, nil)
			require.Equal(t, true, response["success"])
			assert.Empty(t, response["data"].(map[string]any)["routes"])
			require.NoError(t, db.First(&token, token.Id).Error)
			assert.Empty(t, token.GetRoutes())
			assert.Empty(t, buildMaskedTokenResponse(&token).Routes)
			// The stale browser selection must also be rejected by the write API.
			rejected := upstreamControllerCall(t, func(c *gin.Context) { c.Set("id", 7); AddTokenRoute(c) }, http.MethodPost, "/", token.Id, map[string]any{"model": "example", "channel_id": channel.Id, "listing_id": listing.Id})
			assert.Equal(t, false, rejected["success"])
		})
	}
}

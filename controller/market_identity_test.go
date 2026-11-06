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

func TestMarketUpstreamIdentityOnlyReturnedToAuthenticatedAdministrators(t *testing.T) {
	db := upstreamControllerDB(t)
	require.NoError(t, db.AutoMigrate(&model.MarketStat{}, &model.Model{}, &model.Vendor{}))
	channel := model.Channel{Id: 87, Name: "cc-asw", Type: 1, Status: common.ChannelStatusEnabled, Models: "identity-fixture"}
	require.NoError(t, db.Create(&channel).Error)
	account := model.UpstreamAccount{Name: "CCTQ", Website: "https://www.cctq.ai", Password: "private-password", BrowserSession: "private-session"}
	require.NoError(t, db.Create(&account).Error)
	require.NoError(t, db.Create(&model.UpstreamSource{AccountId: account.Id, ChannelId: channel.Id, Name: "upstream-key-name", BaseURL: account.Website, RelayKey: "private-key", KeyStatus: 1}).Error)
	listing := model.MarketListing{ChannelId: channel.Id, ModelName: "identity-fixture", Enabled: true, Ratio: 1, BillingMode: "fixed_expr", BillingExpr: `tier("base", p * 1 + c * 5)`, OriginalBillingExpr: `tier("base", p * 2 + c * 10)`}
	require.NoError(t, db.Create(&listing).Error)
	model.InvalidateMarketListings()
	for _, tt := range []struct {
		name     string
		id, role int
		visible  bool
	}{
		{"anonymous", 0, 0, false},
		{"role alone without authenticated identity", 0, common.RoleAdminUser, false},
		{"ordinary user", 2, common.RoleCommonUser, false},
		{"administrator", 1, common.RoleAdminUser, true},
		{"root administrator", 1, common.RoleRootUser, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			result := upstreamControllerCall(t, func(c *gin.Context) {
				c.Set("id", tt.id)
				c.Set("role", tt.role)
				GetMarketModels(c)
			}, http.MethodGet, "/api/market/models", 0, nil)
			require.Equal(t, true, result["success"])
			items := result["data"].([]any)
			require.Len(t, items, 1)
			channels := items[0].(map[string]any)["channels"].([]any)
			require.Len(t, channels, 1)
			row := channels[0].(map[string]any)
			assert.Equal(t, float64(listing.Id), row["listing_id"])
			if tt.visible {
				assert.Equal(t, channel.Name, row["channel_name"])
				assert.Equal(t, account.Name, row["website_name"])
			} else {
				assert.NotContains(t, row, "channel_name")
				assert.NotContains(t, row, "website_name")
			}
			assert.NotContains(t, row, "key")
		})
	}
	for _, tt := range []struct {
		name        string
		channelOnly bool
	}{
		{"manual Key uses the API hostname", false},
		{"legacy channel uses the API hostname", true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if tt.channelOnly {
				require.NoError(t, db.Where("channel_id = ?", channel.Id).Delete(&model.UpstreamSource{}).Error)
				require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", channel.Id).Update("base_url", "https://provider.example/v1").Error)
			} else {
				require.NoError(t, db.Model(&model.UpstreamSource{}).Where("channel_id = ?", channel.Id).Updates(map[string]any{"account_id": 0, "base_url": "https://provider.example/v1"}).Error)
			}
			result := upstreamControllerCall(t, func(c *gin.Context) {
				c.Set("id", 1)
				c.Set("role", common.RoleAdminUser)
				GetMarketModels(c)
			}, http.MethodGet, "/api/market/models", 0, nil)
			require.Equal(t, true, result["success"])
			items := result["data"].([]any)
			require.Len(t, items, 1)
			channels := items[0].(map[string]any)["channels"].([]any)
			require.Len(t, channels, 1)
			assert.Equal(t, "provider.example", channels[0].(map[string]any)["website_name"])
		})
	}
}

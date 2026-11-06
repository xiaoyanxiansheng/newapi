package controller

import (
	"net/http"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMarketClaudeMonitoringUsesListingRestrictionWithoutHidingAdminStats(t *testing.T) {
	db := upstreamControllerDB(t)
	require.NoError(t, db.AutoMigrate(&model.MarketStat{}))
	model.InvalidatePricingCache()
	t.Cleanup(model.InvalidatePricingCache)
	for _, channelID := range []int{71, 72} {
		require.NoError(t, db.Create(&model.Channel{Id: channelID, Type: 1, Status: common.ChannelStatusEnabled, Models: "claude-sonnet"}).Error)
		listing := model.MarketListing{ChannelId: channelID, ModelName: "claude-sonnet", Enabled: true, Ratio: 1, BillingMode: "fixed_expr", BillingExpr: `tier("base", p * 1 + c * 5)`, OriginalBillingExpr: `tier("base", p * 2 + c * 10)`, ProbeRequiresClaudeCode: channelID == 71}
		require.NoError(t, db.Create(&listing).Error)
		model.InvalidateMarketListings()
		model.ObserveMarketCall(channelID, listing.ModelName, false, 0, true)
	}
	require.NoError(t, model.FlushMarketStats())
	model.InvalidateMarketListings()
	result := upstreamControllerCall(t, GetMarketModels, http.MethodGet, "/api/market/models", 0, nil)
	require.Equal(t, true, result["success"])
	items := result["data"].([]any)
	require.Len(t, items, 1)
	channels := items[0].(map[string]any)["channels"].([]any)
	require.Len(t, channels, 2)
	for _, value := range channels {
		channel := value.(map[string]any)
		assert.Equal(t, channel["channel_id"] == float64(72), channel["monitoring_available"])
		assert.NotNil(t, channel["stats"], "display restriction must not remove actual statistics")
	}
	admin := upstreamControllerCall(t, GetAdminMarketListings, http.MethodGet, "/api/market/admin/listings", 0, nil)
	require.Equal(t, true, admin["success"])
	for _, value := range admin["data"].([]any) {
		assert.NotNil(t, value.(map[string]any)["stats"], "administrator keeps both channels' statistics")
	}
}

func TestMarketRealtimeInheritedStatesMatchAdminAndUserWithoutExtraSamples(t *testing.T) {
	db := upstreamControllerDB(t)
	require.NoError(t, db.AutoMigrate(&model.MarketStat{}))
	model.InvalidatePricingCache()
	t.Cleanup(model.InvalidatePricingCache)
	channel := model.Channel{Id: 73, Type: 1, Status: common.ChannelStatusEnabled, Models: "claude-sonnet"}
	require.NoError(t, db.Create(&channel).Error)
	listing := model.MarketListing{ChannelId: channel.Id, ModelName: channel.Models, Enabled: true, Ratio: 1,
		BillingMode: "fixed_expr", BillingExpr: `tier("base", p * 1 + c * 5)`, OriginalBillingExpr: `tier("base", p * 2 + c * 10)`}
	require.NoError(t, db.Create(&listing).Error)
	model.InvalidateMarketListings()
	now := time.Now().Unix() / model.MarketStatBucketSeconds
	rows := []model.MarketStat{
		{ChannelId: channel.Id, ModelName: listing.ModelName, Bucket: now - 6, SuccessCount: 1},
		{ChannelId: channel.Id, ModelName: listing.ModelName, Bucket: now - 3, FailCount: 1},
	}
	require.NoError(t, db.Create(&rows).Error)
	public := upstreamControllerCall(t, GetMarketModels, http.MethodGet, "/api/market/models", 0, nil)
	require.Equal(t, true, public["success"])
	models := public["data"].([]any)
	require.Len(t, models, 1)
	channels := models[0].(map[string]any)["channels"].([]any)
	require.Len(t, channels, 1)
	publicStats := channels[0].(map[string]any)["stats"].(map[string]any)
	assert.EqualValues(t, 2, publicStats["samples"])
	realtime := publicStats["realtime"].(map[string]any)
	assert.Equal(t, 0.5, realtime["rate"])
	blocks := realtime["blocks"].([]any)
	last := blocks[len(blocks)-1].(map[string]any)
	assert.Equal(t, 0.0, last["inherited_rate"])
	assert.EqualValues(t, 0, last["ok"])
	assert.EqualValues(t, 0, last["fail"])
	admin := upstreamControllerCall(t, GetAdminMarketListings, http.MethodGet, "/api/market/admin/listings", 0, nil)
	require.Equal(t, true, admin["success"])
	adminRows := admin["data"].([]any)
	require.Len(t, adminRows, 1)
	assert.Equal(t, publicStats, adminRows[0].(map[string]any)["stats"])
}

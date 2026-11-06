package model

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserLogsResolveHistoricalListingIDsAndStripRetryDetails(t *testing.T) {
	db := upstreamTestDB(t)
	require.NoError(t, db.AutoMigrate(&Log{}))
	previous := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previous })
	require.NoError(t, db.Create(&[]MarketListing{
		{Id: 101, ChannelId: 14, ModelName: "gemini-4-argon@s1c329"},
		{Id: 102, ChannelId: 22, ModelName: "gemini-4-argon"},
	}).Error)
	InvalidateMarketListings()
	// Insert historical rows directly: these predate the listing snapshot.
	require.NoError(t, db.Create(&[]Log{
		{UserId: 1, Type: LogTypeConsume, ChannelId: 14, ModelName: "gemini-4-argon", Quota: 33, Other: common.MapToJsonStr(map[string]interface{}{
			"upstream_model_name": "gemini-4-argon@s1c329",
			"admin_info":          map[string]interface{}{"use_channel": []string{"22", "14"}},
		})},
		{UserId: 1, Type: LogTypeConsume, ChannelId: 22, ModelName: "gemini-4-argon", Quota: 66},
	}).Error)
	logs, total, err := GetUserLogs(1, LogTypeConsume, 0, 0, "", "", 0, 10, "", "", "")
	require.NoError(t, err)
	require.Equal(t, int64(2), total)
	assert.Equal(t, 102, logs[0].MarketListingId)
	assert.Equal(t, 101, logs[1].MarketListingId)
	assert.Equal(t, 14, logs[1].ChannelId, "internal channel attribution must remain intact")
	assert.Equal(t, 33, logs[1].Quota, "identity enrichment must not alter billing")
	assert.NotContains(t, logs[1].Other, "admin_info")
	assert.Empty(t, logs[1].ChannelName)
	// Admin enrichment retains only listing IDs in the displayed retry chain.
	var original Log
	require.NoError(t, db.Where("channel_id = ?", 14).First(&original).Error)
	populateLogMarketIdentity([]*Log{&original})
	other, err := common.StrToMap(original.Other)
	require.NoError(t, err)
	assert.Equal(t, []interface{}{float64(102), float64(101)}, other["admin_info"].(map[string]interface{})["use_market_listings"])
}

func TestCreateLogFreezesSelectedSupplierIdentityThroughDeletion(t *testing.T) {
	db := upstreamTestDB(t)
	require.NoError(t, db.AutoMigrate(&Log{}))
	previous := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previous })
	listings := []MarketListing{
		{Id: 101, ChannelId: 14, ModelName: "gemini-4-argon@s1c329"},
		{Id: 103, ChannelId: 14, ModelName: "gemini-4-argon@s1c330"},
	}
	require.NoError(t, db.Create(&listings).Error)
	InvalidateMarketListings()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("market_selected_listing", listings[1])
	c.Set("market_used_listings", []string{"101", "103"})
	log := &Log{ChannelId: 14, ModelName: "gemini-4-argon", Type: LogTypeConsume, Other: `{"model_price":0.1}`}
	snapshotLogMarketIdentity(log, c)
	require.NoError(t, createLog(log))
	require.NoError(t, db.Delete(&listings[1]).Error)
	InvalidateMarketListings()
	var stored Log
	require.NoError(t, db.First(&stored, log.Id).Error)
	populateLogMarketIdentity([]*Log{&stored})
	assert.Equal(t, 103, stored.MarketListingId, "a historical request must keep the selected API Key ID")
	other, err := common.StrToMap(stored.Other)
	require.NoError(t, err)
	assert.Equal(t, 0.1, other["model_price"])
	assert.Equal(t, []interface{}{float64(101), float64(103)}, other["admin_info"].(map[string]interface{})["use_market_listings"])
}

func TestLogIdentityDoesNotGuessAmbiguousOrMismatchedSupplier(t *testing.T) {
	db := upstreamTestDB(t)
	require.NoError(t, db.Create(&[]MarketListing{
		{Id: 101, ChannelId: 14, ModelName: "gemini-4-argon@s1c329"},
		{Id: 103, ChannelId: 14, ModelName: "gemini-4-argon@s1c330"},
		{Id: 104, ChannelId: 14, ModelName: "gemini-4-argon"},
	}).Error)
	InvalidateMarketListings()
	assert.Zero(t, resolveLogMarketListing(14, "gemini-4-argon", ""))
	assert.Equal(t, 101, resolveLogMarketListing(14, "gemini-4-argon", "gemini-4-argon@s1c329"))
	assert.Zero(t, resolveLogMarketListing(22, "gemini-4-argon", "gemini-4-argon@s1c329"))
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("market_selected_listing", MarketListing{Id: 999, ChannelId: 22, ModelName: "gemini-4-argon"})
	log := &Log{ChannelId: 14, ModelName: "gemini-4-argon"}
	snapshotLogMarketIdentity(log, c)
	assert.Zero(t, log.MarketListingId, "a stale retry context cannot overwrite the actual route")
	// A new unresolved log must not acquire a different identity later.
	require.NoError(t, db.Where("id IN ?", []int{101, 103}).Delete(&MarketListing{}).Error)
	InvalidateMarketListings()
	populateLogMarketIdentity([]*Log{log})
	assert.Zero(t, log.MarketListingId)
}

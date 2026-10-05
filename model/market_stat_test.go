package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestBuildMarketStatSummariesWindowsAndAbnormal(t *testing.T) {
	now := int64(1_000_000)
	rows := []MarketStat{
		{ChannelId: 1, ModelName: "m", Bucket: now, SuccessCount: 1, FailCount: 0, LatencySumMs: 500, LatencyCount: 1, LastSuccessAt: 111},
		{ChannelId: 1, ModelName: "m", Bucket: now - 5, SuccessCount: 2, FailCount: 2, LatencySumMs: 3000, LatencyCount: 2, LastSuccessAt: 222},
		{ChannelId: 1, ModelName: "m", Bucket: now - 100, SuccessCount: 10, FailCount: 0},
		{ChannelId: 1, ModelName: "m", Bucket: now - marketWeekBuckets, SuccessCount: 99},
		{ChannelId: 2, ModelName: "m", Bucket: now - 1, SuccessCount: 0, FailCount: 5},
	}
	got := buildMarketStatSummaries(rows, now)

	s := got[listingKey{1, "m"}]
	require.NotNil(t, s)
	assert.Equal(t, 15, s.Samples, "bucket outside the 7 day window must be ignored")
	assert.Equal(t, int64(222), s.LastSuccessAt)
	assert.Equal(t, int64(1166), s.AvgLatencyMs, "(500+3000)/3 successful timed calls")
	require.Len(t, s.Realtime.Blocks, marketRealtimeBlocks)
	assert.Equal(t, MarketBlock{Ok: 1}, s.Realtime.Blocks[marketRealtimeBlocks-1])
	assert.Equal(t, MarketBlock{Ok: 2, Fail: 2}, s.Realtime.Blocks[marketRealtimeBlocks-1-5])
	require.NotNil(t, s.Realtime.Rate)
	assert.InDelta(t, 3.0/5.0, *s.Realtime.Rate, 1e-9)
	assert.False(t, s.Abnormal)
	require.Len(t, s.Day.Blocks, marketDayBlocks)
	require.Len(t, s.Week.Blocks, marketWeekBlocks)
	assert.Equal(t, 10, s.Day.Blocks[marketDayBlocks-1-int(100/marketDayBlockBuckets)].Ok)
	assert.Equal(t, 5, s.Week.Blocks[marketWeekBlocks-1].Ok+s.Week.Blocks[marketWeekBlocks-1].Fail)
	assert.Equal(t, 10, s.Week.Blocks[marketWeekBlocks-2].Ok)

	bad := got[listingKey{2, "m"}]
	require.NotNil(t, bad)
	assert.True(t, bad.Abnormal)
}

func TestFlushMarketStatsAccumulates(t *testing.T) {
	original := DB
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&MarketStat{}, &MarketListing{}))
	require.NoError(t, db.Create(&MarketListing{ChannelId: 7, ModelName: "flush-model", Ratio: 0.5, Enabled: true}).Error)
	DB = db
	InvalidateMarketListings()
	t.Cleanup(func() {
		DB = original
		InvalidateMarketListings()
		invalidateMarketStatSummary()
	})
	drainMarketStatPending()

	ObserveMarketCall(7, "flush-model", true, 400, false)
	ObserveMarketCall(7, "flush-model", false, 0, true)
	require.NoError(t, FlushMarketStats())
	ObserveMarketCall(7, "flush-model", true, 600, true)
	require.NoError(t, FlushMarketStats())

	var rows []MarketStat
	require.NoError(t, db.Find(&rows).Error)
	require.Len(t, rows, 1, "same bucket must be merged by the additive upsert")
	assert.Equal(t, 2, rows[0].SuccessCount)
	assert.Equal(t, 1, rows[0].FailCount)
	assert.Equal(t, int64(1000), rows[0].LatencySumMs)
	assert.Equal(t, 2, rows[0].LatencyCount)
	assert.NotZero(t, rows[0].LastSuccessAt)

	ObserveMarketCall(7, "unlisted-model", true, 100, false)
	assert.Nil(t, drainMarketStatPending(), "stats of unlisted pairs are ignored")

	assert.True(t, MarketListingHasRecentTraffic(7, "flush-model", 1_000_000_000))
	assert.False(t, MarketListingHasRecentTraffic(8, "flush-model", 1_000_000_000))
}

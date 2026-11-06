package model

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestBuildMarketStatSummariesWindowsAndAbnormal(t *testing.T) {
	now := int64(1_000_000)
	rows := []MarketStat{
		{ChannelId: 1, ModelName: "m", Bucket: now, SuccessCount: 1, FailCount: 0, LatencySumMs: 500, LatencyCount: 1, LastSuccessAt: 111, ProbeTokenSum: 69, ProbeTokenCount: 3},
		{ChannelId: 1, ModelName: "m", Bucket: now - 5, SuccessCount: 2, FailCount: 2, LatencySumMs: 3000, LatencyCount: 2, LastSuccessAt: 222},
		{ChannelId: 1, ModelName: "m", Bucket: now - 100, SuccessCount: 10, FailCount: 0},
		{ChannelId: 1, ModelName: "m", Bucket: now - marketWeekBuckets, SuccessCount: 99, ProbeTokenSum: 99999, ProbeTokenCount: 99},
		{ChannelId: 2, ModelName: "m", Bucket: now - 1, SuccessCount: 0, FailCount: 5},
	}
	got := buildMarketStatSummaries(rows, now)

	s := got[listingKey{1, "m"}]
	require.NotNil(t, s)
	assert.Equal(t, 15, s.Samples, "bucket outside the 7 day window must be ignored")
	assert.Equal(t, int64(222), s.LastSuccessAt)
	assert.Nil(t, s.ProbeUsage, "legacy hi probes cannot contribute to the new fixed-request profile")
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
	assert.Nil(t, bad.ProbeUsage, "another channel with no usage must not inherit the consumption grade")
}

func TestMarketRealtimeCarriesResultsUntilNextObservationWithoutInventingRequests(t *testing.T) {
	now := int64(1_000_000)
	rows := []MarketStat{
		{ChannelId: 1, ModelName: "m", Bucket: now - 3, SuccessCount: 2},
		{ChannelId: 1, ModelName: "m", Bucket: now - 9, SuccessCount: 1},
		{ChannelId: 1, ModelName: "m", Bucket: now - 6, FailCount: 1},
		{ChannelId: 2, ModelName: "m", Bucket: now - 6, FailCount: 1},
	}
	got := buildMarketStatSummaries(rows, now)
	summary := got[listingKey{1, "m"}]
	require.NotNil(t, summary)
	assert.Equal(t, 4, summary.Samples)
	assert.InDelta(t, 0.75, *summary.Realtime.Rate, 1e-9)
	assert.False(t, summary.Abnormal)
	for index, block := range summary.Realtime.Blocks {
		switch index {
		case 0, 1:
			assert.Nil(t, block.InheritedRate, "the time before the first test stays unknown")
		case 2, 5, 8:
			assert.Nil(t, block.InheritedRate, "actual observations keep their real counts")
		default:
			require.NotNil(t, block.InheritedRate, "gaps after an observation must retain its state")
			expected := 1.0
			if index == 6 || index == 7 {
				expected = 0
			}
			assert.Equal(t, expected, *block.InheritedRate)
			assert.Zero(t, block.Ok+block.Fail, "inherited colors must not invent requests")
		}
	}
	other := got[listingKey{2, "m"}]
	assert.False(t, other.Abnormal, "one failed test must not become multiple failures")
	for _, block := range other.Realtime.Blocks[6:] {
		require.NotNil(t, block.InheritedRate)
		assert.Zero(t, *block.InheritedRate, "different channels keep independent states")
	}
	for _, window := range []MarketWindow{summary.Day, summary.Week} {
		for _, block := range window.Blocks {
			assert.Nil(t, block.InheritedRate, "historical rates remain actual request statistics")
		}
	}
}

func TestMarketRealtimeUsesObservationBeforeWindowAndIgnoresUsageOnlyBuckets(t *testing.T) {
	now := int64(1_000_000)
	rows := []MarketStat{
		{ChannelId: 1, ModelName: "m", Bucket: now - 20, FailCount: 1},
		{ChannelId: 1, ModelName: "m", Bucket: now - 12, SuccessCount: 1},
		{ChannelId: 1, ModelName: "m", Bucket: now - 12, SuccessCount: 1, FailCount: 2},
		{ChannelId: 1, ModelName: "m", Bucket: now - 6, ProbeTokenSum: 23, ProbeTokenCount: 1},
		{ChannelId: 1, ModelName: "m", Bucket: now + 1, FailCount: 1},
		{ChannelId: 2, ModelName: "m", Bucket: now, ProbeTokenSum: 23, ProbeTokenCount: 1},
	}
	got := buildMarketStatSummaries(rows, now)
	summary := got[listingKey{1, "m"}]
	require.NotNil(t, summary)
	assert.Nil(t, summary.Realtime.Rate, "no real requests occurred in the realtime window")
	assert.Equal(t, 5, summary.Samples)
	for _, block := range summary.Realtime.Blocks {
		require.NotNil(t, block.InheritedRate)
		assert.Equal(t, 0.5, *block.InheritedRate)
		assert.Zero(t, block.Ok+block.Fail)
	}
	for _, block := range got[listingKey{2, "m"}].Realtime.Blocks {
		assert.Nil(t, block.InheritedRate, "usage alone cannot establish a monitoring result")
	}
}

func TestMarketRealtimeRetainsLastResultAfterHistoryExpiresAndCacheReloads(t *testing.T) {
	db := upstreamTestDB(t)
	require.NoError(t, db.AutoMigrate(&MarketStat{}, &MarketProbeUsageRecord{}))
	invalidateMarketStatSummary()
	t.Cleanup(invalidateMarketStatSummary)
	now := time.Now().Unix() / MarketStatBucketSeconds
	rows := []MarketStat{
		{ChannelId: 1, ModelName: "stopped", Bucket: now - marketWeekBuckets - 20, SuccessCount: 1},
		{ChannelId: 1, ModelName: "stopped", Bucket: now - marketWeekBuckets - 10, FailCount: 1},
		{ChannelId: 1, ModelName: "stopped", Bucket: now - marketWeekBuckets - 8, ProbeTokenSum: 23, ProbeTokenCount: 1},
		{ChannelId: 2, ModelName: "active", Bucket: now - marketWeekBuckets - 10, FailCount: 1},
		{ChannelId: 2, ModelName: "active", Bucket: now, SuccessCount: 1},
	}
	require.NoError(t, db.Create(&rows).Error)
	purgeOldMarketStats()
	var remaining []MarketStat
	require.NoError(t, db.Order("channel_id").Find(&remaining).Error)
	require.Len(t, remaining, 2, "keep only the most recent observation per channel after old history expires")
	assert.Equal(t, rows[1].Id, remaining[0].Id)
	assert.Equal(t, rows[4].Id, remaining[1].Id)
	for range 2 {
		invalidateMarketStatSummary()
		summary := GetMarketStatSummary(1, "stopped")
		require.NotNil(t, summary)
		assert.Zero(t, summary.Samples, "expired observations cannot inflate current statistics")
		assert.Nil(t, summary.Realtime.Rate)
		assert.Nil(t, summary.Day.Rate)
		assert.Nil(t, summary.Week.Rate)
		assert.False(t, summary.Abnormal)
		for _, block := range summary.Realtime.Blocks {
			require.NotNil(t, block.InheritedRate)
			assert.Zero(t, *block.InheritedRate)
			assert.Zero(t, block.Ok+block.Fail)
		}
	}
}

func TestMarketProbeClientRestrictionPersistsPerListingAndRecovers(t *testing.T) {
	original := DB
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&MarketListing{}))
	DB = db
	InvalidateMarketListings()
	t.Cleanup(func() {
		DB = original
		InvalidateMarketListings()
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	first := MarketListing{ChannelId: 7, ModelName: "claude-sonnet", Ratio: 0.5, Enabled: false, DefaultSuccess: true, Description: "Preserve description"}
	second := MarketListing{ChannelId: 8, ModelName: first.ModelName, Ratio: 0.7, Enabled: true}
	require.NoError(t, db.Create(&first).Error)
	require.NoError(t, db.Create(&second).Error)
	for _, keyword := range []string{fmt.Sprintf("id%05d", first.Id), fmt.Sprint(first.Id)} {
		rows, err := QueryMarketListings(0, keyword)
		require.NoError(t, err)
		require.Len(t, rows, 1)
		assert.Equal(t, first.Id, rows[0].Id)
	}
	require.NoError(t, SetMarketListingProbeRequiresClaudeCode(7, first.ModelName, true))
	InvalidateMarketListings() // Reload from storage, just as after a service restart.
	got := GetMarketListing(7, first.ModelName)
	require.NotNil(t, got)
	assert.True(t, got.ProbeRequiresClaudeCode)
	assert.False(t, got.Enabled)
	assert.True(t, got.DefaultSuccess)
	assert.Equal(t, first.Ratio, got.Ratio)
	assert.Equal(t, first.Description, got.Description)
	assert.False(t, GetMarketListing(8, first.ModelName).ProbeRequiresClaudeCode)
	require.NoError(t, SetMarketListingProbeRequiresClaudeCode(7, first.ModelName, false))
	assert.False(t, GetMarketListing(7, first.ModelName).ProbeRequiresClaudeCode)
}

func TestFlushMarketStatsAccumulates(t *testing.T) {
	original := DB
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&MarketStat{}, &MarketListing{}, &MarketProbeUsageRecord{}))
	require.NoError(t, db.Create(&MarketListing{ChannelId: 7, ModelName: "flush-model", Ratio: 0.5, Enabled: true}).Error)
	DB = db
	InvalidateMarketListings()
	t.Cleanup(func() {
		DB = original
		InvalidateMarketListings()
		invalidateMarketStatSummary()
	})
	drainMarketStatPending()
	invalidateMarketStatSummary()
	legacy := MarketStat{ChannelId: 7, ModelName: "flush-model", Bucket: time.Now().Unix() / MarketStatBucketSeconds}
	require.NoError(t, db.Create(&legacy).Error)
	require.NoError(t, db.Model(&legacy).Updates(map[string]any{"probe_token_sum": nil, "probe_token_count": nil, "probe_estimated_count": nil}).Error)

	ObserveMarketCall(7, "flush-model", true, 400, false)
	ObserveMarketCall(7, "flush-model", false, 0, true)
	ObserveMarketProbeUsage(7, "flush-model", 23, false)
	ObserveMarketProbeUsage(7, "flush-model", 0, false)
	tokens := int64(23)
	require.NoError(t, SaveMarketProbeUsage(&MarketProbeUsageRecord{ChannelId: 7, ModelName: "flush-model", Protocol: "openai", Success: true, TotalTokens: &tokens}))
	summary := GetMarketStatSummary(7, "flush-model")
	require.NotNil(t, summary, "pending calls must appear before the minute flush")
	assert.Equal(t, 2, summary.Samples)
	require.NotNil(t, summary.ProbeUsage)
	assert.Equal(t, int64(23), summary.ProbeUsage.TotalTokens)
	assert.Equal(t, 1, summary.ProbeUsage.Samples)
	assert.InDelta(t, 0.5, *summary.Realtime.Rate, 1e-9)
	require.NoError(t, FlushMarketStats())
	assert.Equal(t, 2, GetMarketStatSummary(7, "flush-model").Samples, "flush must not double count cached calls")
	ObserveMarketCall(7, "flush-model", true, 600, true)
	ObserveMarketProbeUsage(7, "flush-model", 46, true)
	require.NoError(t, SaveMarketProbeUsage(&MarketProbeUsageRecord{ChannelId: 7, ModelName: "flush-model", Protocol: "openai", Success: true}))
	require.NoError(t, FlushMarketStats())
	assert.Equal(t, 3, GetMarketStatSummary(7, "flush-model").Samples)
	usage := GetMarketStatSummary(7, "flush-model").ProbeUsage
	require.NotNil(t, usage)
	assert.Equal(t, int64(23), usage.TotalTokens)
	assert.Equal(t, 1, usage.Samples)
	assert.Zero(t, usage.EstimatedSamples)
	assert.Equal(t, 1, usage.UnknownSamples)
	assert.Equal(t, 23.0, usage.AverageTokens)

	var rows []MarketStat
	require.NoError(t, db.Find(&rows).Error)
	require.Len(t, rows, 1, "same bucket must be merged by the additive upsert")
	assert.Equal(t, 2, rows[0].SuccessCount)
	assert.Equal(t, 1, rows[0].FailCount)
	assert.Equal(t, int64(1000), rows[0].LatencySumMs)
	assert.Equal(t, 2, rows[0].LatencyCount)
	assert.NotZero(t, rows[0].LastSuccessAt)
	assert.Equal(t, int64(69), rows[0].ProbeTokenSum)
	assert.Equal(t, 2, rows[0].ProbeTokenCount)
	invalidateMarketStatSummary()
	assert.Equal(t, int64(23), GetMarketStatSummary(7, "flush-model").ProbeUsage.TotalTokens, "raw usage survives a cache reload without legacy estimates")

	ObserveMarketCall(7, "unlisted-model", true, 100, false)
	assert.Nil(t, drainMarketStatPending(), "stats of unlisted pairs are ignored")

	assert.True(t, MarketListingHasRecentTraffic(7, "flush-model", 1_000_000_000))
	assert.False(t, MarketListingHasRecentTraffic(8, "flush-model", 1_000_000_000))
}

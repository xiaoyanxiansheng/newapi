package model

import (
	"fmt"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMarketProbeRawSeriesSurvivesReloadWithoutMixingProtocolsOrProfiles(t *testing.T) {
	previous := DB
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&MarketStat{}, &MarketListing{}, &MarketProbeUsageRecord{}))
	DB = db
	drainMarketStatPending()
	InvalidateMarketListings()
	t.Cleanup(func() {
		DB = previous
		InvalidateMarketListings()
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	listing := MarketListing{ChannelId: 77, ModelName: "same-model", ProbeEndpoint: "openai-response"}
	require.NoError(t, db.Create(&listing).Error)
	now := time.Now().Unix()
	tokens := int64(4239)
	for i := 0; i < 3; i++ {
		require.NoError(t, SaveMarketProbeUsage(&MarketProbeUsageRecord{ChannelId: 77, ModelName: listing.ModelName, At: now - int64(i), Protocol: "openai-response", Success: true, TotalTokens: &tokens}))
	}
	require.NoError(t, SaveMarketProbeUsage(&MarketProbeUsageRecord{ChannelId: 77, ModelName: listing.ModelName, At: now, Protocol: "openai-response", Success: true}))
	require.NoError(t, SaveMarketProbeUsage(&MarketProbeUsageRecord{ChannelId: 77, ModelName: listing.ModelName, At: now, Protocol: "openai-response", Success: false, TotalTokens: &tokens}))
	for _, record := range []MarketProbeUsageRecord{
		{ChannelId: 77, ModelName: listing.ModelName, At: now, Profile: MarketProbeUsageProfile, Protocol: "anthropic", Success: true, TotalTokens: &tokens},
		{ChannelId: 77, ModelName: listing.ModelName, At: now, Profile: "hi-16-v0", Protocol: "openai-response", Success: true, TotalTokens: &tokens},
		{ChannelId: 77, ModelName: listing.ModelName, At: now - marketStatRetention - 1, Profile: MarketProbeUsageProfile, Protocol: "openai-response", Success: true, TotalTokens: &tokens},
	} {
		require.NoError(t, db.Create(&record).Error)
	}
	require.NoError(t, db.Create(&MarketStat{ChannelId: 77, ModelName: listing.ModelName, Bucket: now / MarketStatBucketSeconds, SuccessCount: 1, ProbeTokenSum: 999999, ProbeTokenCount: 99}).Error)
	InvalidateMarketListings()
	summary := GetMarketStatSummary(77, listing.ModelName)
	require.NotNil(t, summary)
	require.NotNil(t, summary.ProbeUsage)
	assert.Equal(t, int64(12717), summary.ProbeUsage.TotalTokens)
	assert.Equal(t, 3, summary.ProbeUsage.Samples)
	assert.Equal(t, 1, summary.ProbeUsage.UnknownSamples)
	assert.Equal(t, 4239.0, summary.ProbeUsage.AverageTokens)
	assert.Equal(t, 1, summary.Samples, "usage records do not duplicate state outcomes")
	require.Len(t, summary.ProbeUsage.Recent, 3)
	for _, record := range summary.ProbeUsage.Recent {
		assert.Equal(t, "openai-response", record.Protocol)
	}
}

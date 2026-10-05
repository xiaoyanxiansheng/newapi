package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func rate(v float64) *float64 { return &v }

func TestScoreMarketListingNeedsEnoughSamples(t *testing.T) {
	cache := 0.1
	s := ScoreMarketListing(0.2, &cache, &model.MarketStatSummary{Samples: 5, Week: model.MarketWindow{Rate: rate(1)}})
	assert.Equal(t, 80, s.Price)
	assert.Equal(t, 98, s.Cache)
	assert.Nil(t, s.Stability)
	assert.Nil(t, s.Speed)
	assert.Nil(t, s.Total)

	s = ScoreMarketListing(0.2, &cache, nil)
	assert.Nil(t, s.Total)
}

func TestScoreMarketListingTotalIsAverageOfFourAxes(t *testing.T) {
	cache := 0.1
	stats := &model.MarketStatSummary{
		Samples:      100,
		AvgLatencyMs: 4500,
		Week:         model.MarketWindow{Rate: rate(0.9)},
	}
	s := ScoreMarketListing(0.2, &cache, stats)
	require.NotNil(t, s.Stability)
	require.NotNil(t, s.Speed)
	require.NotNil(t, s.Total)
	assert.Equal(t, 90, *s.Stability)
	assert.Equal(t, 50, *s.Speed)
	assert.Equal(t, 80, s.Price)
	assert.Equal(t, 98, s.Cache)
	assert.Equal(t, 80, *s.Total, "(80+90+50+98)/4 = 79.5 rounds up")
}

func TestScoreMarketListingBounds(t *testing.T) {
	s := ScoreMarketListing(3, nil, &model.MarketStatSummary{Samples: 50, AvgLatencyMs: 60000, Week: model.MarketWindow{Rate: rate(0)}})
	assert.Equal(t, 0, s.Price)
	assert.Equal(t, 0, s.Cache, "no cache price scores zero")
	assert.Equal(t, 0, *s.Speed)
	assert.Equal(t, 0, *s.Stability)
	assert.Equal(t, 0, *s.Total)

	s = ScoreMarketListing(0, nil, &model.MarketStatSummary{Samples: 50, AvgLatencyMs: 200, Week: model.MarketWindow{Rate: rate(1)}})
	assert.Equal(t, 100, s.Price)
	assert.Equal(t, 100, *s.Speed)
}

func TestScoreMarketListingCapsAbnormalListings(t *testing.T) {
	cache := 0.1
	stats := &model.MarketStatSummary{
		Samples:      100,
		AvgLatencyMs: 1000,
		Abnormal:     true,
		Week:         model.MarketWindow{Rate: rate(0.98)},
	}
	s := ScoreMarketListing(0.2, &cache, stats)
	require.NotNil(t, s.Total)
	assert.Equal(t, 40, *s.Total)

	stats.Abnormal = false
	s = ScoreMarketListing(0.2, &cache, stats)
	assert.Greater(t, *s.Total, 40)
}

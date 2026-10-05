package service

import (
	"math"

	"github.com/QuantumNous/new-api/model"
)

// MarketScore is the four axis rating of one listing. Every axis is 0-100. Stability, speed and
// total are nil while the listing has too few requests to judge.
type MarketScore struct {
	Price     int  `json:"price"`
	Stability *int `json:"stability"`
	Speed     *int `json:"speed"`
	Cache     int  `json:"cache"`
	Total     *int `json:"total"`
}

const (
	// A listing that is failing right now must not rank near the top on its week average.
	abnormalScoreCap = 40
	speedBestMs      = 1000.0
	speedWorstMs     = 8000.0
)

func clampScore(v float64) int {
	if math.IsNaN(v) {
		return 0
	}
	return int(math.Round(math.Max(0, math.Min(100, v))))
}

// ScoreMarketListing rates a listing. ratio is the listing ratio, cacheRatio the model's cache read
// ratio (nil when the model has no cache price). stats may be nil.
func ScoreMarketListing(ratio float64, cacheRatio *float64, stats *model.MarketStatSummary) MarketScore {
	score := MarketScore{
		// Price: the deeper the discount against the official price (ratio 1), the higher.
		Price: clampScore(100 * (1 - ratio)),
	}
	if cacheRatio != nil {
		score.Cache = clampScore(100 * (1 - *cacheRatio*ratio))
	}
	if stats == nil || stats.Samples < model.MarketStatMinSamples {
		return score
	}

	if stats.Week.Rate != nil {
		v := clampScore(*stats.Week.Rate * 100)
		score.Stability = &v
	}
	speed := 100.0
	if stats.AvgLatencyMs > 0 {
		speed = 100 * (speedWorstMs - float64(stats.AvgLatencyMs)) / (speedWorstMs - speedBestMs)
	}
	speedScore := clampScore(speed)
	score.Speed = &speedScore

	if score.Stability != nil {
		total := clampScore(float64(score.Price+*score.Stability+speedScore+score.Cache) / 4)
		if stats.Abnormal && total > abnormalScoreCap {
			total = abnormalScoreCap
		}
		score.Total = &total
	}
	return score
}

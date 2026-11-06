package service

import (
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/model"
)

var billingPriceTerm = regexp.MustCompile(`(?i)(?:^|[^a-z0-9_])(p|cr)\s*\*\s*([0-9]+(?:\.[0-9]+)?)|([0-9]+(?:\.[0-9]+)?)\s*\*\s*(p|cr)(?:[^a-z0-9_]|$)`)

// CacheRatioFromBillingExpr recovers a cache-read/input price ratio from a
// stored billing contract when the legacy ratio table has no cache entry.
func CacheRatioFromBillingExpr(expression string) *float64 {
	if strings.TrimSpace(expression) == "" {
		return nil
	}
	var input, cache float64
	var hasInput, hasCache bool
	for _, match := range billingPriceTerm.FindAllStringSubmatch(expression, -1) {
		name, value := match[1], match[2]
		if name == "" {
			name, value = match[4], match[3]
		}
		n, err := strconv.ParseFloat(value, 64)
		if err != nil || n < 0 {
			continue
		}
		switch strings.ToLower(name) {
		case "p":
			if !hasInput {
				input, hasInput = n, true
			}
		case "cr":
			if !hasCache {
				cache, hasCache = n, true
			}
		}
	}
	if !hasInput || !hasCache || input <= 0 {
		return nil
	}
	ratio := cache / input
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 {
		return nil
	}
	return &ratio
}

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

// MarketModelMonitorable mirrors the background probe's eligibility rules.
// Claude chat models are valid targets; image/audio/video endpoints are not.
func MarketModelMonitorable(modelName string, pricing model.Pricing) bool {
	if pricing.QuotaType != 0 {
		return false
	}
	lower := strings.ToLower(modelName)
	for _, keyword := range []string{"image", "dall-e", "sora", "video", "veo", "kling", "seedance", "seedream", "midjourney", "flux", "suno", "tts", "whisper", "audio", "realtime", "vidu", "jimeng"} {
		if strings.Contains(lower, keyword) {
			return false
		}
	}
	return true
}

var claudeCodeClientRestriction = regexp.MustCompile(`(?i)(?:must\s+use|please\s+use|requires?\s+(?:using\s+)?|only\s+(?:supports?|allows?|accepts?))\s+(?:(?:a|an|the|standard|official)\s+)*(?:claude[\s_-]*code|cc)\s+clients?\b|only\s+(?:(?:a|an|the|standard|official)\s+)*(?:claude[\s_-]*code|cc)\s+clients?\s+(?:are|is)\s+(?:allowed|supported|accepted)`)

// ClaudeCodeClientRequired recognizes explicit upstream client restrictions,
// not generic Claude failures or a price group that happens to contain CC.
func ClaudeCodeClientRequired(modelName, message string) bool {
	if !strings.Contains(strings.ToLower(modelName), "claude") {
		return false
	}
	if claudeCodeClientRestriction.MatchString(message) {
		return true
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(message), ""))
	for _, prefix := range []string{"必须使用", "请使用", "仅支持", "只支持", "仅允许", "只能使用"} {
		for _, client := range []string{"claudecode", "cc"} {
			for _, qualifier := range []string{"", "标准", "官方"} {
				if strings.Contains(normalized, prefix+qualifier+client+"客户端") {
					return true
				}
			}
		}
	}
	return false
}

// MarketListingMonitoringAvailable is a display rule distinct from automatic
// probe eligibility: ordinary Claude errors remain visible to users.
func MarketListingMonitoringAvailable(listing *model.MarketListing, pricing model.Pricing) bool {
	if pricing.QuotaType != 0 || listing.BillingMode == "fixed_request" {
		return false
	}
	if strings.Contains(strings.ToLower(listing.ModelName), "claude") {
		return !listing.ProbeRequiresClaudeCode
	}
	return MarketModelMonitorable(listing.ModelName, pricing)
}

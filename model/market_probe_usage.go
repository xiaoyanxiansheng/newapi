package model

import "time"

// Changing the request profile starts a new comparable series. Legacy hi probes
// and locally estimated usage must never contribute to this series.
const MarketProbeUsageProfile = "ok-256-stream-v1"

type MarketProbeUsageRecord struct {
	Id               int    `json:"id"`
	ChannelId        int    `json:"-" gorm:"index:idx_probe_usage_listing,priority:1"`
	ModelName        string `json:"-" gorm:"type:varchar(255);index:idx_probe_usage_listing,priority:2"`
	At               int64  `json:"at" gorm:"bigint;index"`
	Profile          string `json:"profile" gorm:"type:varchar(64)"`
	Protocol         string `json:"protocol" gorm:"type:varchar(64)"`
	Success          bool   `json:"success"`
	OutputLimited    bool   `json:"output_limited"`
	InputTokens      *int64 `json:"input_tokens" gorm:"bigint"`
	OutputTokens     *int64 `json:"output_tokens" gorm:"bigint"`
	CacheReadTokens  *int64 `json:"cache_read_tokens" gorm:"bigint"`
	CacheWriteTokens *int64 `json:"cache_write_tokens" gorm:"bigint"`
	ReasoningTokens  *int64 `json:"reasoning_tokens" gorm:"bigint"`
	TotalTokens      *int64 `json:"total_tokens" gorm:"bigint"`
	TotalSource      string `json:"total_source" gorm:"type:varchar(32)"`
	// Only numeric usage fields are stored, never response content or credentials.
	RawUsage string `json:"-" gorm:"type:text"`
}

func SaveMarketProbeUsage(record *MarketProbeUsageRecord) error {
	if record == nil || record.ChannelId <= 0 || record.ModelName == "" {
		return nil
	}
	if record.At == 0 {
		record.At = time.Now().Unix()
	}
	record.Profile = MarketProbeUsageProfile
	err := DB.Create(record).Error
	if err == nil {
		invalidateMarketStatSummary()
	}
	return err
}

// Each protocol is its own series, even when a listing changes test endpoints.
// All attempts remain available as records; the grade uses successful, known totals.
func applyMarketProbeUsageRecords(summaries map[listingKey]*MarketStatSummary, records []MarketProbeUsageRecord) {
	for _, record := range records {
		key := listingKey{record.ChannelId, record.ModelName}
		summary := summaries[key]
		if summary == nil {
			summary = &MarketStatSummary{Realtime: newWindow(marketRealtimeBlocks), Day: newWindow(marketDayBlocks), Week: newWindow(marketWeekBlocks)}
			summaries[key] = summary
		}
		if summary.ProbeUsage == nil {
			summary.ProbeUsage = &MarketProbeUsageSummary{Profile: MarketProbeUsageProfile, Protocol: record.Protocol, Recent: []MarketProbeUsageRecord{}}
		}
		usage := summary.ProbeUsage
		if record.Protocol != usage.Protocol {
			continue
		}
		if len(usage.Recent) < 3 {
			usage.Recent = append(usage.Recent, record)
		}
		if !record.Success {
			continue
		}
		if record.TotalTokens == nil {
			usage.UnknownSamples++
			continue
		}
		usage.Samples++
		usage.TotalTokens += *record.TotalTokens
	}
	for _, summary := range summaries {
		if usage := summary.ProbeUsage; usage != nil && usage.Samples > 0 {
			usage.AverageTokens = float64(usage.TotalTokens) / float64(usage.Samples)
		}
	}
}

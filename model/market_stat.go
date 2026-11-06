package model

import (
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// MarketStat holds request outcomes of one (channel, model) listing inside one 10 minute bucket.
// Rows come from real user calls and probes. Seven days contribute to rates;
// the last observation is retained beyond that only as a realtime display seed.
type MarketStat struct {
	Id                  int    `json:"id"`
	ChannelId           int    `json:"channel_id" gorm:"not null;uniqueIndex:idx_market_stat_bucket,priority:1"`
	ModelName           string `json:"model_name" gorm:"type:varchar(255);not null;uniqueIndex:idx_market_stat_bucket,priority:2"`
	Bucket              int64  `json:"bucket" gorm:"bigint;not null;uniqueIndex:idx_market_stat_bucket,priority:3;index"`
	SuccessCount        int    `json:"success_count"`
	FailCount           int    `json:"fail_count"`
	LatencySumMs        int64  `json:"latency_sum_ms" gorm:"bigint"`
	LatencyCount        int    `json:"latency_count"`
	LastSuccessAt       int64  `json:"last_success_at" gorm:"bigint"`
	ProbeTokenSum       int64  `json:"probe_token_sum" gorm:"bigint"`
	ProbeTokenCount     int    `json:"probe_token_count"`
	ProbeEstimatedCount int    `json:"probe_estimated_count"`
}

const (
	MarketStatBucketSeconds = 600
	marketStatRetention     = 7 * 24 * 3600
	marketStatFlushEvery    = time.Minute
	marketStatSummaryTTL    = 30 * time.Second
	marketStatMinSamples    = 20

	marketRealtimeBlocks  = 12
	marketDayBlocks       = 12
	marketDayBlockBuckets = 12
	marketWeekBlocks      = 14
	marketWeekBlockSpan   = 72
	marketWeekBuckets     = marketWeekBlocks * marketWeekBlockSpan
)

// MarketStatMinSamples is the number of requests in 7 days below which stability and speed are not scored.
const MarketStatMinSamples = marketStatMinSamples

type statDelta struct {
	success             int
	fail                int
	latencySumMs        int64
	latencyCount        int
	lastSuccessAt       int64
	probeTokenSum       int64
	probeTokenCount     int
	probeEstimatedCount int
}

type statKey struct {
	channelId int
	model     string
	bucket    int64
}

var marketStatPending struct {
	sync.Mutex
	deltas      map[statKey]*statDelta
	lastTraffic map[listingKey]int64
	lastProbe   map[listingKey]MarketProbeResult
}

// Coordinates database snapshots and flushes so pending outcomes are counted exactly once.
var marketStatSnapshotMu sync.Mutex

func init() {
	marketStatPending.deltas = make(map[statKey]*statDelta)
	marketStatPending.lastTraffic = make(map[listingKey]int64)
	marketStatPending.lastProbe = make(map[listingKey]MarketProbeResult)
}

// MarketProbeResult is the latest probe outcome of a listing. It is kept in memory only.
type MarketProbeResult struct {
	At              int64  `json:"at"`
	OK              bool   `json:"ok"`
	LatencyMs       int64  `json:"latency_ms"`
	Error           string `json:"error,omitempty"`
	Tokens          int64  `json:"tokens,omitempty"`
	TokensEstimated bool   `json:"tokens_estimated,omitempty"`
}

// ObserveMarketProbeUsage adds only successful, standardized probe usage. User traffic
// has arbitrary prompt lengths and must not affect the channel comparison.
func ObserveMarketProbeUsage(channelId int, modelName string, tokens int64, estimated bool) {
	if tokens <= 0 || tokens > 1_000_000_000 || channelId <= 0 || GetMarketListing(channelId, modelName) == nil {
		return
	}
	key := statKey{channelId: channelId, model: modelName, bucket: time.Now().Unix() / MarketStatBucketSeconds}
	marketStatPending.Lock()
	d := marketStatPending.deltas[key]
	if d == nil {
		d = &statDelta{}
		marketStatPending.deltas[key] = d
	}
	d.probeTokenSum += tokens
	d.probeTokenCount++
	if estimated {
		d.probeEstimatedCount++
	}
	marketStatPending.Unlock()
	invalidateMarketStatSummary()
}

// ObserveMarketCall records one request outcome. fromProbe marks synthetic probe traffic, which does not
// count as user traffic when deciding whether a probe can be skipped.
func ObserveMarketCall(channelId int, modelName string, ok bool, latencyMs int64, fromProbe bool) {
	if channelId <= 0 || modelName == "" || GetMarketListing(channelId, modelName) == nil {
		return
	}
	now := time.Now().Unix()
	key := statKey{channelId: channelId, model: modelName, bucket: now / MarketStatBucketSeconds}

	marketStatPending.Lock()
	d := marketStatPending.deltas[key]
	if d == nil {
		d = &statDelta{}
		marketStatPending.deltas[key] = d
	}
	if ok {
		d.success++
		d.lastSuccessAt = now
		if latencyMs > 0 {
			d.latencySumMs += latencyMs
			d.latencyCount++
		}
	} else {
		d.fail++
	}
	if !fromProbe {
		marketStatPending.lastTraffic[listingKey{channelId, modelName}] = now
	}
	marketStatPending.Unlock()
	invalidateMarketStatSummary()
}

// MarketListingHasRecentTraffic reports whether real users called the listing within the window.
func MarketListingHasRecentTraffic(channelId int, modelName string, window time.Duration) bool {
	marketStatPending.Lock()
	defer marketStatPending.Unlock()
	at, ok := marketStatPending.lastTraffic[listingKey{channelId, modelName}]
	return ok && time.Since(time.Unix(at, 0)) < window
}

func SetMarketProbeResult(channelId int, modelName string, result MarketProbeResult) {
	marketStatPending.Lock()
	marketStatPending.lastProbe[listingKey{channelId, modelName}] = result
	marketStatPending.Unlock()
}

func GetMarketProbeResult(channelId int, modelName string) (MarketProbeResult, bool) {
	marketStatPending.Lock()
	defer marketStatPending.Unlock()
	r, ok := marketStatPending.lastProbe[listingKey{channelId, modelName}]
	return r, ok
}

func drainMarketStatPending() map[statKey]*statDelta {
	marketStatPending.Lock()
	defer marketStatPending.Unlock()
	if len(marketStatPending.deltas) == 0 {
		return nil
	}
	drained := marketStatPending.deltas
	marketStatPending.deltas = make(map[statKey]*statDelta)
	return drained
}

// FlushMarketStats writes the in-memory counters to the database as additive upserts.
func FlushMarketStats() error {
	marketStatSnapshotMu.Lock()
	defer marketStatSnapshotMu.Unlock()
	drained := drainMarketStatPending()
	if len(drained) == 0 {
		return nil
	}
	var firstErr error
	for key, d := range drained {
		row := &MarketStat{
			ChannelId:           key.channelId,
			ModelName:           key.model,
			Bucket:              key.bucket,
			SuccessCount:        d.success,
			FailCount:           d.fail,
			LatencySumMs:        d.latencySumMs,
			LatencyCount:        d.latencyCount,
			LastSuccessAt:       d.lastSuccessAt,
			ProbeTokenSum:       d.probeTokenSum,
			ProbeTokenCount:     d.probeTokenCount,
			ProbeEstimatedCount: d.probeEstimatedCount,
		}
		err := DB.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "channel_id"}, {Name: "model_name"}, {Name: "bucket"}},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"success_count":         gorm.Expr("market_stats.success_count + ?", d.success),
				"fail_count":            gorm.Expr("market_stats.fail_count + ?", d.fail),
				"latency_sum_ms":        gorm.Expr("market_stats.latency_sum_ms + ?", d.latencySumMs),
				"latency_count":         gorm.Expr("market_stats.latency_count + ?", d.latencyCount),
				"probe_token_sum":       gorm.Expr("COALESCE(market_stats.probe_token_sum, 0) + ?", d.probeTokenSum),
				"probe_token_count":     gorm.Expr("COALESCE(market_stats.probe_token_count, 0) + ?", d.probeTokenCount),
				"probe_estimated_count": gorm.Expr("COALESCE(market_stats.probe_estimated_count, 0) + ?", d.probeEstimatedCount),
				"last_success_at":       gorm.Expr("CASE WHEN market_stats.last_success_at < ? THEN ? ELSE market_stats.last_success_at END", d.lastSuccessAt, d.lastSuccessAt),
			}),
		}).Create(row).Error
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			marketStatPending.Lock()
			next := marketStatPending.deltas[key]
			if next == nil {
				next = &statDelta{}
				marketStatPending.deltas[key] = next
			}
			next.success += d.success
			next.fail += d.fail
			next.latencySumMs += d.latencySumMs
			next.latencyCount += d.latencyCount
			next.probeTokenSum += d.probeTokenSum
			next.probeTokenCount += d.probeTokenCount
			next.probeEstimatedCount += d.probeEstimatedCount
			if d.lastSuccessAt > next.lastSuccessAt {
				next.lastSuccessAt = d.lastSuccessAt
			}
			marketStatPending.Unlock()
		}
	}
	invalidateMarketStatSummary()
	return firstErr
}

func purgeOldMarketStats() {
	cutoff := time.Now().Unix()/MarketStatBucketSeconds - marketStatRetention/MarketStatBucketSeconds - 6
	latest := DB.Model(&MarketStat{}).Select("channel_id, model_name, MAX(bucket)").
		Where("bucket <= ? AND (success_count > 0 OR fail_count > 0)", time.Now().Unix()/MarketStatBucketSeconds).
		Group("channel_id, model_name")
	var retainedIDs []int
	if err := DB.Model(&MarketStat{}).Where("bucket < ?", cutoff).
		Where("(channel_id, model_name, bucket) IN (?)", latest).Pluck("id", &retainedIDs).Error; err != nil {
		common.SysError("load last market observations failed: " + err.Error())
		return
	}
	// Select retained IDs separately so deletes also work on MySQL, which disallows
	// reading the deletion target in a direct subquery.
	expired := DB.Where("bucket < ?", cutoff)
	if len(retainedIDs) > 0 {
		expired = expired.Where("id NOT IN ?", retainedIDs)
	}
	if err := expired.Delete(&MarketStat{}).Error; err != nil {
		common.SysError("purge market stats failed: " + err.Error())
	}
	if err := DB.Where("at < ?", time.Now().Unix()-marketStatRetention).Delete(&MarketProbeUsageRecord{}).Error; err != nil {
		common.SysError("purge market probe usage failed: " + err.Error())
	}
}

// StartMarketStatFlusher flushes counters every minute and purges expired buckets hourly.
func StartMarketStatFlusher() {
	go func() {
		purgeTick := 0
		for {
			time.Sleep(marketStatFlushEvery)
			if err := FlushMarketStats(); err != nil {
				common.SysError("flush market stats failed: " + err.Error())
			}
			purgeTick++
			if purgeTick >= 60 {
				purgeTick = 0
				purgeOldMarketStats()
			}
		}
	}()
}

// MarketBlock is the aggregated outcome of one time slice.
type MarketBlock struct {
	Ok   int `json:"ok"`
	Fail int `json:"fail"`
	// Display-only state for an empty realtime slice; never adds request counts.
	InheritedRate *float64 `json:"inherited_rate,omitempty"`
}

type MarketWindow struct {
	Blocks []MarketBlock `json:"blocks"`
	Rate   *float64      `json:"rate"`
}

// MarketStatSummary is the monitoring view of one listing.
type MarketStatSummary struct {
	ProbeUsage    *MarketProbeUsageSummary `json:"probe_usage"`
	Realtime      MarketWindow             `json:"realtime"`
	Day           MarketWindow             `json:"day"`
	Week          MarketWindow             `json:"week"`
	LastSuccessAt int64                    `json:"last_success_at"`
	Samples       int                      `json:"samples"`
	AvgLatencyMs  int64                    `json:"avg_latency_ms"`
	// Abnormal is true when the last two hours show a clearly failing listing.
	Abnormal bool `json:"abnormal"`
}

// MarketProbeUsageSummary covers the same rolling seven days as status statistics.
type MarketProbeUsageSummary struct {
	Profile          string                   `json:"profile"`
	Protocol         string                   `json:"protocol"`
	UnknownSamples   int                      `json:"unknown_samples"`
	Recent           []MarketProbeUsageRecord `json:"recent"`
	TotalTokens      int64                    `json:"total_tokens"`
	Samples          int                      `json:"samples"`
	EstimatedSamples int                      `json:"estimated_samples"`
	AverageTokens    float64                  `json:"average_tokens"`
}

var marketStatSummaryCache struct {
	sync.RWMutex
	data       map[listingKey]*MarketStatSummary
	loadedAt   time.Time
	refreshing bool
}

func invalidateMarketStatSummary() {
	marketStatSummaryCache.Lock()
	marketStatSummaryCache.loadedAt = time.Time{}
	marketStatSummaryCache.data = nil
	marketStatSummaryCache.Unlock()
}

func newWindow(n int) MarketWindow {
	return MarketWindow{Blocks: make([]MarketBlock, n)}
}

func finishWindow(w *MarketWindow) {
	var ok, fail int
	for _, b := range w.Blocks {
		ok += b.Ok
		fail += b.Fail
	}
	if ok+fail > 0 {
		rate := float64(ok) / float64(ok+fail)
		w.Rate = &rate
	}
}

func buildMarketStatSummaries(rows []MarketStat, nowBucket int64) map[listingKey]*MarketStatSummary {
	out := make(map[listingKey]*MarketStatSummary)
	latencySum := make(map[listingKey]int64)
	latencyCnt := make(map[listingKey]int)
	previousRealtime := make(map[listingKey]MarketStat)
	for i := range rows {
		r := &rows[i]
		k := listingKey{r.ChannelId, r.ModelName}
		s := out[k]
		if s == nil {
			s = &MarketStatSummary{
				Realtime: newWindow(marketRealtimeBlocks),
				Day:      newWindow(marketDayBlocks),
				Week:     newWindow(marketWeekBlocks),
			}
			out[k] = s
		}
		age := nowBucket - r.Bucket
		if age < 0 {
			continue
		}
		if age >= marketRealtimeBlocks && r.SuccessCount+r.FailCount > 0 {
			previous, exists := previousRealtime[k]
			if !exists || r.Bucket > previous.Bucket {
				previousRealtime[k] = *r
			} else if r.Bucket == previous.Bucket {
				previous.SuccessCount += r.SuccessCount
				previous.FailCount += r.FailCount
				previousRealtime[k] = previous
			}
		}
		if r.LastSuccessAt > s.LastSuccessAt {
			s.LastSuccessAt = r.LastSuccessAt
		}
		if age >= marketWeekBuckets {
			continue
		}
		s.Samples += r.SuccessCount + r.FailCount
		latencySum[k] += r.LatencySumMs
		latencyCnt[k] += r.LatencyCount
		weekIdx := marketWeekBlocks - 1 - int(age/marketWeekBlockSpan)
		s.Week.Blocks[weekIdx].Ok += r.SuccessCount
		s.Week.Blocks[weekIdx].Fail += r.FailCount
		if age < marketDayBlocks*marketDayBlockBuckets {
			dayIdx := marketDayBlocks - 1 - int(age/marketDayBlockBuckets)
			s.Day.Blocks[dayIdx].Ok += r.SuccessCount
			s.Day.Blocks[dayIdx].Fail += r.FailCount
		}
		if age < marketRealtimeBlocks {
			rtIdx := marketRealtimeBlocks - 1 - int(age)
			s.Realtime.Blocks[rtIdx].Ok += r.SuccessCount
			s.Realtime.Blocks[rtIdx].Fail += r.FailCount
		}
	}
	for k, s := range out {
		if s.ProbeUsage != nil && s.ProbeUsage.Samples > 0 {
			s.ProbeUsage.AverageTokens = float64(s.ProbeUsage.TotalTokens) / float64(s.ProbeUsage.Samples)
		}
		finishWindow(&s.Realtime)
		finishWindow(&s.Day)
		finishWindow(&s.Week)
		// Carry the last observed slice into empty realtime slices. Keep real
		// counts/rates intact so held colors never inflate success or failure totals.
		var previousRate *float64
		if previous, exists := previousRealtime[k]; exists {
			rate := float64(previous.SuccessCount) / float64(previous.SuccessCount+previous.FailCount)
			previousRate = &rate
		}
		for index := range s.Realtime.Blocks {
			block := &s.Realtime.Blocks[index]
			if block.Ok+block.Fail > 0 {
				rate := float64(block.Ok) / float64(block.Ok+block.Fail)
				previousRate = &rate
			} else {
				block.InheritedRate = previousRate
			}
		}
		if latencyCnt[k] > 0 {
			s.AvgLatencyMs = latencySum[k] / int64(latencyCnt[k])
		}
		if s.Realtime.Rate != nil {
			var ok, fail int
			for _, b := range s.Realtime.Blocks {
				ok += b.Ok
				fail += b.Fail
			}
			s.Abnormal = ok+fail >= 3 && *s.Realtime.Rate < 0.5
		}
	}
	return out
}

func loadMarketStatSummaries() (map[listingKey]*MarketStatSummary, error) {
	marketStatSnapshotMu.Lock()
	defer marketStatSnapshotMu.Unlock()
	nowBucket := time.Now().Unix() / MarketStatBucketSeconds
	var rows []MarketStat
	latest := DB.Model(&MarketStat{}).Select("channel_id, model_name, MAX(bucket)").
		Where("bucket <= ? AND (success_count > 0 OR fail_count > 0)", nowBucket).
		Group("channel_id, model_name")
	if err := DB.Where("bucket > ? OR (channel_id, model_name, bucket) IN (?)", nowBucket-marketWeekBuckets, latest).Find(&rows).Error; err != nil {
		return nil, err
	}
	marketStatPending.Lock()
	for key, d := range marketStatPending.deltas {
		rows = append(rows, MarketStat{ChannelId: key.channelId, ModelName: key.model, Bucket: key.bucket,
			SuccessCount: d.success, FailCount: d.fail, LatencySumMs: d.latencySumMs,
			LatencyCount: d.latencyCount, LastSuccessAt: d.lastSuccessAt, ProbeTokenSum: d.probeTokenSum,
			ProbeTokenCount: d.probeTokenCount, ProbeEstimatedCount: d.probeEstimatedCount})
	}
	marketStatPending.Unlock()
	summaries := buildMarketStatSummaries(rows, nowBucket)
	var records []MarketProbeUsageRecord
	if err := DB.Where("at >= ? AND profile = ?", time.Now().Unix()-marketStatRetention, MarketProbeUsageProfile).Order("at desc, id desc").Find(&records).Error; err != nil {
		return nil, err
	}
	selected := make(map[listingKey]string)
	for _, listing := range GetAllMarketListingsCached() {
		selected[listingKey{listing.ChannelId, listing.ModelName}] = listing.ProbeEndpoint
	}
	filtered := records[:0]
	for _, record := range records {
		if endpoint := selected[listingKey{record.ChannelId, record.ModelName}]; endpoint == "" || endpoint == record.Protocol {
			filtered = append(filtered, record)
		}
	}
	applyMarketProbeUsageRecords(summaries, filtered)
	return summaries, nil
}

// ensureMarketStatSummaries serves the cached summaries. A stale cache is returned immediately and
// refreshed in the background, so page requests never wait for the 7 day scan; only the very first
// call after a restart loads synchronously.
func ensureMarketStatSummaries() map[listingKey]*MarketStatSummary {
	marketStatSummaryCache.Lock()
	data := marketStatSummaryCache.data
	fresh := data != nil && time.Since(marketStatSummaryCache.loadedAt) < marketStatSummaryTTL
	if fresh || (data != nil && marketStatSummaryCache.refreshing) {
		marketStatSummaryCache.Unlock()
		return data
	}
	marketStatSummaryCache.refreshing = true
	marketStatSummaryCache.Unlock()

	refresh := func() map[listingKey]*MarketStatSummary {
		loaded, err := loadMarketStatSummaries()
		marketStatSummaryCache.Lock()
		defer marketStatSummaryCache.Unlock()
		marketStatSummaryCache.refreshing = false
		if err != nil {
			common.SysError("load market stats failed: " + err.Error())
			return marketStatSummaryCache.data
		}
		marketStatSummaryCache.data = loaded
		marketStatSummaryCache.loadedAt = time.Now()
		return loaded
	}
	if data == nil {
		if loaded := refresh(); loaded != nil {
			return loaded
		}
		return map[listingKey]*MarketStatSummary{}
	}
	go refresh()
	return data
}

// GetMarketStatSummary returns the monitoring summary of a listing, or nil when it never saw a request.
func GetMarketStatSummary(channelId int, modelName string) *MarketStatSummary {
	return ensureMarketStatSummaries()[listingKey{channelId, modelName}]
}

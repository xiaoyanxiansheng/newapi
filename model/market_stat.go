package model

import (
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// MarketStat holds request outcomes of one (channel, model) listing inside one 10 minute bucket.
// Rows come from real user calls and from the background probe, and are kept for 7 days.
type MarketStat struct {
	Id            int    `json:"id"`
	ChannelId     int    `json:"channel_id" gorm:"not null;uniqueIndex:idx_market_stat_bucket,priority:1"`
	ModelName     string `json:"model_name" gorm:"type:varchar(255);not null;uniqueIndex:idx_market_stat_bucket,priority:2"`
	Bucket        int64  `json:"bucket" gorm:"bigint;not null;uniqueIndex:idx_market_stat_bucket,priority:3;index"`
	SuccessCount  int    `json:"success_count"`
	FailCount     int    `json:"fail_count"`
	LatencySumMs  int64  `json:"latency_sum_ms" gorm:"bigint"`
	LatencyCount  int    `json:"latency_count"`
	LastSuccessAt int64  `json:"last_success_at" gorm:"bigint"`
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
	success       int
	fail          int
	latencySumMs  int64
	latencyCount  int
	lastSuccessAt int64
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

func init() {
	marketStatPending.deltas = make(map[statKey]*statDelta)
	marketStatPending.lastTraffic = make(map[listingKey]int64)
	marketStatPending.lastProbe = make(map[listingKey]MarketProbeResult)
}

// MarketProbeResult is the latest probe outcome of a listing. It is kept in memory only.
type MarketProbeResult struct {
	At        int64  `json:"at"`
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
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
	defer marketStatPending.Unlock()
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
	drained := drainMarketStatPending()
	if len(drained) == 0 {
		return nil
	}
	var firstErr error
	for key, d := range drained {
		row := &MarketStat{
			ChannelId:     key.channelId,
			ModelName:     key.model,
			Bucket:        key.bucket,
			SuccessCount:  d.success,
			FailCount:     d.fail,
			LatencySumMs:  d.latencySumMs,
			LatencyCount:  d.latencyCount,
			LastSuccessAt: d.lastSuccessAt,
		}
		err := DB.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "channel_id"}, {Name: "model_name"}, {Name: "bucket"}},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"success_count":   gorm.Expr("market_stats.success_count + ?", d.success),
				"fail_count":      gorm.Expr("market_stats.fail_count + ?", d.fail),
				"latency_sum_ms":  gorm.Expr("market_stats.latency_sum_ms + ?", d.latencySumMs),
				"latency_count":   gorm.Expr("market_stats.latency_count + ?", d.latencyCount),
				"last_success_at": gorm.Expr("CASE WHEN market_stats.last_success_at < ? THEN ? ELSE market_stats.last_success_at END", d.lastSuccessAt, d.lastSuccessAt),
			}),
		}).Create(row).Error
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if firstErr == nil {
		invalidateMarketStatSummary()
	}
	return firstErr
}

func purgeOldMarketStats() {
	cutoff := time.Now().Unix()/MarketStatBucketSeconds - marketStatRetention/MarketStatBucketSeconds - 6
	if err := DB.Where("bucket < ?", cutoff).Delete(&MarketStat{}).Error; err != nil {
		common.SysError("purge market stats failed: " + err.Error())
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
}

type MarketWindow struct {
	Blocks []MarketBlock `json:"blocks"`
	Rate   *float64      `json:"rate"`
}

// MarketStatSummary is the monitoring view of one listing.
type MarketStatSummary struct {
	Realtime      MarketWindow `json:"realtime"`
	Day           MarketWindow `json:"day"`
	Week          MarketWindow `json:"week"`
	LastSuccessAt int64        `json:"last_success_at"`
	Samples       int          `json:"samples"`
	AvgLatencyMs  int64        `json:"avg_latency_ms"`
	// Abnormal is true when the last two hours show a clearly failing listing.
	Abnormal bool `json:"abnormal"`
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
		if age < 0 || age >= marketWeekBuckets {
			continue
		}
		s.Samples += r.SuccessCount + r.FailCount
		latencySum[k] += r.LatencySumMs
		latencyCnt[k] += r.LatencyCount
		if r.LastSuccessAt > s.LastSuccessAt {
			s.LastSuccessAt = r.LastSuccessAt
		}
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
		finishWindow(&s.Realtime)
		finishWindow(&s.Day)
		finishWindow(&s.Week)
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
	nowBucket := time.Now().Unix() / MarketStatBucketSeconds
	var rows []MarketStat
	if err := DB.Where("bucket > ?", nowBucket-marketWeekBuckets).Find(&rows).Error; err != nil {
		return nil, err
	}
	return buildMarketStatSummaries(rows, nowBucket), nil
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

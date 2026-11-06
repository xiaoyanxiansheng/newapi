package controller

import (
	"context"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
)

const (
	defaultMarketProbeMinutes = 30
	marketProbeTimeout        = 90 * time.Second
	marketProbeConcurrency    = 3
	maxProbeErrorLength       = 300
)

// Failures that come from this gateway rather than from the probed channel.
var marketProbeLocalErrorCodes = map[types.ErrorCode]struct{}{
	types.ErrorCodeGenRelayInfoFailed:   {},
	types.ErrorCodeInvalidApiType:       {},
	types.ErrorCodeModelPriceError:      {},
	types.ErrorCodeConvertRequestFailed: {},
	types.ErrorCodeJsonMarshalFailed:    {},
}

func marketProbeEligible(modelName string, pricing model.Pricing) bool {
	return service.MarketModelMonitorable(modelName, pricing)
}

// probeMarketListing sends one tiny request through the channel test path. The test path neither bills a
// user nor writes a user visible log. The outcome feeds the market statistics.
func probeMarketListing(parent context.Context, l *model.MarketListing) model.MarketProbeResult {
	result := model.MarketProbeResult{At: time.Now().Unix()}
	channel, err := model.GetChannelById(l.ChannelId, true)
	if err != nil {
		result.Error = "channel not found"
		model.SetMarketProbeResult(l.ChannelId, l.ModelName, result)
		return result
	}
	userId, err := resolveChannelTestUserID(nil)
	if err != nil {
		result.Error = err.Error()
		model.SetMarketProbeResult(l.ChannelId, l.ModelName, result)
		return result
	}

	ctx, cancel := context.WithTimeout(context.WithValue(parent, silentChannelTestKey{}, true), marketProbeTimeout)
	defer cancel()
	started := time.Now()
	outcome := testChannel(ctx, channel, userId, l.ModelName, l.ProbeEndpoint, true)
	result.LatencyMs = time.Since(started).Milliseconds()

	switch {
	case outcome.newAPIError != nil:
		result.Error = outcome.newAPIError.Error()
		if _, local := marketProbeLocalErrorCodes[outcome.newAPIError.GetErrorCode()]; !local {
			model.ObserveMarketCall(l.ChannelId, l.ModelName, false, 0, true)
		}
	case outcome.localErr != nil:
		result.Error = outcome.localErr.Error()
	default:
		result.OK = true
		model.ObserveMarketCall(l.ChannelId, l.ModelName, true, result.LatencyMs, true)
	}
	if record := outcome.rawProbeUsage; record != nil {
		record.ChannelId, record.ModelName, record.At, record.Success = l.ChannelId, l.ModelName, result.At, result.OK
		if record.TotalTokens != nil {
			result.Tokens = *record.TotalTokens
		}
		if err := model.SaveMarketProbeUsage(record); err != nil {
			common.SysError("save market probe usage failed: " + err.Error())
		}
	}
	// Classify the full error before display truncation. Local gateway errors
	// cannot clear a previously confirmed upstream client restriction.
	requiresClaudeCode := service.ClaudeCodeClientRequired(l.ModelName, result.Error)
	upstreamResult := result.OK
	if outcome.newAPIError != nil {
		_, local := marketProbeLocalErrorCodes[outcome.newAPIError.GetErrorCode()]
		upstreamResult = !local
	}
	if upstreamResult || requiresClaudeCode {
		if err := model.SetMarketListingProbeRequiresClaudeCode(l.ChannelId, l.ModelName, requiresClaudeCode); err != nil {
			common.SysError("save market probe client restriction failed: " + err.Error())
		}
	}
	if len(result.Error) > maxProbeErrorLength {
		result.Error = result.Error[:maxProbeErrorLength]
	}
	model.SetMarketProbeResult(l.ChannelId, l.ModelName, result)
	return result
}

func runMarketProbeRound(interval time.Duration) {
	pricingByModel := make(map[string]model.Pricing)
	for _, p := range model.GetPricing() {
		pricingByModel[p.ModelName] = p
	}

	var targets []*model.MarketListing
	for _, l := range model.GetAllMarketListingsCached() {
		if _, ok := service.MonitorableListing(l); !ok {
			continue
		}
		if !marketProbeEligible(l.ModelName, pricingByModel[l.ModelName]) {
			continue
		}
		if model.MarketListingHasRecentTraffic(l.ChannelId, l.ModelName, interval) {
			continue
		}
		targets = append(targets, l)
	}

	var wg sync.WaitGroup
	jobs := make(chan *model.MarketListing)
	for i := 0; i < marketProbeConcurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for l := range jobs {
				probeMarketListing(context.Background(), l)
			}
		}()
	}
	for _, l := range targets {
		jobs <- l
	}
	close(jobs)
	wg.Wait()
	common.SysLog("market probe round finished, probed " + strconv.Itoa(len(targets)) + " listings")
}

// StartMarketProbe monitors listed and paused listings in the background. MARKET_PROBE_INTERVAL_MINUTES
// overrides the 30 minute default, 0 disables probing.
func StartMarketProbe() {
	if !common.IsMasterNode {
		return
	}
	minutes := defaultMarketProbeMinutes
	if v := os.Getenv("MARKET_PROBE_INTERVAL_MINUTES"); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil || parsed < 0 {
			common.SysError("invalid MARKET_PROBE_INTERVAL_MINUTES, using default")
		} else {
			minutes = parsed
		}
	}
	if minutes == 0 {
		return
	}
	interval := time.Duration(minutes) * time.Minute
	go func() {
		time.Sleep(2 * time.Minute)
		for {
			runMarketProbeRound(interval)
			time.Sleep(interval)
		}
	}()
}

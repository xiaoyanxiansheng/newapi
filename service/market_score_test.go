package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func TestCacheRatioFromBillingExpr(t *testing.T) {
	ratio := CacheRatioFromBillingExpr(`len < 272000 ? tier("standard", p * 10 + c * 50 + cr * 1 + cc * 12.5) : tier("long", p * 20 + c * 75 + cr * 2)`)
	require.NotNil(t, ratio)
	require.InDelta(t, 0.1, *ratio, 1e-9)
	if CacheRatioFromBillingExpr(`tier("base", p * 2 + c * 10)`) != nil {
		t.Fatal("an expression without cache-read pricing must not invent a cache ratio")
	}
}

func TestMarketModelMonitorableAllowsClaudeChat(t *testing.T) {
	require.True(t, MarketModelMonitorable("claude-opus-5-5", model.Pricing{QuotaType: 0}))
	require.False(t, MarketModelMonitorable("claude-image-tool", model.Pricing{QuotaType: 0}))
	require.False(t, MarketModelMonitorable("claude-opus-5-5", model.Pricing{QuotaType: 1}))
}

func TestClaudeCodeClientRequired(t *testing.T) {
	for _, tt := range []struct {
		name, model, message string
		want                 bool
	}{
		{"actual upstream client restriction", "claude-sonnet-5", "bad response status code 400, message: 我们检测到您的客户端存在异常，请使用标准 Claude Code 客户端请求。如您对此事不知情，请首先尝试升级您的 Claude Code 客户端版本", true},
		{"CC abbreviation", "vendor/Claude-Opus", "必须使用 CC 客户端", true},
		{"English requirement", "claude-sonnet", "Please use the standard Claude Code client for this request", true},
		{"English only restriction", "claude-sonnet", "This endpoint only supports Claude Code clients", true},
		{"English CC requirement", "claude-sonnet", "You must use a CC client", true},
		{"ordinary error", "claude-sonnet", "bad response status code 524", false},
		{"CC group without client restriction", "claude-fable", "No available channel under group cc-cursor-华强北", false},
		{"client name alone", "claude-sonnet", "Claude Code client: insufficient quota", false},
		{"client is optional", "claude-sonnet", "Claude Code client is not required", false},
		{"success", "claude-sonnet", "", false},
		{"other model", "gpt-6", "必须使用 CC 客户端", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, ClaudeCodeClientRequired(tt.model, tt.message))
		})
	}
}

func TestMarketListingMonitoringAvailableUsesClaudeProbeRestriction(t *testing.T) {
	pricing := model.Pricing{QuotaType: 0}
	listing := &model.MarketListing{ModelName: "claude-sonnet"}
	require.True(t, MarketListingMonitoringAvailable(listing, pricing))
	listing.ProbeRequiresClaudeCode = true
	require.False(t, MarketListingMonitoringAvailable(listing, pricing))
	listing.ProbeRequiresClaudeCode = false
	require.True(t, MarketListingMonitoringAvailable(listing, pricing))
	listing.ModelName = "claude-image-tool"
	require.True(t, MarketListingMonitoringAvailable(listing, pricing), "model keywords cannot hide ordinary Claude outcomes")
	require.False(t, MarketListingMonitoringAvailable(listing, model.Pricing{QuotaType: 1}))
	listing.BillingMode = "fixed_request"
	require.False(t, MarketListingMonitoringAvailable(listing, pricing))
}

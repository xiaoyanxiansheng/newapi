package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMarketProbeUsageReachesStatsWithoutBillingUserOrCountingFailures(t *testing.T) {
	previousDB := model.DB
	initModelListColumnNames(t)
	model.DB = previousDB
	db := upstreamControllerDB(t)
	previousRedis := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = previousRedis })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.MarketStat{}, &model.Log{}, &model.Model{}, &model.Vendor{}))
	previousRatios := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"probe-fixture":1}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousRatios)) })
	root := model.User{Username: "probe-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default", Quota: 1000000}
	require.NoError(t, db.Create(&root).Error)
	service.InitHttpClient()
	var reject bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if reject {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"message":"rate limited"}}`))
			return
		}
		assert.Equal(t, "/v1/chat/completions", r.URL.Path)
		var request map[string]any
		require.NoError(t, common.DecodeJson(r.Body, &request))
		assert.Equal(t, float64(256), request["max_completion_tokens"])
		assert.Equal(t, true, request["stream"])
		assert.Equal(t, "Reply with exactly the word OK. Do not add explanations.", request["messages"].([]any)[0].(map[string]any)["content"])
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"probe","object":"chat.completion","model":"probe-fixture","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":16,"total_tokens":23}}`))
	}))
	t.Cleanup(server.Close)
	parameterOverride := `{"max_completion_tokens":8192,"messages":[{"role":"user","content":"A different prompt"}]}`
	channel := model.Channel{Type: 1, Name: "probe-site", Models: "probe-fixture", Key: "test-key", Group: "default", BaseURL: &server.URL, Status: common.ChannelStatusEnabled, ParamOverride: &parameterOverride}
	require.NoError(t, db.Create(&channel).Error)
	listing := model.MarketListing{ChannelId: channel.Id, ModelName: "probe-fixture", Enabled: true, Ratio: 1, BillingMode: "fixed_expr", BillingExpr: `tier("base", p * 1 + c * 5)`}
	require.NoError(t, db.Create(&listing).Error)
	model.InvalidateMarketListings()
	for range 3 {
		result := probeMarketListing(context.Background(), &listing)
		require.True(t, result.OK, result.Error)
		assert.Equal(t, int64(23), result.Tokens)
		assert.False(t, result.TokensEstimated)
	}
	reject = true
	failed := probeMarketListing(context.Background(), &listing)
	assert.False(t, failed.OK)
	require.NoError(t, model.FlushMarketStats())
	summary := model.GetMarketStatSummary(channel.Id, listing.ModelName)
	require.NotNil(t, summary)
	require.NotNil(t, summary.ProbeUsage)
	assert.Equal(t, int64(69), summary.ProbeUsage.TotalTokens)
	assert.Equal(t, 3, summary.ProbeUsage.Samples)
	assert.Equal(t, 23.0, summary.ProbeUsage.AverageTokens)
	assert.Equal(t, "openai", summary.ProbeUsage.Protocol)
	require.Len(t, summary.ProbeUsage.Recent, 3)
	assert.False(t, summary.ProbeUsage.Recent[0].Success)
	var records []model.MarketProbeUsageRecord
	require.NoError(t, db.Order("id").Find(&records).Error)
	require.Len(t, records, 4)
	assert.Equal(t, int64(7), *records[0].InputTokens)
	assert.Equal(t, int64(16), *records[0].OutputTokens)
	assert.Nil(t, records[0].ReasoningTokens)
	assert.Equal(t, 4, summary.Samples)
	var saved model.User
	require.NoError(t, db.First(&saved, root.Id).Error)
	assert.Equal(t, root.Quota, saved.Quota)
	var logs int64
	require.NoError(t, db.Model(&model.Log{}).Count(&logs).Error)
	assert.Zero(t, logs)
}

func TestMarketProbeNativeProtocolsRetainDifferentUpstreamUsage(t *testing.T) {
	previousDB := model.DB
	initModelListColumnNames(t)
	model.DB = previousDB
	db := upstreamControllerDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.MarketStat{}, &model.Model{}, &model.Vendor{}))
	previousRedis, previousTimeout := common.RedisEnabled, constant.StreamingTimeout
	common.RedisEnabled, constant.StreamingTimeout = false, 30
	t.Cleanup(func() { common.RedisEnabled, constant.StreamingTimeout = previousRedis, previousTimeout })
	previousRatios := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"protocol-fixture":1}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousRatios)) })
	root := model.User{Username: "protocol-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default", Quota: 1000000}
	require.NoError(t, db.Create(&root).Error)
	service.InitHttpClient()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if !assert.NoError(t, common.DecodeJson(r.Body, &request)) {
			return
		}
		assert.Equal(t, true, request["stream"])
		w.Header().Set("Content-Type", "text/event-stream")
		switch r.URL.Path {
		case "/v1/responses":
			assert.Equal(t, float64(256), request["max_output_tokens"])
			assert.Equal(t, "Reply with exactly the word OK. Do not add explanations.", request["input"])
			_, _ = w.Write([]byte("data: {\"type\":\"response.output_text.delta\",\"delta\":\"OK\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":4000,\"output_tokens\":239,\"total_tokens\":4239,\"output_tokens_details\":{\"reasoning_tokens\":238}}}}\n\n"))
		case "/v1/messages":
			assert.Equal(t, float64(256), request["max_tokens"])
			assert.Equal(t, "test-key", r.Header.Get("x-api-key"))
			_, _ = w.Write([]byte("data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_fixture\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"protocol-fixture\",\"content\":[],\"usage\":{\"input_tokens\":22,\"output_tokens\":0}}}\n\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"OK\"}}\n\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":1}}\n\ndata: {\"type\":\"message_stop\"}\n\n"))
		default:
			t.Errorf("selected native protocol was converted to %s", r.URL.Path)
		}
	}))
	t.Cleanup(server.Close)
	for _, tc := range []struct {
		protocol string
		tokens   int64
	}{{"anthropic", 23}, {"openai-response", 4239}} {
		channel := model.Channel{Type: 1, Name: tc.protocol, Models: "protocol-fixture", Key: "test-key", Group: "default", BaseURL: &server.URL, Status: common.ChannelStatusEnabled}
		require.NoError(t, db.Create(&channel).Error)
		listing := model.MarketListing{ChannelId: channel.Id, ModelName: "protocol-fixture", Enabled: true, Ratio: 1, ProbeEndpoint: tc.protocol}
		require.NoError(t, db.Create(&listing).Error)
		model.InvalidateMarketListings()
		for range 3 {
			result := probeMarketListing(context.Background(), &listing)
			require.True(t, result.OK, result.Error)
			assert.Equal(t, tc.tokens, result.Tokens)
		}
		summary := model.GetMarketStatSummary(channel.Id, listing.ModelName)
		require.NotNil(t, summary)
		require.NotNil(t, summary.ProbeUsage)
		assert.Equal(t, tc.tokens*3, summary.ProbeUsage.TotalTokens)
		assert.Equal(t, 3, summary.ProbeUsage.Samples)
		assert.Equal(t, tc.protocol, summary.ProbeUsage.Protocol)
		if tc.protocol == "openai-response" {
			assert.Equal(t, int64(238), *summary.ProbeUsage.Recent[0].ReasoningTokens)
		}
	}
}

func TestMarketProbeEndpointSelectionRejectsInvalidProtocolWithoutChangingListing(t *testing.T) {
	db := upstreamControllerDB(t)
	require.NoError(t, db.Create(&model.Channel{Id: 99, Models: "endpoint-fixture", Status: common.ChannelStatusEnabled}).Error)
	listing := model.MarketListing{ChannelId: 99, ModelName: "endpoint-fixture", Ratio: 1, Description: "Keep this description"}
	require.NoError(t, db.Create(&listing).Error)
	rejected := upstreamControllerCall(t, UpdateAdminMarketListing, http.MethodPut, "/", listing.Id, map[string]any{"probe_endpoint": "unknown", "description": "Do not write"})
	assert.Equal(t, false, rejected["success"])
	var saved model.MarketListing
	require.NoError(t, db.First(&saved, listing.Id).Error)
	assert.Equal(t, listing.Description, saved.Description)
	accepted := upstreamControllerCall(t, UpdateAdminMarketListing, http.MethodPut, "/", listing.Id, map[string]any{"probe_endpoint": "anthropic"})
	assert.Equal(t, true, accepted["success"])
	require.NoError(t, db.First(&saved, listing.Id).Error)
	assert.Equal(t, "anthropic", saved.ProbeEndpoint)
}

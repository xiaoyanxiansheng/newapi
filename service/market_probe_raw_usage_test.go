package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMarketProbeRawUsagePreservesUpstreamTotalsAndUnknownFields(t *testing.T) {
	for _, tc := range []struct {
		name, protocol, body string
		total                *int64
	}{
		{"Responses", "openai_response", `{"usage":{"input_tokens":4000,"output_tokens":239,"total_tokens":4239,"input_tokens_details":{"cached_tokens":3900},"output_tokens_details":{"reasoning_tokens":238}}}`, probeInt(4239)},
		{"upstream total is authoritative", "openai", `{"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":120}}`, probeInt(120)},
		{"missing output remains unknown", "openai", `{"usage":{"prompt_tokens":7}}`, nil},
		{"no usage is not locally estimated", "openai", `{"choices":[{"message":{"content":"OK"}}]}`, nil},
		{"explicit zero is known", "openai", `{"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}`, probeInt(0)},
		{"Messages cache categories included once", "anthropic", `{"usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":100,"cache_creation_input_tokens":200}}`, probeInt(330)},
		{"OpenAI cache and reasoning are subsets", "openai", `{"usage":{"prompt_tokens":100,"completion_tokens":50,"prompt_tokens_details":{"cached_tokens":80},"completion_tokens_details":{"reasoning_tokens":40}}}`, probeInt(150)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseMarketProbeRawUsage([]byte(tc.body), tc.protocol)
			assert.Equal(t, tc.total, got.TotalTokens)
			if tc.name == "Responses" {
				assert.Equal(t, probeInt(4000), got.InputTokens)
				assert.Equal(t, probeInt(239), got.OutputTokens)
				assert.Equal(t, probeInt(3900), got.CacheReadTokens)
				assert.Equal(t, probeInt(238), got.ReasoningTokens)
				assert.Nil(t, got.CacheWriteTokens)
			}
		})
	}
}

func TestMarketProbeRawUsageMergesStreamSnapshotsWithoutSummingEvents(t *testing.T) {
	body := "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":22,\"output_tokens\":0}}}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":1}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
	got := ParseMarketProbeRawUsage([]byte(body), "anthropic")
	require.NotNil(t, got.TotalTokens)
	assert.Equal(t, int64(23), *got.TotalTokens)
	assert.Nil(t, got.CacheReadTokens)
}

func probeInt(value int64) *int64 { return &value }

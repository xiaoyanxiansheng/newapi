package service

import (
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
)

func TestMarketProbeTokensUsesProtocolTotalsWithoutDoubleCounting(t *testing.T) {
	for _, tc := range []struct {
		name  string
		usage *dto.Usage
		want  int64
	}{
		{"missing usage", nil, 0},
		{"OpenAI cached input and reasoning are already included", &dto.Usage{PromptTokens: 100, CompletionTokens: 50, TotalTokens: 150, PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 80}, CompletionTokenDetails: dto.OutputTokenDetails{ReasoningTokens: 40}}, 150},
		{"Responses input output aliases", &dto.Usage{InputTokens: 4000, OutputTokens: 239, TotalTokens: 4239}, 4239},
		{"native Anthropic caches included once", &dto.Usage{BillingUsage: dto.NewClaudeMessagesBillingUsage(&dto.ClaudeUsage{InputTokens: 10, OutputTokens: 20, CacheReadInputTokens: 100, CacheCreationInputTokens: 200})}, 330},
		{"native Anthropic split cache creation", &dto.Usage{BillingUsage: dto.NewClaudeMessagesBillingUsage(&dto.ClaudeUsage{InputTokens: 10, OutputTokens: 20, CacheReadInputTokens: 100, CacheCreation: &dto.ClaudeCacheCreationUsage{Ephemeral5mInputTokens: 150, Ephemeral1hInputTokens: 50}})}, 330},
		{"Gemini thinking included once", &dto.Usage{BillingUsage: dto.NewGeminiChatBillingUsage(&dto.GeminiUsageMetadata{PromptTokenCount: 100, CandidatesTokenCount: 10, ThoughtsTokenCount: 90, TotalTokenCount: 200})}, 200},
		{"zero usage", &dto.Usage{}, 0},
		{"invalid negative upstream usage", &dto.Usage{PromptTokens: -10, CompletionTokens: 20}, 0},
		{"absurd upstream total", &dto.Usage{TotalTokens: 1_000_000_001}, 0},
	} {
		t.Run(tc.name, func(t *testing.T) { assert.Equal(t, tc.want, MarketProbeTokens(tc.usage)) })
	}
}

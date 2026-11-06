package service

import (
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// MarketProbeTokens counts input plus output, including reasoning and cache tokens
// once. OpenAI totals already include cached input; native Anthropic input does not.
func MarketProbeTokens(usage *dto.Usage) int64 {
	if usage == nil {
		return 0
	}
	usage = effectiveBillingUsage(usage)
	values := []int{usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens, usage.InputTokens, usage.OutputTokens, usage.PromptTokensDetails.CachedTokens, usage.PromptTokensDetails.CacheCreationTokensTotal(), usage.ClaudeCacheCreation5mTokens, usage.ClaudeCacheCreation1hTokens}
	for _, value := range values {
		if value < 0 || value > 1_000_000_000 {
			return 0
		}
	}
	input := max(usage.PromptTokens, usage.InputTokens)
	output := max(usage.CompletionTokens, usage.OutputTokens)
	total := int64(input) + int64(output)
	if usage.UsageSemantic == dto.BillingUsageSemanticAnthropic {
		creation := int64(usage.PromptTokensDetails.CacheCreationTokensTotal())
		if creation == 0 {
			creation = int64(usage.ClaudeCacheCreation5mTokens) + int64(usage.ClaudeCacheCreation1hTokens)
		}
		// Normalized InputTokens may already contain the cache categories.
		inputWithCache := int64(usage.PromptTokens) + int64(usage.PromptTokensDetails.CachedTokens) + creation
		total = max(total, inputWithCache+int64(output))
	}
	total = max(total, int64(usage.TotalTokens))
	if total > 1_000_000_000 {
		return 0
	}
	return total
}

package service

import (
	"bytes"
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ParseMarketProbeRawUsage reads the upstream wire response, before adaptors can
// normalize or estimate it. Stream usage events are snapshots, not increments.
func ParseMarketProbeRawUsage(body []byte, protocol string) *model.MarketProbeUsageRecord {
	record := &model.MarketProbeUsageRecord{Protocol: protocol}
	usage := map[string]any{}
	var messages []json.RawMessage
	body = bytes.TrimSpace(body)
	if len(body) > 0 && body[0] == '{' {
		messages = append(messages, body)
	} else {
		// SSE allows multi-line data and CRLF. Only usage-bearing JSON is retained.
		stream := strings.ReplaceAll(string(body), "\r\n", "\n")
		for _, frame := range strings.Split(stream, "\n\n") {
			var data []string
			for _, line := range strings.Split(frame, "\n") {
				if strings.HasPrefix(line, "data:") {
					data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
				}
			}
			if len(data) > 0 {
				messages = append(messages, json.RawMessage(strings.Join(data, "\n")))
			}
		}
	}
	for _, message := range messages {
		var event map[string]any
		if common.Unmarshal(message, &event) != nil {
			continue
		}
		object := event
		if response, ok := event["response"].(map[string]any); ok {
			object = response
		} else if start, ok := event["message"].(map[string]any); ok {
			object = start
		}
		if patch, ok := object["usage"].(map[string]any); ok {
			mergeMarketProbeUsage(usage, patch)
		}
		// Gemini exposes native usage under usageMetadata.
		if patch, ok := object["usageMetadata"].(map[string]any); ok {
			mergeMarketProbeUsage(usage, patch)
		}
		if object["stop_reason"] == "max_tokens" {
			record.OutputLimited = true
		}
		if delta, ok := event["delta"].(map[string]any); ok && delta["stop_reason"] == "max_tokens" {
			record.OutputLimited = true
		}
		if details, ok := object["incomplete_details"].(map[string]any); ok && details["reason"] == "max_output_tokens" {
			record.OutputLimited = true
		}
		if choices, ok := event["choices"].([]any); ok {
			for _, item := range choices {
				if choice, ok := item.(map[string]any); ok && choice["finish_reason"] == "length" {
					record.OutputLimited = true
				}
			}
		}
	}
	record.InputTokens = probeUsageNumber(usage, "input_tokens", "prompt_tokens", "promptTokenCount")
	record.OutputTokens = probeUsageNumber(usage, "output_tokens", "completion_tokens", "candidatesTokenCount")
	record.CacheReadTokens = probeUsageNumber(usage, "cache_read_input_tokens", "input_tokens_details.cached_tokens", "prompt_tokens_details.cached_tokens", "cachedContentTokenCount")
	record.CacheWriteTokens = probeUsageNumber(usage, "cache_creation_input_tokens", "input_tokens_details.cache_write_tokens", "prompt_tokens_details.cache_write_tokens")
	record.ReasoningTokens = probeUsageNumber(usage, "output_tokens_details.reasoning_tokens", "completion_tokens_details.reasoning_tokens", "thoughtsTokenCount")
	if protocol == "anthropic" && record.CacheWriteTokens == nil {
		five := probeUsageNumber(usage, "cache_creation.ephemeral_5m_input_tokens")
		hour := probeUsageNumber(usage, "cache_creation.ephemeral_1h_input_tokens")
		if five != nil || hour != nil {
			value := int64(0)
			if five != nil {
				value += *five
			}
			if hour != nil {
				value += *hour
			}
			record.CacheWriteTokens = &value
		}
	}
	record.TotalTokens = probeUsageNumber(usage, "total_tokens", "totalTokenCount")
	if record.TotalTokens != nil {
		record.TotalSource = "upstream"
	} else if record.InputTokens != nil && record.OutputTokens != nil && usage["total_tokens"] == nil && usage["totalTokenCount"] == nil {
		value := *record.InputTokens + *record.OutputTokens
		if protocol == "anthropic" {
			if record.CacheReadTokens != nil {
				value += *record.CacheReadTokens
			}
			if record.CacheWriteTokens != nil {
				value += *record.CacheWriteTokens
			}
		} else if protocol == "gemini" && record.ReasoningTokens != nil {
			value += *record.ReasoningTokens
		}
		if value <= 1_000_000_000 {
			record.TotalTokens = &value
			record.TotalSource = "components"
		}
	}
	raw, _ := common.Marshal(usage)
	record.RawUsage = string(raw)
	return record
}

// Keep only protocol-defined numeric fields. Unknown metadata cannot leak into storage.
func mergeMarketProbeUsage(target, patch map[string]any) {
	for key, value := range patch {
		switch key {
		case "input_tokens", "prompt_tokens", "output_tokens", "completion_tokens", "total_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "cached_tokens", "cache_write_tokens", "reasoning_tokens", "ephemeral_5m_input_tokens", "ephemeral_1h_input_tokens", "promptTokenCount", "candidatesTokenCount", "totalTokenCount", "cachedContentTokenCount", "thoughtsTokenCount":
			// Retain invalid values as null so they remain unknown, not silently estimated.
			number := probeUsageNumber(map[string]any{key: value}, key)
			target[key] = number
		case "input_tokens_details", "prompt_tokens_details", "output_tokens_details", "completion_tokens_details", "cache_creation":
			if nested, ok := value.(map[string]any); ok {
				current, _ := target[key].(map[string]any)
				if current == nil {
					current = map[string]any{}
					target[key] = current
				}
				mergeMarketProbeUsage(current, nested)
			}
		}
	}
}

func probeUsageNumber(values map[string]any, paths ...string) *int64 {
	for _, path := range paths {
		var value any = values
		for _, part := range strings.Split(path, ".") {
			object, ok := value.(map[string]any)
			if !ok {
				value = nil
				break
			}
			value = object[part]
		}
		if value == nil {
			continue
		}
		var number float64
		switch v := value.(type) {
		case *int64:
			return v
		case float64:
			number = v
		case string:
			parsed, err := strconv.ParseFloat(v, 64)
			if err != nil {
				return nil
			}
			number = parsed
		default:
			return nil
		}
		if math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || number > 1_000_000_000 || math.Trunc(number) != number {
			return nil
		}
		result := int64(number)
		return &result
	}
	return nil
}

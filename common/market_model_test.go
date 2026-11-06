package common

import (
	"github.com/stretchr/testify/assert"
	"testing"
)

func TestMarketBaseModelAliasesPreserveCapabilityVariants(t *testing.T) {
	for _, test := range []struct{ input, expected string }{
		{"claude-opus-5-5@s1c13", "claude-opus-5-5"},
		{"claude-opus-5-5@s46c260", "claude-opus-5-5"},
		{"gpt-6.1-sol-high@s1c35", "gpt-6.1-sol-high"},
		{"gpt-6.1-sol-xhigh@s1c35", "gpt-6.1-sol-xhigh"},
		{"model@s1c13-preview", "model@s1c13-preview"},
		{"minimax-m3@s61c310", "MiniMax-M3"},
		{"minimax-m3", "MiniMax-M3"},
		{"MiniMax-M3", "MiniMax-M3"},
	} {
		t.Run(test.input, func(t *testing.T) { assert.Equal(t, test.expected, MarketBaseModel(test.input)) })
	}
}

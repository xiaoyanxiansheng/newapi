package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTokenRouteKeepsModelWithoutChannels(t *testing.T) {
	truncateTables(t)
	token := Token{
		UserId:         7,
		Key:            "token-route-empty-model-key",
		Name:           "route-empty",
		Status:         common.TokenStatusEnabled,
		ExpiredTime:    -1,
		UnlimitedQuota: true,
	}
	require.NoError(t, token.Insert())

	_, err := MutateTokenRoutes(token.Id, token.UserId, func(routes []TokenRoute) ([]TokenRoute, error) {
		return append(routes, TokenRoute{Model: "empty-model"}, TokenRoute{Model: "empty-model"}, TokenRoute{Model: "full-model", Channels: []int{3}}), nil
	})
	require.NoError(t, err)

	reloaded, err := GetTokenByIds(token.Id, token.UserId)
	require.NoError(t, err)
	assert.Equal(t, []TokenRoute{
		{Model: "empty-model", Channels: []int{}},
		{Model: "full-model", Channels: []int{3}},
	}, reloaded.GetRoutes(), "an added model stays without channels, duplicates collapse")
	assert.Equal(t, map[string][]int{"empty-model": {}, "full-model": {3}}, reloaded.GetRouteMap())
}

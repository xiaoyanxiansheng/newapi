package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestSupplierOffersShareModelButRetryAndBillIndependentListings(t *testing.T) {
	db := setupMarketRouteTest(t)
	createRouteChannel(t, db, 14, common.ChannelStatusEnabled, "claude-opus-5-5@s1c13,claude-opus-5-5@s46c260")
	listings := []model.MarketListing{
		{ChannelId: 14, ModelName: "claude-opus-5-5@s1c13", Enabled: true, Ratio: 1, BillingMode: "fixed_expr", BillingExpr: `tier("base",p*1+c*5)`},
		{ChannelId: 14, ModelName: "claude-opus-5-5@s46c260", Enabled: true, Ratio: 1, BillingMode: "fixed_expr", BillingExpr: `tier("base",p*3+c*15)`},
	}
	require.NoError(t, db.Create(&listings).Error)
	model.InvalidateMarketListings()
	routes := []model.TokenRoute{{Model: "claude-opus-5-5", Channels: []int{14, 14}, ListingIDs: []int{listings[0].Id, listings[1].Id}}}
	c := newRouteContext(map[string][]int{"claude-opus-5-5": {14, 14}}, true)
	c.Set("token_route_entries", routes)
	candidates, err := PrepareRoute(c, "claude-opus-5-5")
	require.NoError(t, err)
	require.Len(t, candidates, 2)
	assert.Equal(t, 1, GetRetryLimit(c))
	assert.Equal(t, []string{"claude-opus-5-5"}, GetRouteModels(c))
	for _, listing := range listings {
		channel, err := SelectRouteChannel(c, "claude-opus-5-5")
		require.NoError(t, err)
		assert.Equal(t, 14, channel.Id)
		value, _ := c.Get("market_selected_listing")
		assert.Equal(t, listing.ModelName, value.(model.MarketListing).ModelName)
		contracts, _ := c.Get("market_billing_contracts")
		assert.Equal(t, listing.BillingExpr, contracts.(map[int]model.MarketListing)[14].BillingExpr)
		c.Set("use_channel", []string{"14"})
	}
	_, err = SelectRouteChannel(c, "claude-opus-5-5")
	require.Error(t, err)
	c = newRouteContext(map[string][]int{"claude-opus-5-5": {14, 14}}, false)
	c.Set("token_route_entries", routes)
	candidates, err = PrepareRoute(c, "claude-opus-5-5")
	require.NoError(t, err)
	assert.Len(t, candidates, 1)
	// Legacy saved supplier routes normalize without losing either offer.
	token := model.Token{Routes: `[{"model":"claude-opus-5-5@s1c13","channels":[14]},{"model":"claude-opus-5-5@s46c260","channels":[14]}]`}
	assert.Equal(t, routes, token.GetRoutes())
}

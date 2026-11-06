package service

import (
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestUpstreamFixedPublishWithoutLocalPricesFreezesVerifiedPrices(t *testing.T) {
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamSource{}, &model.UpstreamReview{}, &model.UpstreamRefresh{}))
	quotes, err := ParseUpstreamCatalog([]byte(`{"data":[{"model_name":"unconfigured-upstream-model","quota_type":0,"model_ratio":10,"completion_ratio":4,"cache_ratio":0.1}],"group_ratio":{"vip":0.1}}`), model.UpstreamSource{Adapter: "newapi", PriceGroup: "vip", PurchaseMultiplier: "1"})
	require.NoError(t, err)
	source := model.UpstreamSource{Name: "existing Key", BaseURL: "https://example.com", RelayKey: "test-only", Markup: "1.1", Adapter: "catalog"}
	require.NoError(t, db.Create(&source).Error)
	require.NoError(t, model.SaveUpstreamSnapshot(source.Id, 0, quotes))
	require.NoError(t, db.First(&source, source.Id).Error)
	preview, err := PreviewUpstreamSelection(source, source.Revision, map[string]string{quotes[0].Model: ""})
	require.NoError(t, err)
	require.Empty(t, preview.Proposals[0].Issue, "verified upstream prices must allow publishing without a local price table")
	require.Equal(t, "20", preview.Proposals[0].Original.Input)
	require.Equal(t, "2.2", preview.Proposals[0].Sale.Input)
	require.NoError(t, model.ApplyUpstreamSelection(source.Id, source.Revision, preview.Proposals))
	require.NoError(t, db.First(&source, source.Id).Error)
	listing := model.GetMarketListing(source.ChannelId, quotes[0].Model)
	require.NotNil(t, listing)
	_, available := SellableListing(listing)
	require.True(t, available)
	originalSale := listing.BillingExpr
	value, _, err := billingexpr.RunExprWithRequest(originalSale, billingexpr.TokenParams{P: 800, C: 100, CR: 200}, billingexpr.RequestInput{})
	require.NoError(t, err)
	require.InDelta(t, 2684, value, 0.000001)
	output, discount := MarketListingPriceReference(listing, model.Pricing{})
	require.InDelta(t, 8.8, output, 0.000001)
	require.InDelta(t, 0.11, discount, 0.000001)
	quotes[0].Description = "upstream changed"
	require.NoError(t, model.SaveUpstreamSnapshot(source.Id, source.Revision, quotes))
	model.InvalidateMarketListings()
	require.Equal(t, originalSale, model.GetMarketListing(source.ChannelId, quotes[0].Model).BillingExpr)
	_, configured, _ := ratio_setting.GetModelRatio(quotes[0].Model)
	require.False(t, configured, "publishing never changes global model prices")
}

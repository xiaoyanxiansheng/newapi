package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func upstreamRouteQuoteFixture(t *testing.T, origin string) (model.UpstreamAccount, model.UpstreamSource) {
	t.Helper()
	t.Setenv("CRYPTO_SECRET", "route-quote-test-secret-12345")
	snapshot := UpstreamBrowserDiscovery{
		Keys:    []UpstreamDiscoveredKey{{ID: 567, Key: "sk-private-key-not-for-response", Models: []string{"claude-opus", "gpt-example"}, JoinedRoutes: []UpstreamJoinedRoute{{ListingID: 287, Model: "claude-opus", Alias: "claude-opus@s1c13"}, {ListingID: 288, Model: "claude-opus", Alias: "claude-opus@s2c14"}}}},
		Pricing: []byte(`{"success":true,"group_ratio":{"default":1},"data":[{"model_name":"claude-opus@s1c13","quota_type":0,"model_ratio":0.366,"completion_ratio":5},{"model_name":"claude-opus@s2c14","quota_type":0,"model_ratio":0.4,"completion_ratio":5},{"model_name":"unrelated@s3c15","quota_type":0,"model_ratio":1,"completion_ratio":1}]}`),
		Status:  []byte(`{"success":true,"data":{"quota_display_type":"USD","quota_per_unit":500000,"usd_exchange_rate":6.8896}}`),
	}
	body, err := common.Marshal(snapshot)
	require.NoError(t, err)
	sealed, err := common.SealUpstreamSecret(string(body))
	require.NoError(t, err)
	return model.UpstreamAccount{Id: 5, Website: origin, DiscoveryMode: "newapi", DiscoveryTime: 100, BrowserDiscovery: model.UpstreamDiscoveryStorage(sealed)}, model.UpstreamSource{Id: 17, AccountId: 5, RemoteKeyId: 567}
}

func TestRouteQuotesReadMerchantPricesAndMultiplierUsingTheCNYPageRule(t *testing.T) {
	requests := 0
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		assert.Equal(t, http.MethodGet, r.Method)
		assert.Equal(t, "/api/marketplace/listings", r.URL.Path)
		assert.Empty(t, r.Header.Get("Authorization"))
		assert.Empty(t, r.Header.Get("Cookie"))
		w.Write([]byte(`{"success":true,"data":{"fx_rate_cny_per_usd":6.8896,"total":3,"items":[{"id":287,"base_model":"claude-opus","alias":"claude-opus@s1c13","channel_no":"ID00013","supplier_id":1,"charge_type":"per_token","input_price_usd":0.036577,"output_price_usd":0.182885,"cache_read_price_usd":0,"official_input_price_usd":4,"official_output_price_usd":20,"realtime_ratio":0.00914425,"realtime_ratio_cny":999},{"id":288,"base_model":"claude-opus","alias":"claude-opus@s2c14","charge_type":"per_token","input_price_usd":0.4,"output_price_usd":2},{"id":289,"base_model":"not-in-key","alias":"not-in-key@s3c15","charge_type":"per_token","input_price_usd":1,"output_price_usd":1}]}}`))
	}))
	defer site.Close()
	account, source := upstreamRouteQuoteFixture(t, site.URL)
	beforeAccount, beforeSource := account, source
	quotes, err := inspectUpstreamRouteQuotes(context.Background(), account, source, "", site.Client())
	require.NoError(t, err)
	require.Len(t, quotes.Models, 1)
	require.Len(t, quotes.Models[0].Routes, 2)
	first := quotes.Models[0].Routes[0]
	assert.Equal(t, "0.2520008992", first.Prices.Input)
	assert.Equal(t, "1.260004496", first.Prices.Output)
	assert.Equal(t, "0", first.Prices.CacheRead)
	assert.Equal(t, "4", first.Original.Input)
	assert.Equal(t, "0.0630002248", first.Multiplier)
	assert.Equal(t, "ID00013", first.ChannelNo)
	assert.False(t, first.AccessVerified)
	assert.Empty(t, quotes.Models[0].Routes[1].Multiplier)
	assert.Empty(t, quotes.Models[0].Routes[1].Original.Input)
	assert.Equal(t, "CNY", quotes.Currency)
	assert.True(t, quotes.ReadOnly)
	assert.True(t, quotes.SnapshotStale)
	assert.Equal(t, 1, requests)
	assert.Equal(t, beforeAccount, account)
	assert.Equal(t, beforeSource, source)
	body, err := common.Marshal(quotes)
	require.NoError(t, err)
	assert.NotContains(t, string(body), "sk-private-key")
	assert.NotContains(t, string(body), "sealed:v1")
}

func TestRouteQuotesFallbackPreservesDistinctRoutesAndDoesNotInventDiscounts(t *testing.T) {
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	defer site.Close()
	account, source := upstreamRouteQuoteFixture(t, site.URL)
	quotes, err := inspectUpstreamRouteQuotes(context.Background(), account, source, "", site.Client())
	require.NoError(t, err)
	require.Len(t, quotes.Models, 1)
	require.Len(t, quotes.Models[0].Routes, 2)
	first := quotes.Models[0].Routes[0]
	assert.Equal(t, "claude-opus@s1c13", first.AccessModel)
	assert.Equal(t, "0.732", first.Prices.Input)
	assert.Equal(t, "3.66", first.Prices.Output)
	assert.Equal(t, "0.366", first.InputCoefficient)
	assert.Equal(t, "5", first.OutputCoefficient)
	assert.Empty(t, first.Multiplier)
	assert.Empty(t, first.Original.Input)
	assert.Equal(t, "model_multiplier_not_provided", first.Issue)
	assert.Equal(t, "authorized_pricing_snapshot", quotes.Origin)
	assert.Equal(t, int64(100), quotes.QuoteTime)
}

func TestRouteQuoteSearchMatchesFullAccessModelAndPaddedChannelID(t *testing.T) {
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"success":true,"data":{"fx_rate_cny_per_usd":6.8896,"items":[{"id":287,"base_model":"claude-opus","alias":"claude-opus@s1c13","channel_no":"ID00013","charge_type":"per_token","input_price_usd":1,"output_price_usd":5},{"id":289,"base_model":"gpt-example","alias":"gpt-example@s1c14","charge_type":"per_token","input_price_usd":1,"output_price_usd":2}]}}`))
	}))
	defer site.Close()
	account, source := upstreamRouteQuoteFixture(t, site.URL)
	for _, search := range []string{"id00013", "id00287", "claude-opus@s1c13"} {
		quotes, err := inspectUpstreamRouteQuotes(context.Background(), account, source, search, site.Client())
		require.NoError(t, err)
		require.Len(t, quotes.Models, 1)
		assert.Equal(t, "claude-opus", quotes.Models[0].Model)
		assert.Equal(t, 1, quotes.RouteCount)
	}
}

func TestRouteQuotesDoNotTreatPartialMarketDataAsComplete(t *testing.T) {
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"success":true,"data":{"total":2,"items":[{"base_model":"claude-opus","alias":"claude-opus@s1c13"}]}}`))
	}))
	defer site.Close()
	account, source := upstreamRouteQuoteFixture(t, site.URL)
	quotes, err := inspectUpstreamRouteQuotes(context.Background(), account, source, "", site.Client())
	require.NoError(t, err)
	assert.Equal(t, "authorized_pricing_snapshot", quotes.Origin)
	assert.Contains(t, quotes.Issues, "marketplace_unavailable_using_snapshot")
	assert.Equal(t, 2, quotes.RouteCount)
}

func TestRouteQuotesDoNotGuessCNYRateOrTrustMisleadingMultiplierFields(t *testing.T) {
	row := upstreamMarketplaceRoute{ChargeType: "per_token", Input: []byte(`0.1`), Output: []byte(`0.2`), Multiplier: []byte(`0.3333333333333333`), OriginalInput: []byte(`1`)}
	quote := marketplaceRouteQuote(row)
	assert.NotEmpty(t, quote.Issue)
	assert.Empty(t, quote.Prices.Input)
	row.CNYPerUSD = "6.8896"
	quote = marketplaceRouteQuote(row)
	assert.Equal(t, "0.68896", quote.Prices.Input)
	assert.Equal(t, "0.68896", quote.Multiplier)
}

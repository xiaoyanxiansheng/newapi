package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func merchantTestRow(alias string) upstreamMarketplaceRoute {
	return upstreamMarketplaceRoute{ID: 13, CNYPerUSD: "1", Model: "gpt-example", Alias: alias, Status: "active", ChargeType: "per_token", Input: []byte("0.036577"), Output: []byte("0.182885"), CacheRead: []byte("0.001829"), CacheWrite: []byte("0"), OriginalInput: []byte("4"), OriginalOutput: []byte("20"), Multiplier: []byte("0.00914425"), ChannelNo: "ID00013"}
}

func merchantJoinedTestRoutes(rows ...upstreamMarketplaceRoute) []UpstreamJoinedRoute {
	result := []UpstreamJoinedRoute{}
	for _, row := range rows {
		result = append(result, UpstreamJoinedRoute{ListingID: row.ID, Model: row.Model, Alias: row.Alias})
	}
	return result
}

func TestMerchantCatalogKeepsExactRouteCostsAndUnknownOfficialCacheRates(t *testing.T) {
	first, second := merchantTestRow("gpt-example@s1c13"), merchantTestRow("gpt-example@s2c14")
	second.Input = []byte("0.4")
	second.ID = 14
	second.Multiplier = []byte("0.3333333333333333")
	unrelated := merchantTestRow("unrelated@s3c15")
	unrelated.Model = "unrelated"
	unrelated.ID = 15
	catalog, err := merchantRouteCatalog([]upstreamMarketplaceRoute{first, second, unrelated}, map[string]bool{"gpt-example": true, "unrelated": true}, []string{"gpt-example"}, merchantJoinedTestRoutes(first, second, unrelated))
	require.NoError(t, err)
	require.Len(t, catalog, 2)
	assert.Equal(t, "gpt-example@s1c13", catalog[0].Model)
	assert.Equal(t, "0.036577", catalog[0].Cost.Input)
	assert.Equal(t, "0", catalog[0].Cost.CacheWrite)
	assert.Empty(t, catalog[0].Original.CacheRead)
	assert.Empty(t, catalog[0].PriceIssue)
	assert.Equal(t, "0.4", catalog[1].Cost.Input)
	assert.Equal(t, "0.1", catalog[1].UpstreamRatio)
	assert.Equal(t, "CNY", catalog[0].Currency)
	// An alias-only Key must not gain another merchant's route.
	restricted, err := merchantRouteCatalog([]upstreamMarketplaceRoute{first, second}, map[string]bool{"gpt-example": true}, []string{first.Alias}, merchantJoinedTestRoutes(first, second))
	require.NoError(t, err)
	require.Len(t, restricted, 1)
	assert.Equal(t, first.Alias, restricted[0].Model)
}

func TestMerchantCatalogRejectsAmbiguousPricesAndUnavailableRoutes(t *testing.T) {
	row := merchantTestRow("gpt-example@s1c13")
	_, err := merchantRouteCatalog([]upstreamMarketplaceRoute{row, row}, map[string]bool{"gpt-example": true}, nil, merchantJoinedTestRoutes(row))
	require.ErrorContains(t, err, "duplicate")
	for _, tc := range []struct {
		name   string
		change func(*upstreamMarketplaceRoute)
	}{
		{"paused", func(r *upstreamMarketplaceRoute) { r.Status = "paused" }},
		{"missing official", func(r *upstreamMarketplaceRoute) { r.OriginalInput = nil }},
		{"invalid price", func(r *upstreamMarketplaceRoute) { r.Input = []byte("-1") }},
		{"incomplete tiers", func(r *upstreamMarketplaceRoute) { r.LongContextThreshold = 272000 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bad := row
			tc.change(&bad)
			catalog, err := merchantRouteCatalog([]upstreamMarketplaceRoute{bad}, map[string]bool{"gpt-example": true}, nil, merchantJoinedTestRoutes(bad))
			require.NoError(t, err)
			require.Len(t, catalog, 1)
			assert.NotEmpty(t, catalog[0].PriceIssue)
		})
	}
}

func TestMerchantLongContextChargesUncachedInputAndKeepsQuotedCacheRates(t *testing.T) {
	row := merchantTestRow("gpt-example@s1c13")
	row.Input = []byte("1")
	row.Output = []byte("5")
	row.CacheRead = []byte("0.1")
	row.CacheWrite = []byte("0.5")
	row.LongContextThreshold = 272000
	row.LongContextInput = []byte("2")
	row.LongContextOutput = []byte("1.5")
	catalog, err := merchantRouteCatalog([]upstreamMarketplaceRoute{row}, map[string]bool{"gpt-example": true}, nil, merchantJoinedTestRoutes(row))
	require.NoError(t, err)
	q := catalog[0]
	require.Empty(t, q.PriceIssue)
	for _, tc := range []struct {
		p, cache float64
		tier     string
		cost     float64
	}{
		{271999, 0, "standard", 276999},
		{272000, 0, "long_context", 551500},
		{22000, 250000, "standard", 52000},
	} {
		cost, result, err := billingexpr.RunExpr(q.CostExpr, billingexpr.TokenParams{P: tc.p, C: 1000, CR: tc.cache})
		require.NoError(t, err)
		assert.Equal(t, tc.tier, result.MatchedTier)
		assert.Equal(t, tc.cost, cost)
	}
}

func TestMerchantRefreshRevalidatesSavedKeyWithLivePermissionsAndPublicPrices(t *testing.T) {
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamAccount{}, &model.UpstreamSource{}, &model.UpstreamReview{}, &model.UpstreamRefresh{}))
	t.Setenv("CRYPTO_SECRET", "merchant-refresh-test-secret")
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodGet, r.Method)
		if r.URL.Path == "/v1/models" {
			assert.Equal(t, "Bearer sk-saved-authorized-key", r.Header.Get("Authorization"))
			w.Write([]byte(`{"data":[{"id":"gpt-example"},{"id":"unrelated"}]}`))
			return
		}
		if r.URL.Path == "/api/marketplace/listings" {
			assert.Empty(t, r.Header.Get("Authorization"))
			w.Write([]byte(`{"success":true,"data":{"fx_rate_cny_per_usd":1,"total":1,"items":[{"id":13,"base_model":"gpt-example","alias":"gpt-example@s1c13","status":"active","charge_type":"per_token","input_price_usd":0.1,"output_price_usd":0.5,"official_input_price_usd":1,"official_output_price_usd":5,"realtime_ratio":0.1}]}}`))
			return
		}
		t.Errorf("unexpected request %s", r.URL.Path)
		w.WriteHeader(404)
	}))
	defer site.Close()
	snapshot := UpstreamBrowserDiscovery{Connector: UpstreamDiscoveryRecipe{Kind: "newapi"}, Keys: []UpstreamDiscoveredKey{{ID: 7, Key: "saved-authorized-key", Status: 1, Models: []string{"gpt-example"}, ReadTime: common.GetTimestamp(), JoinedRoutes: merchantJoinedTestRoutes(merchantTestRow("gpt-example@s1c13"))}}}
	raw, err := common.Marshal(snapshot)
	require.NoError(t, err)
	sealed, err := common.SealUpstreamSecret(string(raw))
	require.NoError(t, err)
	account := model.UpstreamAccount{Website: site.URL, BrowserDiscovery: model.UpstreamDiscoveryStorage(sealed), DiscoveryTime: 100}
	require.NoError(t, db.Create(&account).Error)
	source := model.UpstreamSource{AccountId: account.Id, RemoteKeyId: 7, AllowedModelsJSON: `["gpt-example"]`}
	quotes, key, err := fetchDiscoveredKeyModelsWithClient(account, source, site.Client())
	require.NoError(t, err)
	require.Len(t, quotes, 1)
	assert.Equal(t, "gpt-example@s1c13", quotes[0].Model)
	plaintext, err := common.OpenUpstreamSecret(key)
	require.NoError(t, err)
	assert.Equal(t, "sk-saved-authorized-key", plaintext)
	source.Disabled = true
	_, _, err = fetchDiscoveredKeyModelsWithClient(account, source, site.Client())
	require.Error(t, err)
}

func TestMerchantPublishUsesCompleteAliasAndFreezesSellingContractAcrossRefresh(t *testing.T) {
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamSource{}, &model.UpstreamReview{}, &model.UpstreamRefresh{}))
	quote := merchantRouteCatalogQuote(merchantTestRow("gpt-example@s1c13"))
	source := model.UpstreamSource{Name: "merchant", BaseURL: "https://example.com", RelayKey: "test-key", Markup: "1.1", Adapter: "catalog"}
	require.NoError(t, db.Create(&source).Error)
	require.NoError(t, model.SaveUpstreamSnapshot(source.Id, 0, []model.UpstreamQuote{quote}))
	require.NoError(t, db.First(&source, source.Id).Error)
	preview, err := PreviewUpstreamSelection(source, source.Revision, map[string]string{quote.Model: ""})
	require.NoError(t, err)
	require.Empty(t, preview.Proposals[0].Issue)
	assert.Equal(t, "0.0402347", preview.Proposals[0].Sale.Input)
	require.NoError(t, model.ApplyUpstreamSelection(source.Id, source.Revision, preview.Proposals))
	require.NoError(t, db.First(&source, source.Id).Error)
	listing := model.GetMarketListing(source.ChannelId, quote.Model)
	require.NotNil(t, listing)
	var channel model.Channel
	require.NoError(t, db.First(&channel, source.ChannelId).Error)
	assert.Equal(t, quote.Model, channel.Models)
	originalSale := listing.BillingExpr
	quote.Cost.Input = "0.5"
	require.NoError(t, model.SaveUpstreamSnapshot(source.Id, source.Revision, []model.UpstreamQuote{quote}))
	model.InvalidateMarketListings()
	assert.Equal(t, originalSale, model.GetMarketListing(source.ChannelId, quote.Model).BillingExpr)
}

func TestMerchantTieredPublishAndSettlementUseTheExactPurchaseContract(t *testing.T) {
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamSource{}, &model.UpstreamReview{}, &model.UpstreamRefresh{}))
	row := merchantTestRow("gpt-example@s1c13")
	row.Input = []byte("1")
	row.Output = []byte("5")
	row.CacheRead = []byte("0.1")
	row.CacheWrite = []byte("0.5")
	row.LongContextThreshold = 272000
	row.LongContextInput = []byte("2")
	row.LongContextOutput = []byte("1.5")
	quote := merchantRouteCatalogQuote(row)
	require.NoError(t, quote.Validate())
	source := model.UpstreamSource{Name: "tiered merchant", BaseURL: "https://example.com", RelayKey: "test-key", Markup: "1.1", Adapter: "catalog"}
	require.NoError(t, db.Create(&source).Error)
	require.NoError(t, model.SaveUpstreamSnapshot(source.Id, 0, []model.UpstreamQuote{quote}))
	require.NoError(t, db.First(&source, source.Id).Error)
	preview, err := PreviewUpstreamSelection(source, source.Revision, map[string]string{quote.Model: ""})
	require.NoError(t, err)
	require.Empty(t, preview.Proposals[0].Issue)
	require.NoError(t, model.ApplyUpstreamSelection(source.Id, source.Revision, preview.Proposals))
	require.NoError(t, db.First(&source, source.Id).Error)
	listing := model.GetMarketListing(source.ChannelId, quote.Model)
	require.NotNil(t, listing)
	for _, tc := range []struct {
		prompt, cached, quota int
		tier                  string
	}{{272000, 250000, 28600, "standard"}, {522000, 250000, 317075, "long_context"}} {
		usage := &dto.Usage{PromptTokens: tc.prompt, CompletionTokens: 1000}
		usage.PromptTokensDetails.CachedTokens = tc.cached
		params := BuildTieredTokenParams(usage, false, billingexpr.UsedVars(listing.BillingExpr))
		info := &relaycommon.RelayInfo{TieredBillingSnapshot: &billingexpr.BillingSnapshot{BillingMode: "tiered_expr", ExprString: listing.BillingExpr, ExprHash: billingexpr.ExprHashString(listing.BillingExpr), GroupRatio: 1, QuotaPerUnit: 500000, ExprVersion: 1}}
		ok, quota, result := TryTieredSettle(info, params)
		require.True(t, ok)
		assert.Equal(t, tc.quota, quota)
		assert.Equal(t, tc.tier, result.MatchedTier)
	}
}

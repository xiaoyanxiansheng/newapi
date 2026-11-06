package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSub2APIMissingPlazaGroupUsesSharedOriginalAndLiveKeyRateThenPublishes(t *testing.T) {
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamAccount{}, &model.UpstreamSource{}, &model.UpstreamReview{}, &model.UpstreamRefresh{}))
	t.Setenv("CRYPTO_SECRET", "shared-original-test-secret")
	original := `tier("base", p * 4 + c * 20 + cr * 0.2 + cc * 5 + cc1h * 8)`
	donorRaw, err := common.Marshal(UpstreamBrowserDiscovery{Pricing: []byte(`{"success":true,"data":[{"model_name":"claude-opus-5-5","billing_mode":"tiered_expr","billing_expr":"tier(\"base\", p * 4 + c * 20 + cr * 0.2 + cc * 5 + cc1h * 8)"}],"group_ratio":{"cheap":0.01}}`)})
	require.NoError(t, err)
	donorSealed, err := common.SealUpstreamSecret(string(donorRaw))
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.UpstreamAccount{Website: "https://donor.example", DiscoveryTime: 100, BrowserDiscovery: model.UpstreamDiscoveryStorage(donorSealed)}).Error)
	// Accounts created before the disabled column was introduced have NULL.
	require.NoError(t, db.Model(&model.UpstreamAccount{}).Where("website = ?", "https://donor.example").Update("disabled", nil).Error)
	// A more recent but incomplete expression must not drop 1h cache pricing.
	incompleteRaw, err := common.Marshal(UpstreamBrowserDiscovery{Pricing: []byte(`{"data":[{"model_name":"claude-opus-5-5","billing_mode":"tiered_expr","billing_expr":"p * 4 + c * 20 + cr * 0.2 + cc * 5"}]}`)})
	require.NoError(t, err)
	incompleteSealed, err := common.SealUpstreamSecret(string(incompleteRaw))
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.UpstreamAccount{Website: "https://partial.example", DiscoveryTime: 200, BrowserDiscovery: model.UpstreamDiscoveryStorage(incompleteSealed)}).Error)
	rate := "0.5"
	billingStatus := http.StatusOK
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer sk-existing-shared-test", r.Header.Get("Authorization"))
		switch r.URL.Path {
		case "/v1/models":
			w.Write([]byte(`{"data":[{"id":"claude-opus-5-5"},{"id":"claude-3-5-sonnet-20241022"},{"id":"unknown-model"}]}`))
		case "/v1/sub2api/billing":
			w.WriteHeader(billingStatus)
			body, err := common.Marshal(map[string]any{"object": "sub2api.key_billing", "schema_version": 1, "billing_scope": "token", "group_rate_multiplier": 0.9, "resolved_rate_multiplier": rate, "effective_rate_multiplier": rate, "peak_rate_enabled": false})
			assert.NoError(t, err)
			w.Write(body)
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer site.Close()
	now := common.GetTimestamp()
	snapshot := UpstreamBrowserDiscovery{Connector: UpstreamDiscoveryRecipe{Kind: "api"}, Keys: []UpstreamDiscoveredKey{{ID: 3799, Key: "sk-existing-shared-test", GroupID: 3, Group: "CCMAX20", Status: 1, ReadTime: now}}, Sub2APIPricing: []byte(`{"catalog":{"code":0,"data":{"groups":[]}},"group_rates":{"code":0,"data":{}}}`)}
	raw, err := common.Marshal(snapshot)
	require.NoError(t, err)
	sealed, err := common.SealUpstreamSecret(string(raw))
	require.NoError(t, err)
	account := model.UpstreamAccount{Website: site.URL, DiscoveryTime: now, BrowserDiscovery: model.UpstreamDiscoveryStorage(sealed)}
	require.NoError(t, db.Create(&account).Error)
	source := model.UpstreamSource{AccountId: account.Id, RemoteKeyId: 3799, PriceGroup: "CCMAX20", AllowedModelsJSON: "null", Adapter: "account", Name: "pqai", BaseURL: site.URL, KeyStatus: 1, Markup: "1.1"}
	require.NoError(t, db.Create(&source).Error)
	quotes, key, err := fetchDiscoveredKeyModelsWithClient(account, source, site.Client())
	require.NoError(t, err)
	require.Len(t, quotes, 3)
	var opus model.UpstreamQuote
	for _, q := range quotes {
		if q.Model == "claude-opus-5-5" {
			opus = q
		}
		if q.Model == "unknown-model" {
			assert.NotEmpty(t, q.PriceIssue)
		}
		if q.Model == "claude-3-5-sonnet-20241022" {
			assert.Empty(t, q.PriceIssue)
		}
	}
	require.Empty(t, opus.PriceIssue)
	assert.Equal(t, original, opus.BillingExpr)
	assert.Equal(t, "0.5", opus.UpstreamRatio)
	require.NoError(t, model.SaveUpstreamKeySnapshot(source.Id, source.Revision, quotes, key))
	require.NoError(t, db.First(&source, source.Id).Error)
	preview, err := PreviewUpstreamSelection(source, source.Revision, map[string]string{"claude-opus-5-5": ""})
	require.NoError(t, err)
	require.Empty(t, preview.Proposals[0].Issue)
	require.NoError(t, model.ApplyUpstreamSelection(source.Id, source.Revision, preview.Proposals))
	require.NoError(t, db.First(&source, source.Id).Error)
	listing := model.GetMarketListing(source.ChannelId, "claude-opus-5-5")
	require.NotNil(t, listing)
	for _, tc := range []struct {
		p     billingexpr.TokenParams
		price float64
	}{{billingexpr.TokenParams{P: 1000000}, 2.2}, {billingexpr.TokenParams{C: 1000000}, 11}, {billingexpr.TokenParams{CR: 1000000}, 0.11}, {billingexpr.TokenParams{CC: 1000000}, 2.75}, {billingexpr.TokenParams{CC1h: 1000000}, 4.4}} {
		value, _, err := billingexpr.RunExpr(listing.BillingExpr, tc.p)
		require.NoError(t, err)
		assert.InDelta(t, tc.price*1000000, value, 0.000001)
	}
	_, available := SellableListing(listing)
	assert.True(t, available)
	old := listing.BillingExpr
	rate = "0.9"
	quotes, key, err = fetchDiscoveredKeyModelsWithClient(account, source, site.Client())
	require.NoError(t, err)
	assert.Equal(t, "0.9", quotes[1].UpstreamRatio)
	require.NoError(t, model.SaveUpstreamKeySnapshot(source.Id, source.Revision, quotes, key))
	model.InvalidateMarketListings()
	assert.Equal(t, old, model.GetMarketListing(source.ChannelId, "claude-opus-5-5").BillingExpr)
	require.NoError(t, db.First(&source, source.Id).Error)
	billingStatus = http.StatusForbidden
	quotes, key, err = fetchDiscoveredKeyModelsWithClient(account, source, site.Client())
	require.NoError(t, err)
	require.NoError(t, model.SaveUpstreamKeySnapshot(source.Id, source.Revision, quotes, key))
	require.NoError(t, db.First(&source, source.Id).Error)
	preview, err = PreviewUpstreamSelection(source, source.Revision, map[string]string{"claude-opus-5-5": ""})
	require.NoError(t, err)
	require.NotEmpty(t, preview.Proposals[0].Issue)
	require.Error(t, model.ApplyUpstreamSelection(source.Id, source.Revision, preview.Proposals))
	model.InvalidateMarketListings()
	assert.Equal(t, old, model.GetMarketListing(source.ChannelId, "claude-opus-5-5").BillingExpr)
}

func TestSub2APISharedOriginalPreservesContextThresholdsAndZeroCachePrices(t *testing.T) {
	expr := `len <= 200000 ? tier("base", p * 3 + c * 15 + cr * 0 + cc * 3.75 + cc1h * 6) : tier("long", p * 6 + c * 30 + cr * 0 + cc * 7.5 + cc1h * 12)`
	q, err := sharedOriginalPurchaseQuote(model.UpstreamQuote{Model: "known-model", Currency: "USD", Unit: "per_million_tokens", BillingMode: "tiered_expr", BillingExpr: expr}, decimal.RequireFromString("0.5"))
	require.NoError(t, err)
	assert.Equal(t, expr, q.BillingExpr)
	for _, tc := range []struct {
		length float64
		cost   float64
		tier   string
	}{{200000, 1.5, "base"}, {200001, 3, "long"}} {
		cost, trace, err := billingexpr.RunExpr(q.CostExpr, billingexpr.TokenParams{P: 100, CR: tc.length - 100, Len: tc.length})
		require.NoError(t, err)
		assert.InDelta(t, 100*tc.cost, cost, 0.000001)
		assert.Equal(t, tc.tier, trace.MatchedTier)
	}
}

func TestSub2APISharedOriginalRejectsUnverifiedKeyBilling(t *testing.T) {
	for _, tc := range []struct {
		name  string
		patch map[string]any
	}{
		{"missing effective rate", map[string]any{"effective_rate_multiplier": nil}},
		{"zero rate", map[string]any{"effective_rate_multiplier": 0}},
		{"negative rate", map[string]any{"effective_rate_multiplier": -1}},
		{"peak pricing", map[string]any{"peak_rate_enabled": true}},
		{"unknown peak state", map[string]any{"peak_rate_enabled": nil}},
		{"unknown schema", map[string]any{"schema_version": 2}},
		{"unknown scope", map[string]any{"billing_scope": "account"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bill := map[string]any{"object": "sub2api.key_billing", "schema_version": 1, "billing_scope": "token", "group_rate_multiplier": 0.9, "effective_rate_multiplier": 0.5, "peak_rate_enabled": false}
			for k, v := range tc.patch {
				bill[k] = v
			}
			raw, err := common.Marshal(bill)
			require.NoError(t, err)
			_, err = sub2APIKeyPurchaseRate(raw)
			require.Error(t, err)
		})
	}
}

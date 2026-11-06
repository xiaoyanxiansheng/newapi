package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSub2APIImageGroupOverridesSharedTokenPricesAndPublishesPerImage(t *testing.T) {
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamAccount{}, &model.UpstreamSource{}, &model.UpstreamReview{}, &model.UpstreamRefresh{}))
	t.Setenv("CRYPTO_SECRET", "sub2api-image-test-secret")
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer sk-image-existing-key", r.Header.Get("Authorization"))
		switch r.URL.Path {
		case "/v1/models":
			w.Write([]byte(`{"data":[{"id":"gpt-image-2"},{"id":"gpt-image-2.5-flare"},{"id":"gpt-image-2.5-sunburst"}]}`))
		case "/v1/sub2api/billing":
			w.Write([]byte(`{"object":"sub2api.key_billing","schema_version":1,"billing_scope":"token","effective_rate_multiplier":0.9,"peak_rate_enabled":false}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer site.Close()
	now := common.GetTimestamp()
	snapshot := UpstreamBrowserDiscovery{Connector: UpstreamDiscoveryRecipe{Kind: "api"}, Keys: []UpstreamDiscoveredKey{{ID: 3844, Key: "sk-image-existing-key", GroupID: 24, Group: "Image004", Status: 1, ReadTime: now}}, Sub2APIPricing: []byte(`{"catalog":{"code":0,"data":{"groups":[]}},"group_rates":{"code":0,"data":{}},"available_groups":{"code":0,"data":[{"id":8,"name":"Image002","allow_image_generation":true,"image_rate_independent":true,"image_rate_multiplier":1,"image_price_1k":0.02,"image_price_2k":0.02,"image_price_4k":0.02},{"id":24,"name":"Image004","allow_image_generation":true,"image_rate_independent":true,"image_rate_multiplier":0.5,"image_price_1k":0.05,"image_price_2k":0.05,"image_price_4k":0.05}]}}`)}
	raw, err := common.Marshal(snapshot)
	require.NoError(t, err)
	sealed, err := common.SealUpstreamSecret(string(raw))
	require.NoError(t, err)
	account := model.UpstreamAccount{Website: site.URL, DiscoveryTime: now, BrowserDiscovery: model.UpstreamDiscoveryStorage(sealed)}
	require.NoError(t, db.Create(&account).Error)
	source := model.UpstreamSource{AccountId: account.Id, RemoteKeyId: 3844, PriceGroup: "Image004", AllowedModelsJSON: "null", Adapter: "account", BaseURL: site.URL, Name: "Image004", KeyStatus: 1, Markup: "1.1"}
	require.NoError(t, db.Create(&source).Error)
	quotes, key, err := fetchDiscoveredKeyModelsWithClient(account, source, site.Client())
	require.NoError(t, err)
	require.Len(t, quotes, 3)
	for _, q := range quotes {
		require.Empty(t, q.PriceIssue)
		assert.Equal(t, "per_image", q.Unit)
		assert.Equal(t, "0.05", q.Original.Request)
		assert.Equal(t, "0.025", q.Cost.Request)
		assert.Equal(t, "0.5", q.UpstreamRatio)
		assert.Empty(t, q.Original.Input)
	}
	require.NoError(t, model.SaveUpstreamKeySnapshot(source.Id, source.Revision, quotes, key))
	require.NoError(t, db.First(&source, source.Id).Error)
	preview, err := PreviewUpstreamSelection(source, source.Revision, map[string]string{"gpt-image-2": ""})
	require.NoError(t, err)
	require.Empty(t, preview.Proposals[0].Issue)
	assert.Equal(t, "0.0275", preview.Proposals[0].BillingExpr)
	require.NoError(t, model.ApplyUpstreamSelection(source.Id, source.Revision, preview.Proposals))
	require.NoError(t, db.First(&source, source.Id).Error)
	listing := model.GetMarketListing(source.ChannelId, "gpt-image-2")
	require.NotNil(t, listing)
	assert.Equal(t, "fixed_request", listing.BillingMode)
	assert.Equal(t, "0.0275", listing.BillingExpr)
	_, ok := SellableListing(listing)
	assert.True(t, ok)
}

func TestSub2APIImagePricesNeverFallBackToTokenPricesOrAnotherGroup(t *testing.T) {
	key := UpstreamDiscoveredKey{GroupID: 24, Group: "Image004"}
	for _, tc := range []struct {
		name  string
		group map[string]any
		valid bool
		cost  string
	}{
		{name: "flat image contract", valid: true, cost: "0.025"},
		{name: "inherited token multiplier", group: map[string]any{"image_rate_independent": false}, valid: true, cost: "0.045"},
		{name: "another group", group: map[string]any{"id": 8}},
		{name: "same ID different name", group: map[string]any{"name": "other"}},
		{name: "missing 4K price", group: map[string]any{"image_price_4k": nil}},
		{name: "resolution tiers", group: map[string]any{"image_price_4k": 0.1}},
		{name: "missing independent multiplier", group: map[string]any{"image_rate_multiplier": nil}},
		{name: "images disabled", group: map[string]any{"allow_image_generation": false}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			group := map[string]any{"id": 24, "name": "Image004", "allow_image_generation": true, "image_rate_independent": true, "image_rate_multiplier": 0.5, "image_price_1k": 0.05, "image_price_2k": 0.05, "image_price_4k": 0.05}
			for k, v := range tc.group {
				group[k] = v
			}
			raw, err := common.Marshal(map[string]any{"available_groups": map[string]any{"code": 0, "data": []any{group}}})
			require.NoError(t, err)
			q := sub2APIImageQuote(raw, key, "gpt-image-2.5-flare", decimal.RequireFromString("0.9"))
			if tc.valid {
				require.Empty(t, q.PriceIssue)
				assert.Equal(t, tc.cost, q.Cost.Request)
				require.NoError(t, q.Validate())
			} else {
				require.NotEmpty(t, q.PriceIssue)
				assert.Empty(t, q.Original.Input)
				assert.Empty(t, q.Cost.Request)
			}
		})
	}
	_, err := sharedOriginalPurchaseQuote(model.UpstreamQuote{Model: "gpt-image-2", Currency: "USD", Unit: "per_million_tokens", Original: model.UpstreamPrices{Input: "5", Output: "30"}}, decimal.NewFromInt(1))
	require.Error(t, err)
	q := sub2APIImageQuote([]byte(`{"catalog":{"code":0,"data":{"groups":[]}}}`), key, "gpt-image-2", decimal.NewFromInt(1))
	require.NotEmpty(t, q.PriceIssue)
}

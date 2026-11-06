package service

import (
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestUpstreamPricingAdapterAppliesDiscountExactlyOnceAcrossTokenDimensions(t *testing.T) {
	body := []byte(`{"success":true,"data":[{"model_name":"example","quota_type":0,"model_ratio":10,"completion_ratio":4,"cache_ratio":0.1,"create_cache_ratio":1.25,"image_ratio":2,"audio_ratio":3,"audio_completion_ratio":4,"enable_groups":["vip"]}],"group_ratio":{"vip":0.1}}`)
	quotes, err := ParseUpstreamCatalog(body, model.UpstreamSource{Adapter: "newapi", PriceGroup: "vip", PurchaseMultiplier: "1"})
	require.NoError(t, err)
	require.Len(t, quotes, 1)
	q := quotes[0]
	assert.Equal(t, "20", q.Original.Input)
	assert.Equal(t, "2", q.Cost.Input)
	assert.Equal(t, "8", q.Cost.Output)
	assert.Equal(t, "0.2", q.Cost.CacheRead)
	assert.Equal(t, "2.5", q.Cost.CacheWrite)
	assert.Equal(t, "24", q.Cost.AudioOutput)
	ratio, sale, err := model.DeriveUpstreamListingRatio(q.Original, q, "1.1")
	require.NoError(t, err)
	assert.Equal(t, 0.11, ratio)
	assert.Equal(t, "2.2", sale.Input)
	_, err = ParseUpstreamCatalog(body, model.UpstreamSource{Adapter: "newapi", PriceGroup: "missing", PurchaseMultiplier: "1"})
	require.Error(t, err)
}
func TestUpstreamCatalogUsesFinalCostsAndRejectsAmbiguousUnitsOrDuplicateModels(t *testing.T) {
	source := model.UpstreamSource{Adapter: "catalog", PurchaseMultiplier: "0.1"}
	quotes, err := ParseUpstreamCatalog([]byte(`{"models":[{"model":"example","currency":"USD","unit":"per_request","original":{"request":"20"},"cost":{"request":"2"}}]}`), source)
	require.NoError(t, err)
	assert.Equal(t, "2", quotes[0].Cost.Request)
	for _, body := range []string{`<html>prices</html>`, `{"models":[{"model":"x","currency":"CNY","unit":"per_request","original":{"request":"20"},"cost":{"request":"2"}}]}`, `{"models":[{"model":"x","currency":"USD","unit":"per_1000_tokens","original":{"input":"20","output":"80"},"cost":{"input":"2","output":"8"}}]}`, `{"models":[{"model":"x","price_issue":"unknown"},{"model":"x","price_issue":"unknown"}]}`} {
		_, err := ParseUpstreamCatalog([]byte(body), source)
		require.Error(t, err)
	}
	quotes, err = ParseUpstreamCatalog([]byte(`{"models":[]}`), source)
	require.NoError(t, err)
	assert.Empty(t, quotes)
}
func TestUpstreamUnverifiedAndDynamicModelsRemainVisibleWithoutInventedPrices(t *testing.T) {
	quotes, err := ParseUpstreamCatalog([]byte(`{"data":[{"model_name":"missing-output","quota_type":0,"model_ratio":2},{"model_name":"dynamic","billing_mode":"tiered_expr","quota_type":0,"model_ratio":2,"completion_ratio":4}],"group_ratio":{"vip":0.22}}`), model.UpstreamSource{Adapter: "newapi", PurchaseMultiplier: "1", PriceGroup: "vip"})
	require.NoError(t, err)
	require.Len(t, quotes, 2)
	for _, q := range quotes {
		assert.Equal(t, "0.22", q.UpstreamRatio, "the verified Key group multiplier remains visible even when model costs are unverified")
		assert.NotEmpty(t, q.PriceIssue)
		assert.Empty(t, q.Cost.Input)
		_, _, err := model.DeriveUpstreamListingRatio(model.UpstreamPrices{Input: "4", Output: "16"}, q, "1.1")
		require.Error(t, err)
	}
}
func TestUpstreamCatalogFetchRejectsPrivateAddressesAndCredentialOriginMismatch(t *testing.T) {
	for _, source := range []model.UpstreamSource{
		{CatalogURL: "http://127.0.0.1/catalog", BaseURL: "http://127.0.0.1"},
		{CatalogURL: "https://other.example.com/catalog", BaseURL: "https://example.com", CatalogKey: "secret"},
		{CatalogURL: "http://example.com/catalog", BaseURL: "http://example.com", CatalogKey: "secret"},
	} {
		_, err := FetchUpstreamCatalog(source)
		require.Error(t, err)
	}
}

func TestUpstreamCatalogRejectsUnsupportedPriceDimensionsInsteadOfDroppingThem(t *testing.T) {
	_, err := ParseUpstreamCatalog([]byte(`{"models":[{"model":"x","currency":"USD","unit":"per_million_tokens","original":{"input":"20","output":"80","cache_write_1h":"50"},"cost":{"input":"2","output":"8","cache_write_1h":"5"}}]}`), model.UpstreamSource{Adapter: "catalog"})
	require.ErrorContains(t, err, "unsupported price dimension")
	quotes, err := ParseUpstreamCatalog([]byte(`{"data":[{"model_name":"x","quota_type":0,"model_ratio":10,"completion_ratio":4,"create_cache_1h_ratio":2}]}`), model.UpstreamSource{Adapter: "newapi", PurchaseMultiplier: "1"})
	require.NoError(t, err)
	require.Len(t, quotes, 1)
	assert.Contains(t, quotes[0].PriceIssue, "additional price dimensions")
}

func TestUpstreamPricingCatalogIncludesModelsAvailableToAllGroups(t *testing.T) {
	body := []byte(`{"data":[{"model_name":"example","quota_type":0,"model_ratio":10,"completion_ratio":4,"enable_groups":["all"]}],"group_ratio":{"vip":0.1}}`)
	quotes, err := ParseUpstreamCatalog(body, model.UpstreamSource{Adapter: "newapi", PriceGroup: "vip", PurchaseMultiplier: "1"})
	require.NoError(t, err)
	require.Len(t, quotes, 1)
	assert.Equal(t, "2", quotes[0].Cost.Input)
}

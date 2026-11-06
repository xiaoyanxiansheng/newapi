package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSub2APIUnavailablePlazaUsesExistingKeyAndLiveRateWithoutReauthorization(t *testing.T) {
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamAccount{}, &model.UpstreamSource{}))
	t.Setenv("CRYPTO_SECRET", "sub2api-unavailable-plaza-secret")
	billingOK := true
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer sk-existing-lunoru-test", r.Header.Get("Authorization"))
		switch r.URL.Path {
		case "/v1/models":
			w.Write([]byte(`{"data":[{"id":"claude-3-5-sonnet-20241022"},{"id":"unknown-model"},{"id":"gpt-image-2"}]}`))
		case "/v1/sub2api/billing":
			if !billingOK {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.Write([]byte(`{"object":"sub2api.key_billing","schema_version":1,"billing_scope":"token","group_rate_multiplier":0.9,"effective_rate_multiplier":0.5,"peak_rate_enabled":false}`))
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer site.Close()
	// A previously authorized image contract must still expire: only the live
	// token billing rate and shared token originals bypass snapshot freshness.
	snapshot := UpstreamBrowserDiscovery{Connector: UpstreamDiscoveryRecipe{Kind: "api"}, Keys: []UpstreamDiscoveredKey{{ID: 244, Key: "sk-existing-lunoru-test", GroupID: 43, Group: "kiro", Status: 1, ReadTime: 100}}, Sub2APIPricing: []byte(`{"catalog":null,"group_rates":{"code":0,"data":{}},"available_groups":{"code":0,"data":[{"id":43,"name":"kiro","allow_image_generation":true,"image_rate_independent":true,"image_rate_multiplier":0.5,"image_price_1k":0.05,"image_price_2k":0.05,"image_price_4k":0.05}]}}`)}
	raw, err := common.Marshal(snapshot)
	require.NoError(t, err)
	sealed, err := common.SealUpstreamSecret(string(raw))
	require.NoError(t, err)
	account := model.UpstreamAccount{Website: site.URL, DiscoveryTime: 100, BrowserDiscovery: model.UpstreamDiscoveryStorage(sealed)}
	require.NoError(t, db.Create(&account).Error)
	source := model.UpstreamSource{AccountId: account.Id, RemoteKeyId: 244, PriceGroup: "kiro", AllowedModelsJSON: "null"}
	quotes, key, err := fetchDiscoveredKeyModelsWithClient(account, source, site.Client())
	require.NoError(t, err)
	require.NotEmpty(t, key)
	require.Len(t, quotes, 3)
	for _, q := range quotes {
		if q.Model == "claude-3-5-sonnet-20241022" {
			require.Empty(t, q.PriceIssue)
			assert.Equal(t, "0.5", q.UpstreamRatio)
			assert.NotEmpty(t, q.CostExpr)
		} else {
			assert.NotEmpty(t, q.PriceIssue, "missing originals and image contracts must stay blocked")
		}
	}
	billingOK = false
	quotes, _, err = fetchDiscoveredKeyModelsWithClient(account, source, site.Client())
	require.NoError(t, err)
	for _, q := range quotes {
		assert.NotEmpty(t, q.PriceIssue, "unverified current rates cannot produce publishable prices")
	}
}

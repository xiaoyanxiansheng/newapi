package service

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func sub2APITestPriceSnapshot(t *testing.T, group map[string]any, rates any) json.RawMessage {
	t.Helper()
	raw, err := common.Marshal(map[string]any{
		"catalog":     map[string]any{"code": 0, "data": map[string]any{"groups": []any{group}}},
		"group_rates": map[string]any{"code": 0, "data": rates},
	})
	require.NoError(t, err)
	return raw
}

func TestSub2APIKeyRefreshUsesItsAuthorizedGroupAndUserRateForAllCacheDurations(t *testing.T) {
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamAccount{}))
	t.Setenv("CRYPTO_SECRET", "sub2api-pricing-test-secret")
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/models", r.URL.Path)
		assert.Equal(t, "Bearer sk-existing-sub2api-test-secret", r.Header.Get("Authorization"))
		_, err := w.Write([]byte(`{"data":[{"id":"claude-haiku"},{"id":"unpriced"}]}`))
		assert.NoError(t, err)
	}))
	defer site.Close()
	now := common.GetTimestamp()
	raw := fmt.Sprintf(`{"connector":{"kind":"api","list_path":"/api/v1/keys?page=1&page_size=100"},"keys":[{"id":1,"key":"sk-existing-sub2api-test-secret","status":1,"group":"CCMAX-0.9x","group_id":20,"models":null,"read_time":%d}],"sub2api_pricing":{"catalog":{"code":0,"data":{"groups":[{"id":99,"name":"CCMAX-0.9x","rate_multiplier":0.1,"models":[{"name":"claude-haiku","pricing":{"billing_mode":"token","input_price":0.000009,"output_price":0.000045}}]},{"id":20,"name":"CCMAX-0.9x","description":"existing group","rate_multiplier":0.9,"user_rate_multiplier":0.5,"models":[{"name":"claude-haiku","pricing":{"billing_mode":"token","input_price":0.000001,"output_price":0.000005,"cache_read_price":0.0000001,"cache_write_price":0.00000125,"cache_write_1h_price":0.000002},"official_pricing":{"input_price":0.000002,"output_price":0.000010}}]}]}},"group_rates":{"code":0,"data":{"20":0.5}}}}`, now)
	sealed, err := common.SealUpstreamSecret(raw)
	require.NoError(t, err)
	account := model.UpstreamAccount{Website: site.URL, DiscoveryTime: now, BrowserDiscovery: model.UpstreamDiscoveryStorage(sealed)}
	source := model.UpstreamSource{RemoteKeyId: 1, PriceGroup: "CCMAX-0.9x", AllowedModelsJSON: "null"}
	quotes, _, err := fetchDiscoveredKeyModelsWithClient(account, source, site.Client())
	require.NoError(t, err)
	require.Len(t, quotes, 2)
	q := quotes[0]
	require.Empty(t, q.PriceIssue)
	require.NoError(t, q.Validate())
	assert.Equal(t, "0.5", q.UpstreamRatio)
	assert.Equal(t, "CNY", q.DisplayCurrency)
	for _, tc := range []struct {
		params billingexpr.TokenParams
		cost   float64
	}{
		{billingexpr.TokenParams{P: 1e6, C: 1e6}, 3},
		{billingexpr.TokenParams{CR: 1e6}, 0.05},
		{billingexpr.TokenParams{CC: 1e6}, 0.625},
		{billingexpr.TokenParams{CC1h: 1e6}, 1},
	} {
		cost, _, err := billingexpr.RunExpr(q.CostExpr, tc.params)
		require.NoError(t, err)
		assert.InDelta(t, tc.cost*1e6, cost, 1e-6)
	}
	assert.NotEmpty(t, quotes[1].PriceIssue, "model permission must not borrow another model's price")
}

func TestSub2APICatalogPreservesWholeRequestContextBoundariesAndZeroCachePrices(t *testing.T) {
	group := map[string]any{"id": 20, "name": "CCMAX", "rate_multiplier": 0.9, "models": []any{map[string]any{
		"name": "claude-long", "long_context_basis": "whole_request", "pricing": map[string]any{
			"billing_mode": "token", "input_price": 0.000003, "output_price": 0.000015, "image_input_price": 0.0000001,
			"intervals": []any{
				map[string]any{"min_tokens": 0, "max_tokens": 200000, "input_price": 0.000003, "output_price": 0.000015, "cache_read_price": 0, "cache_write_price": 0.00000375, "cache_write_1h_price": 0.000006},
				map[string]any{"min_tokens": 200000, "max_tokens": nil, "input_price": 0.000006, "output_price": 0.000030, "cache_read_price": 0, "cache_write_price": 0.0000075, "cache_write_1h_price": 0.000012},
			},
		},
	}}}
	quotes, err := parseSub2APIGroupCatalog(sub2APITestPriceSnapshot(t, group, map[string]any{}), UpstreamDiscoveredKey{GroupID: 20, Group: "CCMAX"})
	require.NoError(t, err)
	require.Len(t, quotes, 1)
	require.Empty(t, quotes[0].PriceIssue)
	for _, tc := range []struct {
		context float64
		price   float64
		tier    string
	}{{200000, 2.7, "context_1"}, {200001, 5.4, "context_2"}} {
		cost, trace, err := billingexpr.RunExpr(quotes[0].CostExpr, billingexpr.TokenParams{P: 100, CR: tc.context - 100, Len: tc.context, Img: 1000000})
		require.NoError(t, err)
		assert.InDelta(t, 100*tc.price+90000, cost, 1e-8)
		assert.Equal(t, tc.tier, trace.MatchedTier)
	}
}

func TestSub2APIRequestPricesApplyTheUserRateWithoutTokenUnitConversion(t *testing.T) {
	group := map[string]any{"id": 20, "name": "CCMAX", "rate_multiplier": 0.9, "models": []any{map[string]any{
		"name": "request-model", "pricing": map[string]any{"billing_mode": "per_request", "per_request_price": 0.2},
	}}}
	quotes, err := parseSub2APIGroupCatalog(sub2APITestPriceSnapshot(t, group, map[string]any{"20": 0.5}), UpstreamDiscoveredKey{GroupID: 20, Group: "CCMAX"})
	require.NoError(t, err)
	require.Len(t, quotes, 1)
	require.Empty(t, quotes[0].PriceIssue)
	assert.Equal(t, "per_request", quotes[0].Unit)
	assert.Equal(t, "0.2", quotes[0].Original.Request)
	assert.Equal(t, "0.1", quotes[0].Cost.Request)
	assert.Empty(t, quotes[0].Cost.Input)
}

func TestSub2APINullCachePricesDoNotChargeCachedTokensAsOrdinaryInput(t *testing.T) {
	group := map[string]any{"id": 20, "name": "CCMAX", "rate_multiplier": 0.9, "models": []any{map[string]any{
		"name": "uncached-price-model", "pricing": map[string]any{"billing_mode": "token", "input_price": 0.000003, "output_price": 0.000015, "cache_read_price": nil, "cache_write_price": nil, "cache_write_1h_price": nil},
	}}}
	quotes, err := parseSub2APIGroupCatalog(sub2APITestPriceSnapshot(t, group, map[string]any{}), UpstreamDiscoveredKey{GroupID: 20, Group: "CCMAX"})
	require.NoError(t, err)
	require.Empty(t, quotes[0].PriceIssue)
	usage := &dto.Usage{PromptTokens: 1000000}
	usage.PromptTokensDetails.CachedTokens = 1000000
	params := BuildTieredTokenParams(usage, false, billingexpr.UsedVars(quotes[0].CostExpr))
	cost, _, err := billingexpr.RunExpr(quotes[0].CostExpr, params)
	require.NoError(t, err)
	assert.Zero(t, cost, "the plaza's nil cache price means no cache charge")
}

func TestSub2APICatalogRefusesUnconfirmedGroupsAndAccountRates(t *testing.T) {
	for _, tc := range []struct {
		name      string
		groupID   int
		groupName string
		rates     any
		userRate  any
	}{
		{"missing Key group ID", 0, "CCMAX", map[string]any{}, nil},
		{"another group ID", 99, "CCMAX", map[string]any{}, nil},
		{"changed group name", 20, "old name", map[string]any{}, nil},
		{"missing rate response", 20, "CCMAX", nil, nil},
		{"unverified user override", 20, "CCMAX", map[string]any{}, 0.5},
		{"invalid user override", 20, "CCMAX", map[string]any{"20": -0.5}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			group := map[string]any{"id": 20, "name": "CCMAX", "rate_multiplier": 0.9, "models": []any{}, "user_rate_multiplier": tc.userRate}
			_, err := parseSub2APIGroupCatalog(sub2APITestPriceSnapshot(t, group, tc.rates), UpstreamDiscoveredKey{GroupID: tc.groupID, Group: tc.groupName})
			require.Error(t, err)
		})
	}
}

func TestSub2APIKeyGroupAbsentFromSuccessfulCatalogRequiresProviderPricesRatherThanAnotherAuthorization(t *testing.T) {
	raw := json.RawMessage(`{"catalog":{"code":0,"data":{"groups":[{"id":6,"name":"GPT","rate_multiplier":0.055,"models":[]},{"id":27,"name":"Claude kiro","rate_multiplier":0.075,"models":[]}]}},"group_rates":{"code":0,"data":{}}}`)
	quotes, err := parseSub2APIGroupCatalog(raw, UpstreamDiscoveredKey{GroupID: 3, Group: "CCMAX20-0.9x"})
	require.EqualError(t, err, "the upstream website has not exposed model prices for this Key's group; confirm its full pricing rules with the provider before publishing")
	assert.Empty(t, quotes, "successful authorization must not borrow another group's price or infer a multiplier from its name")
}

func TestSub2APICatalogLeavesUnverifiedExtraBillingDimensionsBlocked(t *testing.T) {
	for _, tc := range []struct {
		name      string
		modelJSON string
		peak      bool
	}{
		{"reasoning effort multiplier", `{"name":"test-model","pricing":{"billing_mode":"token","input_price":0.000003,"output_price":0.000015,"reasoning_effort_multipliers":{"high":2}}}`, false},
		{"time pricing", `{"name":"test-model","pricing":{"billing_mode":"token","input_price":0.000003,"output_price":0.000015},"time_pricing":{"periods":[{"start_time":"12:00","end_time":"14:00","multiplier":2}]}}`, false},
		{"marginal context basis", `{"name":"test-model","long_context_basis":"marginal","pricing":{"billing_mode":"token","input_price":0.000003,"output_price":0.000015,"intervals":[{"min_tokens":0,"max_tokens":200000,"input_price":0.000003,"output_price":0.000015},{"min_tokens":200000,"max_tokens":null,"input_price":0.000006,"output_price":0.000030}]}}`, false},
		{"overlapping context tiers", `{"name":"test-model","long_context_basis":"whole_request","pricing":{"billing_mode":"token","input_price":0.000003,"output_price":0.000015,"intervals":[{"min_tokens":0,"max_tokens":200000,"input_price":0.000003,"output_price":0.000015},{"min_tokens":150000,"max_tokens":null,"input_price":0.000006,"output_price":0.000030}]}}`, false},
		{"peak pricing", `{"name":"test-model","pricing":{"billing_mode":"token","input_price":0.000003,"output_price":0.000015}}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			group := map[string]any{"id": 20, "name": "CCMAX", "rate_multiplier": 0.9, "peak_rate_enabled": tc.peak, "models": []any{json.RawMessage(tc.modelJSON)}}
			quotes, err := parseSub2APIGroupCatalog(sub2APITestPriceSnapshot(t, group, map[string]any{}), UpstreamDiscoveredKey{GroupID: 20, Group: "CCMAX"})
			require.NoError(t, err)
			require.Len(t, quotes, 1)
			assert.NotEmpty(t, quotes[0].PriceIssue)
		})
	}
}

func TestSub2APINewPriceAuthorizationRefreshesQuotesWithoutChangingPublishedListings(t *testing.T) {
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamAccount{}, &model.UpstreamSource{}))
	t.Setenv("CRYPTO_SECRET", "sub2api-reauthorization-secret")
	account := model.UpstreamAccount{Website: "https://pqai.example", Markup: "1.1"}
	require.NoError(t, db.Create(&account).Error)
	snapshot := UpstreamBrowserDiscovery{PageURL: account.Website + "/keys", Connector: UpstreamDiscoveryRecipe{Kind: "api"}, Complete: true, Keys: []UpstreamDiscoveredKey{{ID: 1, Key: "sk-existing-sub2api-test-secret", Group: "CCMAX", Status: 1}}}
	require.NoError(t, SaveUpstreamDiscovery(account, snapshot))
	var source model.UpstreamSource
	require.NoError(t, db.Where("account_id = ?", account.Id).First(&source).Error)
	source.LatestTime = 100
	require.NoError(t, db.Save(&source).Error)
	listing := model.MarketListing{ChannelId: 7, ModelName: "claude-haiku", Enabled: true, Ratio: 1.1, BillingExpr: "p * 2"}
	require.NoError(t, db.Create(&listing).Error)
	snapshot.Keys[0].GroupID = 20
	snapshot.Sub2APIPricing = sub2APITestPriceSnapshot(t, map[string]any{"id": 20, "name": "CCMAX", "rate_multiplier": 0.9, "models": []any{}}, map[string]any{})
	require.NoError(t, db.First(&account, account.Id).Error)
	require.NoError(t, SaveUpstreamDiscovery(account, snapshot))
	require.NoError(t, db.First(&source, source.Id).Error)
	assert.Zero(t, source.LatestTime)
	var after model.MarketListing
	require.NoError(t, db.First(&after, listing.Id).Error)
	assert.Equal(t, listing, after)
	require.NoError(t, db.First(&account, account.Id).Error)
	stored, err := readStoredUpstreamDiscovery(account)
	require.NoError(t, err)
	assert.Equal(t, 20, stored.Keys[0].GroupID)
	// An unchanged authorization keeps the current reviewed catalog; changing
	// the account-specific rate makes it eligible for automatic refresh again.
	source.LatestTime = 200
	require.NoError(t, db.Save(&source).Error)
	require.NoError(t, SaveUpstreamDiscovery(account, snapshot))
	require.NoError(t, db.First(&source, source.Id).Error)
	assert.Equal(t, int64(200), source.LatestTime)
	require.NoError(t, db.First(&account, account.Id).Error)
	snapshot.Sub2APIPricing = sub2APITestPriceSnapshot(t, map[string]any{"id": 20, "name": "CCMAX", "rate_multiplier": 0.9, "models": []any{}}, map[string]any{"20": 0.5})
	require.NoError(t, SaveUpstreamDiscovery(account, snapshot))
	require.NoError(t, db.First(&source, source.Id).Error)
	assert.Zero(t, source.LatestTime)
}

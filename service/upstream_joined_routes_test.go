package service

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMerchantCNYPageConvertsPerRequestPriceWithoutAddingATokenMultiplier(t *testing.T) {
	row := merchantTestRow("gpt-example@s1c13")
	row.CNYPerUSD = "6.8896"
	row.ChargeType = "per_request"
	row.Input = []byte("0.01")
	row.OriginalInput = []byte("1")
	quote := merchantRouteCatalogQuote(row)
	require.NoError(t, quote.Validate())
	assert.Equal(t, "0.068896", quote.Cost.Request)
	assert.Empty(t, quote.Cost.Input)
	assert.Empty(t, quote.UpstreamRatio)
}

func TestJoinedRouteAuthorizationRequestsCatalogRefreshOnlyWhenSelectionChanges(t *testing.T) {
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamAccount{}, &model.UpstreamSource{}, &model.UpstreamReview{}, &model.UpstreamRefresh{}))
	t.Setenv("CRYPTO_SECRET", "joined-authorization-secret")
	account := model.UpstreamAccount{Website: "https://merchant.example", Markup: "1.1"}
	require.NoError(t, db.Create(&account).Error)
	snapshot := UpstreamBrowserDiscovery{PageURL: "https://merchant.example/keys", Connector: UpstreamDiscoveryRecipe{Kind: "newapi"}, Identity: UpstreamBrowserIdentity{ID: 7}, Complete: true, Keys: []UpstreamDiscoveredKey{{ID: 567, Name: "cc", Key: "sk-existing-authorized-secret", Status: 1, Models: []string{"claude-opus-5-5"}, JoinedRoutes: []UpstreamJoinedRoute{{ListingID: 287, Model: "claude-opus-5-5", Alias: "claude-opus-5-5@s1c13"}}}}}
	require.NoError(t, SaveUpstreamDiscovery(account, snapshot))
	var source model.UpstreamSource
	require.NoError(t, db.Where("account_id = ?", account.Id).First(&source).Error)
	source.LatestTime, source.ChannelId, source.PricingMode = 100, 7, "model_routes"
	require.NoError(t, db.Save(&source).Error)
	listing := model.MarketListing{ChannelId: 7, ModelName: "claude-opus-5-5@s1c13", Enabled: true, Ratio: 1.1, BillingExpr: "p * 2"}
	require.NoError(t, db.Create(&listing).Error)
	require.NoError(t, db.First(&account, account.Id).Error)
	require.NoError(t, SaveUpstreamDiscovery(account, snapshot))
	require.NoError(t, db.First(&source, source.Id).Error)
	assert.Equal(t, int64(100), source.LatestTime, "unchanged memberships should keep the saved catalog")
	snapshot.Keys[0].JoinedRoutes = append(snapshot.Keys[0].JoinedRoutes, UpstreamJoinedRoute{ListingID: 581, Model: "claude-opus-5-5", Alias: "claude-opus-5-5@s46c260"})
	require.NoError(t, db.First(&account, account.Id).Error)
	require.NoError(t, SaveUpstreamDiscovery(account, snapshot))
	require.NoError(t, db.First(&source, source.Id).Error)
	assert.Zero(t, source.LatestTime, "the existing connection callback must automatically refresh changed routes")
	var after model.MarketListing
	require.NoError(t, db.First(&after, listing.Id).Error)
	assert.Equal(t, listing, after)
}

func TestMerchantRefreshImportsOnlyJoinedRoutesForThisKeyInPageCNY(t *testing.T) {
	t.Setenv("CRYPTO_SECRET", "joined-routes-test-secret")
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodGet, r.Method)
		switch r.URL.Path {
		case "/v1/models":
			w.Write([]byte(`{"data":[{"id":"claude-opus-5-5"}]}`))
		case "/api/marketplace/listings":
			assert.Empty(t, r.Header.Get("Authorization"))
			w.Write([]byte(`{"success":true,"data":{"fx_rate_cny_per_usd":6.8896,"total":3,"items":[{"id":287,"base_model":"claude-opus-5-5","alias":"claude-opus-5-5@s1c13","status":"active","charge_type":"per_token","input_price_usd":0.036577,"output_price_usd":0.182885,"cache_read_price_usd":0.001829,"cache_write_price_usd":0.045721,"official_input_price_usd":4,"official_output_price_usd":20,"realtime_ratio":0.00914425},{"id":581,"base_model":"claude-opus-5-5","alias":"claude-opus-5-5@s46c260","status":"active","charge_type":"per_token","input_price_usd":0.17904,"output_price_usd":0.8952,"official_input_price_usd":4,"official_output_price_usd":20},{"id":749,"base_model":"claude-opus-5-5","alias":"claude-opus-5-5@s1c299","status":"active","charge_type":"per_token","input_price_usd":0.418021,"output_price_usd":2.090105,"official_input_price_usd":4,"official_output_price_usd":20}]}}`))
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer site.Close()
	for _, tc := range []struct {
		name, routes string
		want         int
		wantError    bool
	}{
		{"two joined routes", `,"joined_routes":[{"listing_id":287,"base_model":"claude-opus-5-5","listing_alias":"claude-opus-5-5@s1c13"},{"listing_id":581,"base_model":"claude-opus-5-5","listing_alias":"claude-opus-5-5@s46c260"}]`, 2, false},
		{"joined IDs without optional alias enrichment", `,"joined_routes":[{"listing_id":287,"base_model":"claude-opus-5-5"},{"listing_id":581}]`, 2, false},
		{"confirmed empty selection", `,"joined_routes":[]`, 0, false},
		{"old authorization without routes", ``, 0, true},
		{"stale route selection", `,"joined_routes":[]`, 0, true},
		{"wrong alias for listing", `,"joined_routes":[{"listing_id":287,"base_model":"claude-opus-5-5","listing_alias":"claude-opus-5-5@s1c299"}]`, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			readTime := common.GetTimestamp()
			if tc.name == "stale route selection" {
				readTime -= 601
			}
			raw := fmt.Sprintf(`{"connector":{"kind":"newapi"},"keys":[{"id":567,"key":"sk-existing-authorized-secret","status":1,"models":["claude-opus-5-5"],"read_time":%d`, readTime) + tc.routes + `} ]}`
			sealed, err := common.SealUpstreamSecret(raw)
			require.NoError(t, err)
			account := model.UpstreamAccount{Website: site.URL, BrowserDiscovery: model.UpstreamDiscoveryStorage(sealed), DiscoveryTime: 100}
			source := model.UpstreamSource{RemoteKeyId: 567, AllowedModelsJSON: `["claude-opus-5-5"]`, PricingMode: "model_routes"}
			quotes, _, err := fetchDiscoveredKeyModelsWithClient(account, source, site.Client())
			if tc.wantError {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Len(t, quotes, tc.want)
			if tc.want == 0 {
				return
			}
			assert.Equal(t, "claude-opus-5-5@s1c13", quotes[0].Model)
			assert.Equal(t, "0.2520008992", quotes[0].Cost.Input)
			assert.Equal(t, "1.260004496", quotes[0].Cost.Output)
			assert.Equal(t, "0.0126010784", quotes[0].Cost.CacheRead)
			assert.Equal(t, "0.3149994016", quotes[0].Cost.CacheWrite)
			assert.Equal(t, "0.0630002248", quotes[0].UpstreamRatio)
			assert.Equal(t, "1.233513984", quotes[1].Cost.Input)
			assert.Equal(t, "6.16756992", quotes[1].Cost.Output)
		})
	}
}

func TestJoinedRouteReadStatusSurvivesAuthorizationAndIdentifiesTheFailedEndpoint(t *testing.T) {
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamAccount{}, &model.UpstreamSource{}, &model.UpstreamReview{}, &model.UpstreamRefresh{}))
	t.Setenv("CRYPTO_SECRET", "joined-status-secret")
	account := model.UpstreamAccount{Website: "https://merchant.example", Markup: "1.1"}
	require.NoError(t, db.Create(&account).Error)
	snapshot := UpstreamBrowserDiscovery{ReaderVersion: 2, PageURL: account.Website + "/keys", Connector: UpstreamDiscoveryRecipe{Kind: "newapi"}, Identity: UpstreamBrowserIdentity{ID: 7}, Complete: true, Keys: []UpstreamDiscoveredKey{{ID: 567, Name: "cc", Key: "sk-existing-authorized-secret", Status: 1, JoinedRoutesIssue: "http_401"}}}
	require.NoError(t, SaveUpstreamDiscovery(account, snapshot))
	require.NoError(t, db.First(&account, account.Id).Error)
	stored, err := readStoredUpstreamDiscovery(account)
	require.NoError(t, err)
	assert.Equal(t, "http_401", stored.Keys[0].JoinedRoutesIssue)
	var source model.UpstreamSource
	require.NoError(t, db.Where("account_id = ?", account.Id).First(&source).Error)
	source.PricingMode = "model_routes"
	_, err = FilterUpstreamJoinedCatalog(source, nil)
	require.ErrorContains(t, err, "HTTP 401 from /api/marketplace/pins")
	snapshot.Keys[0].JoinedRoutesIssue = ""
	snapshot.Keys[0].JoinedRoutes = []UpstreamJoinedRoute{{ListingID: 287}}
	require.NoError(t, SaveUpstreamDiscovery(account, snapshot))
	require.NoError(t, db.First(&account, account.Id).Error)
	quotes := []model.UpstreamQuote{{ListingID: 287, BaseModel: "claude-opus-5-5", Model: "claude-opus-5-5@s1c13", PriceCNYPerUSD: "6.8896"}, {ListingID: 749, BaseModel: "claude-opus-5-5", Model: "claude-opus-5-5@s1c299", PriceCNYPerUSD: "6.8896"}}
	filtered, err := FilterUpstreamJoinedCatalog(source, quotes)
	require.NoError(t, err)
	require.Len(t, filtered, 1)
	assert.Equal(t, 287, filtered[0].ListingID)
}

func TestMerchantMissingPublicQuoteDoesNotBlockOtherJoinedRoutesOrBorrowAPrice(t *testing.T) {
	first := merchantTestRow("gpt-example@s1c13")
	second := merchantTestRow("gpt-example@s2c14")
	second.ID = 14
	unjoined := merchantTestRow("qwen3.8-max@s1c20")
	unjoined.ID, unjoined.Model = 63, "qwen3.8-max"
	joined := merchantJoinedTestRoutes(first, second)
	joined = append(joined, UpstreamJoinedRoute{ListingID: 305, Model: "qwen3.8-max", Alias: "qwen3.8-max@s23c83"})
	quotes, err := merchantRouteCatalog([]upstreamMarketplaceRoute{first, second, unjoined}, map[string]bool{"gpt-example": true, "qwen3.8-max": true}, nil, joined)
	require.NoError(t, err)
	require.Len(t, quotes, 3)
	assert.Empty(t, quotes[0].PriceIssue)
	assert.Empty(t, quotes[1].PriceIssue)
	missing := quotes[2]
	assert.Equal(t, 305, missing.ListingID)
	assert.Equal(t, "qwen3.8-max@s23c83", missing.Model)
	assert.NotEmpty(t, missing.PriceIssue)
	assert.Empty(t, missing.Cost.Input)
	assert.Empty(t, missing.Original.Input)
	_, _, err = model.DeriveUpstreamListingRatio(model.UpstreamPrices{Input: "4", Output: "20"}, missing, "1.1")
	require.ErrorContains(t, err, missing.PriceIssue)
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamAccount{}, &model.UpstreamSource{}))
	t.Setenv("CRYPTO_SECRET", "missing-route-price-secret")
	raw, err := common.Marshal(UpstreamBrowserDiscovery{Keys: []UpstreamDiscoveredKey{{ID: 567, ReadTime: common.GetTimestamp(), JoinedRoutes: joined}}})
	require.NoError(t, err)
	sealed, err := common.SealUpstreamSecret(string(raw))
	require.NoError(t, err)
	account := model.UpstreamAccount{BrowserDiscovery: model.UpstreamDiscoveryStorage(sealed)}
	require.NoError(t, db.Create(&account).Error)
	source := model.UpstreamSource{AccountId: account.Id, RemoteKeyId: 567, PricingMode: "model_routes", KeyStatus: 1, LatestTime: common.GetTimestamp(), Markup: "1.1"}
	filtered, err := FilterUpstreamJoinedCatalog(source, quotes)
	require.NoError(t, err, "one missing CNY quote must not hide valid quotes from the directory")
	require.Len(t, filtered, 3)
	raw, err = common.Marshal(filtered)
	require.NoError(t, err)
	source.LatestJSON = string(raw)
	preview, err := PreviewUpstreamSelection(source, source.Revision, map[string]string{missing.Model: ""})
	require.NoError(t, err)
	require.Len(t, preview.Proposals, 1)
	assert.Equal(t, missing.PriceIssue, preview.Proposals[0].Issue)
}

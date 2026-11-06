package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func upstreamControllerDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.UpstreamAccount{}, &model.UpstreamSource{}, &model.UpstreamReview{}, &model.UpstreamRefresh{}, &model.Channel{}, &model.MarketListing{}, &model.Ability{}, &model.MarketProbeUsageRecord{}, &model.Token{}, &model.MarketStat{}))
	previous := model.DB
	memory := common.MemoryCacheEnabled
	model.DB = db
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		model.DB = previous
		common.MemoryCacheEnabled = memory
		model.InvalidateMarketListings()
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	return db
}
func upstreamControllerCall(t *testing.T, handler gin.HandlerFunc, method, path string, id int, payload any) map[string]any {
	t.Helper()
	body := ""
	if payload != nil {
		data, err := common.Marshal(payload)
		require.NoError(t, err)
		body = string(data)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	if id > 0 {
		c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(id)}}
		c.Params = append(c.Params, gin.Param{Key: "account_id", Value: fmt.Sprint(id)})
	}
	c.Request = httptest.NewRequest(method, path, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	handler(c)
	var result map[string]any
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &result))
	return result
}

func TestUpstreamMonitoringIncludesListedAndPausedContractsOnly(t *testing.T) {
	db := upstreamControllerDB(t)
	require.NoError(t, db.AutoMigrate(&model.MarketStat{}))
	s := model.UpstreamSource{ChannelId: 77, Markup: "1.1"}
	require.NoError(t, db.Create(&s).Error)
	for i, name := range []string{"listed", "paused", "other"} {
		quote := model.UpstreamQuote{Model: name, Currency: "USD", Unit: "per_million_tokens", Original: model.UpstreamPrices{Input: "2", Output: "10"}, Cost: model.UpstreamPrices{Input: "0.44", Output: "2.2"}}
		data, err := common.Marshal(quote)
		require.NoError(t, err)
		require.NoError(t, db.Create(&model.UpstreamReview{SourceId: s.Id, ModelName: name, QuoteJSON: string(data)}).Error)
		if i < 2 {
			require.NoError(t, db.Create(&model.MarketListing{ChannelId: s.ChannelId, ModelName: name, Enabled: i == 0, Ratio: 1, BillingMode: "fixed_expr", BillingExpr: `tier("base", p * 0.484 + c * 2.42)`, OriginalBillingExpr: `tier("base", p * 2 + c * 10)`}).Error)
		}
	}
	result := upstreamControllerCall(t, GetUpstreamSource, http.MethodGet, "/", s.Id, nil)
	require.Equal(t, true, result["success"])
	for _, value := range result["data"].(map[string]any)["rows"].([]any) {
		row := value.(map[string]any)
		if row["model"] == "other" {
			assert.NotContains(t, row, "monitoring")
			continue
		}
		monitoring := row["monitoring"].(map[string]any)
		assert.InDelta(t, 0.242, monitoring["price_ratio"], 1e-9)
		assert.Contains(t, monitoring, "stats")
		assert.Contains(t, monitoring, "score")
	}
}

func TestDescriptionOnlyUpdatePreservesFrozenPricesAndPausedState(t *testing.T) {
	db := upstreamControllerDB(t)
	require.NoError(t, db.Create(&model.Channel{Id: 88, Models: "example", Status: common.ChannelStatusEnabled}).Error)
	listing := model.MarketListing{ChannelId: 88, ModelName: "example", Ratio: 1, Enabled: false, BillingMode: "fixed_expr", BillingExpr: `tier("base", p * 0.484 + c * 2.42)`, OriginalBillingExpr: `tier("base", p * 2 + c * 10)`}
	require.NoError(t, db.Create(&listing).Error)
	original := listing
	result := upstreamControllerCall(t, UpdateAdminMarketListing, http.MethodPut, "/", listing.Id, map[string]any{"description": "Stable channel"})
	require.Equal(t, true, result["success"])
	require.NoError(t, db.First(&listing, listing.Id).Error)
	assert.Equal(t, "Stable channel", listing.Description)
	assert.Equal(t, original.Enabled, listing.Enabled)
	assert.Equal(t, original.Ratio, listing.Ratio)
	assert.Equal(t, original.BillingExpr, listing.BillingExpr)
	result = upstreamControllerCall(t, UpdateAdminMarketListing, http.MethodPut, "/", listing.Id, map[string]any{"description": strings.Repeat("x", 256)})
	assert.Equal(t, false, result["success"])
}
func TestUpstreamSourceEndpointsNeverReturnKeysAndRetainKeysOnSettingsSave(t *testing.T) {
	db := upstreamControllerDB(t)
	s := model.UpstreamSource{Name: "source", BaseURL: "https://example.com", CatalogURL: "https://example.com/api/pricing", Adapter: "newapi", Markup: "1.1", PurchaseMultiplier: "1", CatalogKey: "catalog-secret", RelayKey: "relay-secret"}
	require.NoError(t, db.Create(&s).Error)
	for _, handler := range []gin.HandlerFunc{GetUpstreamSources, GetUpstreamSource} {
		result := upstreamControllerCall(t, handler, http.MethodGet, "/", s.Id, nil)
		encoded, err := common.Marshal(result)
		require.NoError(t, err)
		assert.NotContains(t, string(encoded), "catalog-secret")
		assert.NotContains(t, string(encoded), "relay-secret")
	}
	input := upstreamSourceInput{Name: "renamed", BaseURL: s.BaseURL, CatalogURL: s.CatalogURL, Adapter: "newapi", Markup: "1.2", PurchaseMultiplier: "1"}
	result := upstreamControllerCall(t, SaveUpstreamSource, http.MethodPut, "/", s.Id, input)
	assert.Equal(t, true, result["success"])
	require.NoError(t, db.First(&s, s.Id).Error)
	assert.Equal(t, "catalog-secret", s.CatalogKey)
	assert.Equal(t, "relay-secret", s.RelayKey)
	result = upstreamControllerCall(t, SaveUpstreamSource, http.MethodPut, "/", s.Id, input)
	assert.Equal(t, false, result["success"])
}
func TestUpstreamRefreshDiffsPersistUntilReviewedAndFailedFetchPreservesSnapshot(t *testing.T) {
	db := upstreamControllerDB(t)
	s := model.UpstreamSource{Name: "source", BaseURL: "https://example.com", CatalogURL: "http://127.0.0.1/catalog", Adapter: "catalog", Markup: "1.1", PurchaseMultiplier: "1"}
	require.NoError(t, db.Create(&s).Error)
	q := model.UpstreamQuote{Model: "a", Currency: "USD", Unit: "per_request", Original: model.UpstreamPrices{Request: "20"}, Cost: model.UpstreamPrices{Request: "2"}}
	gone := q
	gone.Model = "gone"
	require.NoError(t, model.SaveUpstreamSnapshot(s.Id, 0, []model.UpstreamQuote{q, gone}))
	q.Cost.Request = "3"
	added := q
	added.Model = "new"
	require.NoError(t, model.SaveUpstreamSnapshot(s.Id, 1, []model.UpstreamQuote{q, added}))
	require.NoError(t, model.SaveUpstreamSnapshot(s.Id, 2, []model.UpstreamQuote{q, added}))
	result := upstreamControllerCall(t, GetUpstreamSource, http.MethodGet, "/", s.Id, nil)
	data := result["data"].(map[string]any)
	rows := data["rows"].([]any)
	states := map[string]string{}
	for _, value := range rows {
		row := value.(map[string]any)
		states[row["model"].(string)] = row["change"].(string)
	}
	assert.Equal(t, map[string]string{"a": "changed", "gone": "removed", "new": "new"}, states)
	failure := upstreamControllerCall(t, RefreshUpstreamSource, http.MethodPost, "/", s.Id, nil)
	assert.Equal(t, false, failure["success"])
	require.NoError(t, db.First(&s, s.Id).Error)
	assert.Equal(t, int64(3), s.Revision)
	assert.Contains(t, s.LatestJSON, `"request":"3"`)
	assert.NotEmpty(t, s.LastError)
	require.NoError(t, model.ReviewUpstreamModels(s.Id, 3, []string{"a", "gone", "new"}, false))
	result = upstreamControllerCall(t, GetUpstreamSource, http.MethodGet, "/", s.Id, nil)
	for _, value := range result["data"].(map[string]any)["rows"].([]any) {
		assert.Equal(t, "unchanged", value.(map[string]any)["change"])
	}
}
func TestUpstreamApplyRequiresReviewedPriceFingerprintAndFreezesIndependentPrices(t *testing.T) {
	db := upstreamControllerDB(t)
	oldRatio := ratio_setting.ModelRatio2JSONString()
	oldCompletion := ratio_setting.CompletionRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"upstream-fixture":10}`))
	require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"upstream-fixture":4}`))
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(oldRatio))
		require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(oldCompletion))
	})
	s := model.UpstreamSource{Name: "source", BaseURL: "https://example.com", Adapter: "manual", Markup: "1.1", RelayKey: "relay-secret"}
	require.NoError(t, db.Create(&s).Error)
	q := model.UpstreamQuote{Model: "upstream-fixture", Currency: "USD", Unit: "per_million_tokens", Original: model.UpstreamPrices{Input: "20", Output: "80"}, Cost: model.UpstreamPrices{Input: "2", Output: "8"}}
	require.NoError(t, model.SaveUpstreamSnapshot(s.Id, 0, []model.UpstreamQuote{q}))
	selection := upstreamSelectionInput{Revision: 1, Models: map[string]string{"upstream-fixture": ""}}
	missing := upstreamControllerCall(t, ApplyUpstreamModels, http.MethodPost, "/", s.Id, selection)
	assert.Equal(t, false, missing["success"])
	result := upstreamControllerCall(t, PreviewUpstreamModels, http.MethodPost, "/", s.Id, selection)
	require.Equal(t, true, result["success"])
	preview := result["data"].(map[string]any)
	selection.Fingerprint = preview["fingerprint"].(string)
	sale := preview["proposals"].([]any)[0].(map[string]any)["sale"].(map[string]any)
	assert.Equal(t, "2.2", sale["input"])
	assert.Equal(t, "8.8", sale["output"])
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"upstream-fixture":12}`))
	result = upstreamControllerCall(t, ApplyUpstreamModels, http.MethodPost, "/", s.Id, selection)
	require.Equal(t, true, result["success"], "global changes cannot invalidate independent reviewed prices")
	var listing model.MarketListing
	require.NoError(t, db.First(&listing).Error)
	assert.Equal(t, float64(1), listing.Ratio)
	assert.Equal(t, "fixed_expr", listing.BillingMode)
	assert.Equal(t, `tier("base", p * 2.2 + c * 8.8)`, listing.BillingExpr)
	assert.True(t, listing.Enabled)
	ratio, ok, _ := ratio_setting.GetModelRatio("upstream-fixture")
	assert.True(t, ok)
	assert.Equal(t, float64(12), ratio)
	assert.Equal(t, float64(4), ratio_setting.GetCompletionRatio("upstream-fixture"))
}

func TestUpstreamCatalogKeyChangeRequiresFreshPricesWithoutChangingListings(t *testing.T) {
	db := upstreamControllerDB(t)
	s := model.UpstreamSource{Name: "source", BaseURL: "https://example.com", CatalogURL: "https://example.com/api/pricing", Adapter: "newapi", Markup: "1.1", PurchaseMultiplier: "1", CatalogKey: "old-key", LatestTime: 1000}
	require.NoError(t, db.Create(&s).Error)
	key := "new-key"
	input := upstreamSourceInput{Name: s.Name, BaseURL: s.BaseURL, CatalogURL: s.CatalogURL, Adapter: s.Adapter, Markup: s.Markup, PurchaseMultiplier: s.PurchaseMultiplier, CatalogKey: &key}
	result := upstreamControllerCall(t, SaveUpstreamSource, http.MethodPut, "/", s.Id, input)
	require.Equal(t, true, result["success"])
	require.NoError(t, db.First(&s, s.Id).Error)
	assert.Zero(t, s.LatestTime, "account-specific catalog prices must be refreshed after changing the access token")
	selection := upstreamSelectionInput{Revision: s.Revision, Models: map[string]string{"example": ""}}
	result = upstreamControllerCall(t, PreviewUpstreamModels, http.MethodPost, "/", s.Id, selection)
	assert.Equal(t, false, result["success"])
	assert.Contains(t, result["message"], "refresh")
}

func TestUpstreamOriginChangeRequiresExplicitKeyReplacementOrClearing(t *testing.T) {
	db := upstreamControllerDB(t)
	s := model.UpstreamSource{Name: "source", BaseURL: "https://example.com", CatalogURL: "https://example.com/api/pricing", Adapter: "newapi", Markup: "1.1", PurchaseMultiplier: "1", CatalogKey: "catalog-secret", RelayKey: "relay-secret"}
	require.NoError(t, db.Create(&s).Error)
	input := upstreamSourceInput{Name: s.Name, BaseURL: "https://other.example.com", CatalogURL: "https://other.example.com/api/pricing", Adapter: s.Adapter, Markup: s.Markup, PurchaseMultiplier: s.PurchaseMultiplier}
	result := upstreamControllerCall(t, SaveUpstreamSource, http.MethodPut, "/", s.Id, input)
	assert.Equal(t, false, result["success"])
	require.NoError(t, db.First(&s, s.Id).Error)
	assert.Equal(t, "https://example.com", s.BaseURL)
	empty := ""
	input.CatalogKey, input.RelayKey = &empty, &empty
	result = upstreamControllerCall(t, SaveUpstreamSource, http.MethodPut, "/", s.Id, input)
	require.Equal(t, true, result["success"])
	require.NoError(t, db.First(&s, s.Id).Error)
	assert.Empty(t, s.CatalogKey)
	assert.Empty(t, s.RelayKey)
}

func TestUpstreamMarkupChangeStaysPendingUntilReviewedWithoutChangingSaleRatio(t *testing.T) {
	db := upstreamControllerDB(t)
	s := model.UpstreamSource{Name: "source", Markup: "1.1", ChannelId: 7}
	require.NoError(t, db.Create(&s).Error)
	q := model.UpstreamQuote{Model: "example", Currency: "USD", Unit: "per_request", Original: model.UpstreamPrices{Request: "20"}, Cost: model.UpstreamPrices{Request: "2"}}
	require.NoError(t, model.SaveUpstreamSnapshot(s.Id, 0, []model.UpstreamQuote{q}))
	l := model.MarketListing{ChannelId: 7, ModelName: q.Model, Ratio: 0.11, Enabled: true}
	require.NoError(t, db.Create(&l).Error)
	require.NoError(t, db.Model(&model.UpstreamReview{}).Where("source_id = ?", s.Id).Updates(map[string]any{"reviewed": true, "listing_id": l.Id, "applied_markup": "1.1", "reviewed_markup": "1.1"}).Error)
	require.NoError(t, db.Model(&s).Update("markup", "1.2").Error)
	result := upstreamControllerCall(t, GetUpstreamSource, http.MethodGet, "/", s.Id, nil)
	rows := result["data"].(map[string]any)["rows"].([]any)
	assert.Equal(t, "changed", rows[0].(map[string]any)["change"])
	require.NoError(t, model.ReviewUpstreamModels(s.Id, 1, []string{q.Model}, false))
	result = upstreamControllerCall(t, GetUpstreamSource, http.MethodGet, "/", s.Id, nil)
	rows = result["data"].(map[string]any)["rows"].([]any)
	assert.Equal(t, "unchanged", rows[0].(map[string]any)["change"])
	require.NoError(t, db.First(&l, l.Id).Error)
	assert.Equal(t, 0.11, l.Ratio)
	var review model.UpstreamReview
	require.NoError(t, db.Where("source_id = ?", s.Id).First(&review).Error)
	assert.Equal(t, "1.1", review.AppliedMarkup)
	assert.Equal(t, "1.2", review.ReviewedMarkup)
}

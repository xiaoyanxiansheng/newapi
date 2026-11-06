package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func TestUpstreamDynamicPublishFreezeAndSettlement(t *testing.T) {
	db := setupMarketRouteTest(t)
	require.NoError(t, db.AutoMigrate(&model.UpstreamSource{}, &model.UpstreamReview{}, &model.UpstreamRefresh{}))
	body := []byte(`{"data":[{"model_name":"upstream-dynamic","billing_mode":"tiered_expr","billing_expr":"(len < 272000 ? tier(\"standard\", p * 5 + c * 30 + cr * 0.5) : tier(\"long\", p * 10 + c * 45 + cr * 1)) * (param(\"service_tier\") == \"fast\" ? 2 : 1)"}],"group_ratio":{"vip":0.22}}`)
	quotes, err := ParseUpstreamCatalog(body, model.UpstreamSource{Adapter: "newapi", PriceGroup: "vip", PurchaseMultiplier: "1"})
	require.NoError(t, err)
	require.Empty(t, quotes[0].PriceIssue)
	source := model.UpstreamSource{Name: "mine", BaseURL: "https://example.com", RelayKey: "test-only", Markup: "1.1", Adapter: "catalog"}
	require.NoError(t, db.Create(&source).Error)
	require.NoError(t, model.SaveUpstreamSnapshot(source.Id, 0, quotes))
	require.NoError(t, db.First(&source, source.Id).Error)
	preview, err := PreviewUpstreamSelection(source, source.Revision, map[string]string{"upstream-dynamic": ""})
	require.NoError(t, err)
	require.Empty(t, preview.Proposals[0].Issue)
	require.Equal(t, 1.0, preview.Proposals[0].Ratio)
	require.Contains(t, preview.Proposals[0].BillingExpr, "p * 1.21")
	require.NoError(t, model.ApplyUpstreamSelection(source.Id, source.Revision, preview.Proposals))
	require.NoError(t, db.First(&source, source.Id).Error)
	listing := model.GetMarketListing(source.ChannelId, "upstream-dynamic")
	require.NotNil(t, listing)
	_, sellable := SellableListing(listing)
	require.True(t, sellable, "a complete dynamic contract requires no global static model price")
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	common.SetContextKey(ctx, constant.ContextKeyTokenRoutes, map[string][]int{"upstream-dynamic": {source.ChannelId}})
	require.NoError(t, func() error { _, e := PrepareRoute(ctx, "upstream-dynamic"); return e }())
	ctx.Set("channel_id", source.ChannelId)
	info := &relaycommon.RelayInfo{OriginModelName: "upstream-dynamic", UsingGroup: "default", UserGroup: "default", BillingRequestInput: &billingexpr.RequestInput{Body: []byte(`{"service_tier":"fast"}`)}}
	info.TieredBillingSnapshot = &billingexpr.BillingSnapshot{BillingMode: "tiered_expr", ExprString: listing.BillingExpr, GroupRatio: 1, QuotaPerUnit: common.QuotaPerUnit, ExprVersion: 1}
	// A later review/refresh never replaces an already-published expression.
	originalSale := listing.BillingExpr
	quotes[0].Description = "new upstream notice"
	require.NoError(t, model.SaveUpstreamSnapshot(source.Id, source.Revision, quotes))
	model.InvalidateMarketListings()
	require.Equal(t, originalSale, model.GetMarketListing(source.ChannelId, "upstream-dynamic").BillingExpr)
	usage := &dto.Usage{PromptTokens: 272000, CompletionTokens: 1000}
	usage.PromptTokensDetails.CachedTokens = 250000
	params := BuildTieredTokenParams(usage, false, billingexpr.UsedVars(info.TieredBillingSnapshot.ExprString))
	ok, quota, result := TryTieredSettle(info, params)
	require.True(t, ok)
	require.Equal(t, 124630, quota)
	require.Equal(t, "long", result.MatchedTier)
	require.True(t, result.RequestRules[0].Matched)
}

func TestUpstreamDynamicRejectsMissingOrUnsupportedContract(t *testing.T) {
	for _, expression := range []string{"", "p * c", "v2:p * 5"} {
		raw, err := common.Marshal(map[string]any{"data": []map[string]any{{"model_name": "dynamic", "billing_mode": "tiered_expr", "billing_expr": expression}}, "group_ratio": map[string]float64{"vip": 0.22}})
		require.NoError(t, err)
		quotes, err := ParseUpstreamCatalog(raw, model.UpstreamSource{Adapter: "newapi", PriceGroup: "vip", PurchaseMultiplier: "1"})
		require.NoError(t, err)
		require.NotEmpty(t, quotes[0].PriceIssue)
		require.Empty(t, quotes[0].CostExpr)
	}
}

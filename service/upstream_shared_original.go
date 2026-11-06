package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/shopspring/decimal"
)

// Reuse model originals, never another source's cost, discount or selling
// configuration. Full expressions take priority over incomplete price cards.
func sharedUpstreamOriginalCatalog() (map[string]model.UpstreamQuote, error) {
	originals := map[string]model.UpstreamQuote{}
	priorities := map[string]int{}
	// These exact legacy Claude models have immutable standard originals. Do
	// not consult the mutable runtime ratio maps, which hold selling prices.
	for _, name := range []string{
		"claude-3-5-haiku-20241022", "claude-3-5-sonnet-20240620",
		"claude-3-5-sonnet-20241022", "claude-3-7-sonnet-20250219",
		"claude-opus-4-20250514", "claude-opus-4-1-20250805",
		"claude-sonnet-4-20250514", "claude-opus-4-5-20251101",
		"claude-sonnet-4-5-20250929",
	} {
		ratio, ok := ratio_setting.GetDefaultModelRatioMap()[name]
		if !ok {
			continue
		}
		input := decimal.NewFromFloat(ratio).Mul(decimal.NewFromInt(2))
		expr := fmt.Sprintf("tier(%q, p * %s + c * %s + cr * %s + cc * %s + cc1h * %s)", "standard", input, input.Mul(decimal.NewFromInt(5)), input.Mul(decimal.RequireFromString("0.1")), input.Mul(decimal.RequireFromString("1.25")), input.Mul(decimal.NewFromInt(2)))
		originals[name] = model.UpstreamQuote{Model: name, Currency: "USD", Unit: "per_million_tokens", BillingMode: billing_setting.BillingModeTieredExpr, BillingExpr: expr, CostExpr: expr, UpstreamRatio: "1"}
		priorities[name] = 1
	}
	var accounts []model.UpstreamAccount
	if err := model.DB.Select("id", "browser_discovery", "discovery_time").Where("disabled = ? OR disabled IS NULL", false).Order("discovery_time desc, id asc").Find(&accounts).Error; err != nil {
		return nil, errors.New("could not read the shared original price catalog")
	}
	for _, account := range accounts {
		if account.BrowserDiscovery == "" {
			continue
		}
		snapshot, err := readStoredUpstreamDiscovery(account)
		if err != nil || len(snapshot.Pricing) == 0 {
			continue
		}
		quotes, err := ParseUpstreamCatalog(snapshot.Pricing, model.UpstreamSource{Adapter: "newapi", PurchaseMultiplier: "1"})
		if err != nil {
			continue
		}
		for _, q := range quotes {
			if q.PriceIssue != "" || q.Currency != "USD" || q.Unit != "per_million_tokens" || upstreamMerchantModel.MatchString(q.Model) || strings.Contains(q.Model, "@") {
				continue
			}
			priority := 0
			if q.BillingExpr != "" {
				priority = 100 + len(billingexpr.UsedVars(q.BillingExpr))
			}
			if _, exists := originals[q.Model]; exists && priorities[q.Model] >= priority {
				continue
			}
			originals[q.Model] = q
			priorities[q.Model] = priority
		}
	}
	return originals, nil
}

// The token-authenticated endpoint resolves group and account overrides for
// this exact Key. Apply the effective rate once, not the nominal group rate.
func sub2APIKeyPurchaseRate(raw []byte) (decimal.Decimal, error) {
	var bill struct {
		Object  string          `json:"object"`
		Version int             `json:"schema_version"`
		Scope   string          `json:"billing_scope"`
		Rate    json.RawMessage `json:"effective_rate_multiplier"`
		Peak    *bool           `json:"peak_rate_enabled"`
	}
	if common.Unmarshal(raw, &bill) != nil || bill.Object != "sub2api.key_billing" || bill.Version != 1 || bill.Scope != "token" || bill.Peak == nil {
		return decimal.Zero, errors.New("this Key's effective purchase multiplier could not be verified")
	}
	if *bill.Peak {
		return decimal.Zero, errors.New("this Key uses peak pricing; verify its full time-based contract before publishing")
	}
	rate, err := upstreamJSONAmount(bill.Rate)
	if err != nil || !rate.IsPositive() {
		return decimal.Zero, errors.New("this Key has an invalid effective purchase multiplier")
	}
	return rate, nil
}

func sharedOriginalPurchaseQuote(original model.UpstreamQuote, rate decimal.Decimal) (model.UpstreamQuote, error) {
	if isSub2APIImageModel(original.Model) {
		return original, errSub2APIImageTokenOriginal
	}
	q := original
	q.UpstreamRatio = rate.String()
	q.DisplayCurrency = "CNY"
	var err error
	if q.BillingExpr != "" {
		q.CostExpr, err = billingexpr.ScalePrices(q.BillingExpr, rate.String())
	} else {
		q.Cost, err = q.Original.Scale(rate)
	}
	if err != nil {
		return q, err
	}
	return q, q.Validate()
}

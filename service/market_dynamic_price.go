package service

import (
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"math"
)

// Public sorting uses final output prices, never the procurement multiplier.
// Dynamic prices are a reference for the default request/context; the full
// selling contract describes long-context and request-dependent prices.
func MarketListingPriceReference(listing *model.MarketListing, pricing model.Pricing) (output float64, discount float64) {
	discount = listing.Ratio
	if listing.BillingMode == "fixed_request" {
		price, err := model.ParseUpstreamAmount(listing.BillingExpr)
		if err != nil {
			return math.MaxFloat64, 1
		}
		output, _ = price.Float64()
		original, err := model.ParseUpstreamAmount(listing.OriginalBillingExpr)
		if err == nil && original.IsPositive() {
			discount, _ = price.Div(original).Float64()
		}
		return output, discount
	}
	if !listing.HasExpressionContract() {
		if pricing.QuotaType == 1 {
			return pricing.ModelPrice * listing.Ratio, discount
		}
		return pricing.ModelRatio * 2 * pricing.CompletionRatio * listing.Ratio, discount
	}
	params := billingexpr.TokenParams{C: 1_000_000}
	sale, _, err := billingexpr.RunExprWithRequest(listing.BillingExpr, params, billingexpr.RequestInput{})
	if err != nil || math.IsNaN(sale) || math.IsInf(sale, 0) || sale < 0 {
		return math.MaxFloat64, 1
	}
	original, _, err := billingexpr.RunExprWithRequest(listing.OriginalBillingExpr, params, billingexpr.RequestInput{})
	if err == nil && original > 0 {
		discount = sale / original
	}
	return sale / 1_000_000, discount
}

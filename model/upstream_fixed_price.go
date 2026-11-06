package model

import (
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"strings"
)

// Fixed upstream prices are frozen per listing. A flat expression keeps every
// token dimension exact, including zero input prices, without a global ratio.
func (p UpstreamPrices) FixedBillingContract(unit string) (mode, expression string, err error) {
	if unit == "per_request" || unit == "per_image" {
		_, err = ParseUpstreamAmount(p.Request)
		return "fixed_request", p.Request, err
	}
	names := []string{"p", "c", "cr", "cc", "img", "ai", "ao"}
	terms := []string{}
	for i, price := range p.Values()[:7] {
		if price == "" {
			continue
		}
		amount, e := ParseUpstreamAmount(price)
		if e != nil {
			return "", "", e
		}
		terms = append(terms, names[i]+" * "+amount.String())
	}
	expression = "tier(\"base\", " + strings.Join(terms, " + ") + ")"
	_, err = billingexpr.CompileFromCache(expression)
	return "fixed_expr", expression, err
}

func (l *MarketListing) HasExpressionContract() bool {
	return l.BillingMode == "tiered_expr" || l.BillingMode == "fixed_expr"
}

func (l *MarketListing) HasPublishedPrice() bool {
	return l.HasExpressionContract() || l.BillingMode == "fixed_request"
}

// Preserve model metadata while replacing the reference price with the
// original price approved for this listing. Procurement details stay private.
func (l *MarketListing) OriginalPricing(metadata Pricing) Pricing {
	metadata.ModelName = l.ModelName
	if l.HasExpressionContract() {
		metadata.BillingMode = "tiered_expr"
		metadata.BillingExpr = l.OriginalBillingExpr
		metadata.QuotaType = 0
	} else if l.BillingMode == "fixed_request" {
		amount, err := ParseUpstreamAmount(l.OriginalBillingExpr)
		if err == nil {
			metadata.ModelPrice, _ = amount.Float64()
		}
		metadata.BillingMode = "ratio"
		metadata.BillingExpr = ""
		metadata.QuotaType = 1
	}
	return metadata
}

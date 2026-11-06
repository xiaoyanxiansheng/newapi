package model

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/shopspring/decimal"
)

// Catalog prices are admin-only reference data; relay billing still uses MarketListing.Ratio.
type UpstreamPrices struct {
	Input       string `json:"input,omitempty"`
	Output      string `json:"output,omitempty"`
	CacheRead   string `json:"cache_read,omitempty"`
	CacheWrite  string `json:"cache_write,omitempty"`
	ImageInput  string `json:"image_input,omitempty"`
	AudioInput  string `json:"audio_input,omitempty"`
	AudioOutput string `json:"audio_output,omitempty"`
	Request     string `json:"request,omitempty"`
}
type UpstreamQuote struct {
	ListingID                   int            `json:"listing_id,omitempty"`
	PriceCNYPerUSD              string         `json:"price_cny_per_usd,omitempty"`
	PricingMode                 string         `json:"pricing_mode,omitempty"`
	BaseModel                   string         `json:"base_model,omitempty"`
	ChannelNo                   string         `json:"channel_no,omitempty"`
	SupplierID                  int            `json:"supplier_id,omitempty"`
	RouteStatus                 string         `json:"route_status,omitempty"`
	LongContextThreshold        int64          `json:"long_context_threshold,omitempty"`
	LongContextInputMultiplier  string         `json:"long_context_input_multiplier,omitempty"`
	LongContextOutputMultiplier string         `json:"long_context_output_multiplier,omitempty"`
	BillingMode                 string         `json:"billing_mode,omitempty"`
	BillingExpr                 string         `json:"billing_expr,omitempty"`
	CostExpr                    string         `json:"cost_expr,omitempty"`
	DisplayCurrency             string         `json:"display_currency,omitempty"`
	UpstreamRatio               string         `json:"upstream_ratio,omitempty"`
	PriceGroup                  string         `json:"price_group,omitempty"`
	Model                       string         `json:"model"`
	Description                 string         `json:"description,omitempty"`
	GroupDescription            string         `json:"group_description,omitempty"`
	Unit                        string         `json:"unit"`
	Currency                    string         `json:"currency"`
	Original                    UpstreamPrices `json:"original"`
	Cost                        UpstreamPrices `json:"cost"`
	PriceIssue                  string         `json:"price_issue,omitempty"`
}

func (p *UpstreamPrices) UnmarshalJSON(data []byte) error {
	var fields map[string]any
	if err := common.Unmarshal(data, &fields); err != nil {
		return err
	}
	allowed := map[string]bool{"input": true, "output": true, "cache_read": true, "cache_write": true, "image_input": true, "audio_input": true, "audio_output": true, "request": true}
	for field := range fields {
		if !allowed[field] {
			return fmt.Errorf("unsupported price dimension %s; review this model's pricing manually", field)
		}
	}
	type priceFields UpstreamPrices
	return common.Unmarshal(data, (*priceFields)(p))
}

var upstreamDecimalPattern = regexp.MustCompile(`^[0-9]+(?:[.][0-9]+)?(?:[eE][+-]?[0-9]{1,2})?$`)

func ParseUpstreamAmount(text string) (decimal.Decimal, error) {
	if len(text) == 0 || len(text) > 48 || !upstreamDecimalPattern.MatchString(text) {
		return decimal.Zero, errors.New("price must be an explicit non-negative decimal")
	}
	value, err := decimal.NewFromString(text)
	if err != nil || value.IsNegative() || value.GreaterThan(decimal.NewFromInt(1_000_000)) || !value.Equal(value.Round(12)) {
		return decimal.Zero, errors.New("price exceeds the supported range or 12 decimal places")
	}
	return value, nil
}
func ParseUpstreamMarkup(text string) (decimal.Decimal, error) {
	value, err := ParseUpstreamAmount(text)
	if err != nil || value.LessThan(decimal.NewFromInt(1)) || value.GreaterThan(decimal.NewFromInt(100)) {
		return decimal.Zero, errors.New("markup must be between 1 and 100")
	}
	return value, nil
}
func (p UpstreamPrices) Values() []string {
	return []string{p.Input, p.Output, p.CacheRead, p.CacheWrite, p.ImageInput, p.AudioInput, p.AudioOutput, p.Request}
}
func (p UpstreamPrices) Scale(multiplier decimal.Decimal) (UpstreamPrices, error) {
	values := p.Values()
	for i, text := range values {
		if text == "" {
			continue
		}
		amount, err := ParseUpstreamAmount(text)
		if err != nil {
			return UpstreamPrices{}, err
		}
		values[i] = amount.Mul(multiplier).String()
		if _, err := ParseUpstreamAmount(values[i]); err != nil {
			return UpstreamPrices{}, err
		}
	}
	return UpstreamPrices{values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7]}, nil
}
func (q UpstreamQuote) Validate() error {
	if strings.TrimSpace(q.Model) == "" || len(q.Model) > 255 || strings.ContainsAny(q.Model, ", \t\r\n") {
		return errors.New("invalid model identifier")
	}
	if q.PriceIssue != "" {
		return nil
	}
	if q.Currency != "USD" && !(q.PricingMode == "model_routes" && q.Currency == "CNY") {
		return errors.New("provide prices in the supported currency")
	}
	if q.PricingMode != "" && q.PricingMode != "model_routes" {
		return errors.New("unsupported procurement pricing mode")
	}
	if q.PricingMode == "model_routes" && (q.BaseModel == "" || !strings.HasPrefix(q.Model, q.BaseModel+"@s")) {
		return errors.New("merchant pricing requires its complete access model")
	}
	if q.PricingMode == "model_routes" {
		rate, err := ParseUpstreamAmount(q.PriceCNYPerUSD)
		if q.ListingID <= 0 || err != nil || !rate.IsPositive() || rate.GreaterThan(decimal.NewFromInt(1000)) {
			return errors.New("refresh this Key's joined routes and CNY prices before publishing")
		}
	}
	if q.BillingMode == billing_setting.BillingModeTieredExpr {
		if q.Unit != "per_million_tokens" {
			return errors.New("dynamic pricing requires token units")
		}
		if q.PricingMode == "model_routes" {
			// Official reference and the merchant purchase contract are independent.
			// realtime_ratio is descriptive; never apply it to a quoted cost again.
			if err := billing_setting.SmokeTestExpr(q.BillingExpr); err != nil {
				return err
			}
			return billing_setting.SmokeTestExpr(q.CostExpr)
		}
		expected, err := billingexpr.ScalePrices(q.BillingExpr, q.UpstreamRatio)
		if err != nil {
			return err
		}
		if expected != q.CostExpr {
			return errors.New("dynamic purchase contract does not match the verified group multiplier")
		}
		return billing_setting.SmokeTestExpr(q.CostExpr)
	}
	if q.BillingMode != "" && q.BillingMode != "ratio" {
		return errors.New("unsupported billing mode")
	}
	if q.Unit == "per_request" || q.Unit == "per_image" {
		if q.Original.Request == "" || q.Cost.Request == "" {
			return errors.New("request prices are required")
		}
		for _, p := range []UpstreamPrices{q.Original, q.Cost} {
			for _, v := range p.Values()[:7] {
				if v != "" {
					return errors.New("request and token prices cannot be mixed")
				}
			}
		}
	} else if q.Unit == "per_million_tokens" {
		if q.Original.Input == "" || q.Original.Output == "" || q.Cost.Input == "" || q.Cost.Output == "" {
			return errors.New("input and output prices are required")
		}
		if q.Original.Request != "" || q.Cost.Request != "" {
			return errors.New("request and token prices cannot be mixed")
		}
	} else {
		return errors.New("use per_million_tokens, per_request or per_image units")
	}
	for i, v := range q.Original.Values() {
		cost := q.Cost.Values()[i]
		if q.PricingMode != "model_routes" && (v == "") != (cost == "") {
			return errors.New("original and purchase price dimensions must match")
		}
		if v != "" {
			if _, err := ParseUpstreamAmount(v); err != nil {
				return err
			}
		}
		if cost != "" {
			if _, err := ParseUpstreamAmount(cost); err != nil {
				return err
			}
		}
	}
	return nil
}

// Derive a single existing listing ratio only when every priced dimension agrees.
func DeriveUpstreamListingRatio(base UpstreamPrices, q UpstreamQuote, markup string) (float64, UpstreamPrices, error) {
	if err := q.Validate(); err != nil {
		return 0, UpstreamPrices{}, err
	}
	if q.PriceIssue != "" {
		return 0, UpstreamPrices{}, errors.New(q.PriceIssue)
	}
	multiplier, err := ParseUpstreamMarkup(markup)
	if err != nil {
		return 0, UpstreamPrices{}, err
	}
	sale, err := q.Cost.Scale(multiplier)
	if err != nil {
		return 0, UpstreamPrices{}, err
	}
	var ratio decimal.Decimal
	found := false
	labels := []string{"input", "output", "cache read", "cache write", "image input", "audio input", "audio output", "request"}
	for i, text := range base.Values() {
		target := sale.Values()[i]
		if text == "" && target == "" {
			continue
		}
		if text == "" || target == "" {
			return 0, UpstreamPrices{}, fmt.Errorf("%s price is missing from the upstream or local configuration; review model pricing first", labels[i])
		}
		b, err := ParseUpstreamAmount(text)
		if err != nil {
			return 0, UpstreamPrices{}, err
		}
		desired, err := ParseUpstreamAmount(target)
		if err != nil {
			return 0, UpstreamPrices{}, err
		}
		if b.IsZero() {
			if !desired.IsZero() {
				return 0, UpstreamPrices{}, fmt.Errorf("%s price cannot use the existing ratio", labels[i])
			}
			continue
		}
		candidate := desired.DivRound(b, 12)
		if !found {
			ratio = candidate
			found = true
		}
		tolerance := desired.Abs().Mul(decimal.NewFromFloat(1e-10)).Add(decimal.NewFromFloat(1e-12))
		if b.Mul(ratio).Sub(desired).Abs().GreaterThan(tolerance) {
			return 0, UpstreamPrices{}, errors.New("input, output or cache prices require different ratios; adjust existing model pricing manually before applying")
		}
	}
	if !found || !ratio.IsPositive() || ratio.GreaterThan(decimal.NewFromInt(1_000_000)) {
		return 0, UpstreamPrices{}, errors.New("a positive representable listing ratio is required")
	}
	f, _ := ratio.Float64()
	return f, sale, nil
}

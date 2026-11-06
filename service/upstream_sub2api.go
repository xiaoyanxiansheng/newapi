package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/shopspring/decimal"
)

type sub2APIPlazaGroup struct {
	ID          int                 `json:"id"`
	Name        string              `json:"name"`
	Description string              `json:"description"`
	Rate        json.RawMessage     `json:"rate_multiplier"`
	UserRate    json.RawMessage     `json:"user_rate_multiplier"`
	PeakEnabled bool                `json:"peak_rate_enabled"`
	Models      []sub2APIPlazaModel `json:"models"`
}

type sub2APIPlazaModel struct {
	Name         string                     `json:"name"`
	Pricing      map[string]json.RawMessage `json:"pricing"`
	ContextBasis string                     `json:"long_context_basis"`
	TimePricing  json.RawMessage            `json:"time_pricing"`
}

var errSub2APIGroupPricesAbsent = errors.New("the upstream website has not exposed model prices for this Key's group; confirm its full pricing rules with the provider before publishing")
var errSub2APICatalogUnavailable = errors.New("this model has no confirmed shared original price")

// The authorized browser supplies both endpoints. Rates must belong to this
// Key's group; missing original prices can be resolved separately.
func parseSub2APIGroupCatalog(raw json.RawMessage, key UpstreamDiscoveredKey) ([]model.UpstreamQuote, error) {
	var snapshot struct {
		Catalog *struct {
			Code *int `json:"code"`
			Data struct {
				Groups []sub2APIPlazaGroup `json:"groups"`
			} `json:"data"`
		} `json:"catalog"`
		Rates struct {
			Code *int                       `json:"code"`
			Data map[string]json.RawMessage `json:"data"`
		} `json:"group_rates"`
	}
	if err := common.Unmarshal(raw, &snapshot); err != nil {
		return nil, errors.New("authorize the upstream Key page again to read its group catalog and account-specific rates")
	}
	// Some Sub2API deployments omit the plaza endpoint entirely. The saved
	// Key remains usable: original contracts and the live Key billing endpoint
	// can verify token prices without an account-session refresh.
	if snapshot.Catalog == nil {
		return nil, errSub2APICatalogUnavailable
	}
	if snapshot.Catalog.Code == nil || *snapshot.Catalog.Code != 0 || snapshot.Rates.Code == nil || *snapshot.Rates.Code != 0 || snapshot.Rates.Data == nil || snapshot.Catalog.Data.Groups == nil {
		return nil, errors.New("authorize the upstream Key page again to read its group catalog and account-specific rates")
	}
	if key.GroupID <= 0 {
		return nil, errors.New("this Key's price group ID is unconfirmed; authorize its Key page again")
	}
	var group *sub2APIPlazaGroup
	for i := range snapshot.Catalog.Data.Groups {
		candidate := &snapshot.Catalog.Data.Groups[i]
		if candidate.ID != key.GroupID {
			continue
		}
		if group != nil || candidate.Name != key.Group {
			return nil, errors.New("the authorized price group does not match this Key")
		}
		group = candidate
	}
	if group == nil {
		return nil, errSub2APIGroupPricesAbsent
	}
	rateRaw := group.Rate
	if override, ok := snapshot.Rates.Data[strconv.Itoa(group.ID)]; ok {
		rateRaw = override
	} else if len(group.UserRate) > 0 && string(group.UserRate) != "null" {
		return nil, errors.New("the account-specific group rate could not be verified; previous prices were preserved")
	}
	rate, err := upstreamJSONAmount(rateRaw)
	if err != nil || !rate.IsPositive() {
		return nil, errors.New("the authorized group has an invalid purchase multiplier")
	}
	if len(group.Models) > 10000 {
		return nil, errors.New("upstream group exceeds the supported model limit")
	}
	quotes := make([]model.UpstreamQuote, 0, len(group.Models))
	seen := map[string]bool{}
	for _, entry := range group.Models {
		if seen[entry.Name] {
			return nil, errors.New("the authorized group has duplicate model prices")
		}
		seen[entry.Name] = true
		q := model.UpstreamQuote{Model: entry.Name, Currency: "USD", DisplayCurrency: "CNY", Unit: "per_million_tokens", PriceGroup: key.Group, GroupDescription: group.Description, UpstreamRatio: rate.String()}
		if group.PeakEnabled {
			q.PriceIssue = "this upstream group uses peak pricing; verify its full time-based contract before publishing"
		} else {
			q, err = sub2APIModelQuote(q, entry, rate)
			if err != nil {
				q.PriceIssue = err.Error()
			}
		}
		quotes = append(quotes, q)
	}
	return model.NormalizeUpstreamCatalog(quotes)
}

func sub2APIModelQuote(q model.UpstreamQuote, entry sub2APIPlazaModel, rate decimal.Decimal) (model.UpstreamQuote, error) {
	var mode string
	if common.Unmarshal(entry.Pricing["billing_mode"], &mode) != nil {
		return q, errors.New("this upstream model has no confirmed billing unit")
	}
	for _, field := range []string{"reasoning_effort_multipliers", "image_prices", "video_prices"} {
		raw := strings.TrimSpace(string(entry.Pricing[field]))
		if raw != "" && raw != "null" && raw != "{}" {
			return q, errors.New("this upstream model has additional request-dependent prices; verify its full contract before publishing")
		}
	}
	if len(entry.TimePricing) > 0 && string(entry.TimePricing) != "null" {
		return q, errors.New("this upstream model uses time-based pricing; verify its full contract before publishing")
	}
	var intervals []map[string]json.RawMessage
	if raw := entry.Pricing["intervals"]; len(raw) > 0 && common.Unmarshal(raw, &intervals) != nil {
		return q, errors.New("this upstream model has invalid pricing tiers")
	}
	if mode == "per_request" {
		if len(intervals) > 0 {
			return q, errors.New("tiered request prices require manual verification")
		}
		price, err := upstreamJSONAmount(entry.Pricing["per_request_price"])
		if err != nil {
			return q, errors.New("this upstream model has no confirmed request price")
		}
		q.Unit = "per_request"
		q.Original.Request, q.Cost.Request = price.String(), price.Mul(rate).String()
		return q, q.Validate()
	}
	if mode != "token" {
		return q, errors.New("this upstream model uses an unsupported billing unit")
	}
	if len(intervals) > 32 {
		return q, errors.New("this upstream model exceeds the supported pricing tier limit")
	}
	expression, err := sub2APIPriceExpression(entry.Pricing)
	if err != nil {
		return q, err
	}
	if len(intervals) > 0 {
		if len(intervals) > 1 && entry.ContextBasis != "whole_request" {
			return q, errors.New("this upstream model's context pricing basis is unconfirmed")
		}
		type tier struct {
			min    int64
			max    *int64
			prices map[string]json.RawMessage
		}
		tiers := make([]tier, 0, len(intervals))
		for _, values := range intervals {
			var minTokens int64
			var maxTokens *int64
			if common.Unmarshal(values["min_tokens"], &minTokens) != nil || common.Unmarshal(values["max_tokens"], &maxTokens) != nil || minTokens < 0 || minTokens > 1000000000 || (maxTokens != nil && (*maxTokens <= minTokens || *maxTokens > 1000000000)) {
				return q, errors.New("this upstream model has invalid context pricing boundaries")
			}
			// The plaza supplies absolute effective tier prices. Relative or missing
			// tier dimensions must not be approximated from the base price card.
			for _, field := range []string{"input_multiplier", "output_multiplier", "cache_write_multiplier", "cache_read_multiplier"} {
				raw := values[field]
				if len(raw) > 0 && string(raw) != "null" {
					return q, errors.New("relative upstream pricing tiers require manual verification")
				}
			}
			tiers = append(tiers, tier{min: minTokens, max: maxTokens, prices: values})
		}
		sort.Slice(tiers, func(i, j int) bool { return tiers[i].min < tiers[j].min })
		for i, row := range tiers {
			if (i == 0 && row.min != 0) || (i > 0 && (tiers[i-1].max == nil || *tiers[i-1].max != row.min)) || (i == len(tiers)-1 && row.max != nil) {
				return q, errors.New("this upstream model has incomplete or overlapping context tiers")
			}
		}
		for i := len(tiers) - 1; i >= 0; i-- {
			// Context schedules keep media prices on the base card; those
			// constant dimensions must survive switching the token tier.
			for _, field := range []string{"image_input_price", "image_output_price"} {
				if _, present := tiers[i].prices[field]; !present {
					tiers[i].prices[field] = entry.Pricing[field]
				}
			}
			terms, priceErr := sub2APIPriceExpression(tiers[i].prices)
			if priceErr != nil {
				return q, priceErr
			}
			terms = fmt.Sprintf("tier(%q, %s)", "context_"+strconv.Itoa(i+1), terms)
			if i == len(tiers)-1 {
				expression = terms
			} else {
				expression = fmt.Sprintf("len <= %d ? %s : (%s)", *tiers[i].max, terms, expression)
			}
		}
	} else {
		expression = "tier(\"standard\", " + expression + ")"
	}
	q.BillingMode = billing_setting.BillingModeTieredExpr
	q.BillingExpr = expression
	q.CostExpr, err = billingexpr.ScalePrices(expression, rate.String())
	if err != nil {
		return q, err
	}
	return q, q.Validate()
}

// Sub2API plaza prices are per token. The local expression stores per-million
// coefficients and preserves explicit zero and separate 5m/1h cache prices.
func sub2APIPriceExpression(prices map[string]json.RawMessage) (string, error) {
	terms := []string{}
	for _, dimension := range []struct {
		field, variable string
		required        bool
	}{
		{"input_price", "p", true}, {"output_price", "c", true},
		{"cache_read_price", "cr", false}, {"cache_write_price", "cc", false},
		{"cache_write_1h_price", "cc1h", false}, {"image_input_price", "img", false}, {"image_output_price", "img_o", false},
	} {
		raw := prices[dimension.field]
		if len(raw) == 0 || string(raw) == "null" {
			if dimension.required {
				return "", errors.New("this upstream model has missing input or output prices")
			}
			if !strings.HasPrefix(dimension.field, "cache_") {
				continue
			}
			// Effective plaza cache prices are nil when that class is not
			// charged. Keep its variable so OpenAI usage normalization excludes
			// those tokens from ordinary input instead of charging them twice.
			raw = json.RawMessage("0")
		}
		amount, err := upstreamJSONAmount(raw)
		if err != nil {
			return "", errors.New("this upstream model has an invalid token price")
		}
		coefficient := amount.Mul(decimal.NewFromInt(1000000)).String()
		if _, err := model.ParseUpstreamAmount(coefficient); err != nil {
			return "", errors.New("this upstream token price exceeds the supported range")
		}
		// A zero image price is an unused dimension, not a separate free input
		// class. Cache zeroes are real observed discounts and must be retained.
		if amount.IsZero() && strings.HasPrefix(dimension.field, "image_") {
			continue
		}
		terms = append(terms, dimension.variable+" * "+coefficient)
	}
	return strings.Join(terms, " + "), nil
}

package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/shopspring/decimal"
)

// These are reference quotes, not confirmed Key bindings or publishing inputs.
type UpstreamRouteQuote struct {
	AccessModel       string               `json:"access_model"`
	SupplierID        int                  `json:"supplier_id,omitempty"`
	ChannelNo         string               `json:"channel_no,omitempty"`
	ListingID         int                  `json:"listing_id,omitempty"`
	Unit              string               `json:"unit"`
	Prices            model.UpstreamPrices `json:"prices"`
	Original          model.UpstreamPrices `json:"original"`
	Multiplier        string               `json:"multiplier,omitempty"`
	MultiplierSource  string               `json:"multiplier_source,omitempty"`
	InputCoefficient  string               `json:"input_coefficient,omitempty"`
	OutputCoefficient string               `json:"output_coefficient,omitempty"`
	Origin            string               `json:"origin"`
	Status            string               `json:"status,omitempty"`
	AccessVerified    bool                 `json:"access_verified"`
	Issue             string               `json:"issue,omitempty"`
}

type UpstreamModelRouteQuotes struct {
	Model  string               `json:"model"`
	Routes []UpstreamRouteQuote `json:"routes"`
}

type UpstreamRouteQuotes struct {
	ReadOnly      bool                       `json:"read_only"`
	Currency      string                     `json:"currency"`
	SourceID      int                        `json:"source_id"`
	SnapshotTime  int64                      `json:"snapshot_time"`
	SnapshotStale bool                       `json:"snapshot_stale"`
	QuoteTime     int64                      `json:"quote_time"`
	Origin        string                     `json:"origin"`
	ModelCount    int                        `json:"model_count"`
	RouteCount    int                        `json:"route_count"`
	Issues        []string                   `json:"issues"`
	Models        []UpstreamModelRouteQuotes `json:"models"`
}

type upstreamMarketplaceRoute struct {
	CNYPerUSD            string          `json:"-"`
	ID                   int             `json:"id"`
	Model                string          `json:"base_model"`
	Alias                string          `json:"alias"`
	SupplierID           int             `json:"supplier_id"`
	ChannelNo            string          `json:"channel_no"`
	ChargeType           string          `json:"charge_type"`
	Input                json.RawMessage `json:"input_price_usd"`
	Output               json.RawMessage `json:"output_price_usd"`
	CacheRead            json.RawMessage `json:"cache_read_price_usd"`
	CacheWrite           json.RawMessage `json:"cache_write_price_usd"`
	OriginalInput        json.RawMessage `json:"official_input_price_usd"`
	OriginalOutput       json.RawMessage `json:"official_output_price_usd"`
	Multiplier           json.RawMessage `json:"realtime_ratio"`
	Status               string          `json:"status"`
	Description          string          `json:"description"`
	LongContextThreshold int64           `json:"long_ctx_threshold_tokens"`
	LongContextInput     json.RawMessage `json:"long_ctx_input_multiplier"`
	LongContextOutput    json.RawMessage `json:"long_ctx_output_multiplier"`
	ChannelAlive         *bool           `json:"channel_alive"`
}

// The suffix is an upstream merchant access identifier, not a price or a group.
var upstreamMerchantModel = regexp.MustCompile(`^(.+)@s([1-9][0-9]*)c([1-9][0-9]*)$`)
var upstreamRouteAmount = regexp.MustCompile(`^[0-9]+(?:[.][0-9]+)?(?:[eE][+-]?[0-9]{1,2})?$`)

func GetUpstreamRouteQuotes(ctx context.Context, account model.UpstreamAccount, source model.UpstreamSource, keyword string) (UpstreamRouteQuotes, error) {
	client := NewUpstreamHTTPClient()
	defer client.CloseIdleConnections()
	return inspectUpstreamRouteQuotes(ctx, account, source, keyword, client)
}

func inspectUpstreamRouteQuotes(ctx context.Context, account model.UpstreamAccount, source model.UpstreamSource, keyword string, client *http.Client) (UpstreamRouteQuotes, error) {
	result := UpstreamRouteQuotes{ReadOnly: true, Currency: "CNY", SourceID: source.Id, SnapshotTime: account.DiscoveryTime, SnapshotStale: account.DiscoveryTime < common.GetTimestamp()-600, Issues: []string{}, Models: []UpstreamModelRouteQuotes{}}
	if account.Id <= 0 || source.AccountId != account.Id || account.DiscoveryMode == "" {
		return result, errors.New("route quotes require an authorized upstream Key page snapshot")
	}
	// An older snapshot remains useful for read-only inspection; its age is explicit.
	// Do not call the refresh flow, which updates Keys, catalogs and revisions.
	snapshot, err := readStoredUpstreamDiscovery(account)
	if err != nil {
		return result, err
	}
	var key *UpstreamDiscoveredKey
	for i := range snapshot.Keys {
		if snapshot.Keys[i].ID == source.RemoteKeyId {
			key = &snapshot.Keys[i]
			break
		}
	}
	if key == nil {
		return result, errors.New("the authorized snapshot does not contain this Key; authorize its page again")
	}
	if key.JoinedRoutes == nil {
		result.Issues = append(result.Issues, "joined_routes_not_read")
		if key.JoinedRoutesIssue != "" {
			result.Issues = append(result.Issues, "joined_routes_"+key.JoinedRoutesIssue)
		}
		return result, nil
	}
	joined := map[int]UpstreamJoinedRoute{}
	joinedAliases := map[string]bool{}
	for _, pin := range key.JoinedRoutes {
		joined[pin.ListingID] = pin
		if pin.Alias != "" {
			joinedAliases[pin.Alias] = true
		}
	}
	scope := map[string]bool{}
	if key.Models != nil {
		for _, name := range key.Models {
			scope[name] = true
		}
	} else {
		var catalog []model.UpstreamQuote
		if source.LatestJSON != "" {
			if err := common.UnmarshalJsonStr(source.LatestJSON, &catalog); err != nil {
				return result, errors.New("the saved Key model catalog could not be read")
			}
		}
		for _, quote := range catalog {
			scope[quote.Model] = true
		}
	}
	if len(scope) == 0 {
		result.Issues = append(result.Issues, "key_model_scope_unconfirmed")
		return result, nil
	}

	byModel := map[string][]UpstreamRouteQuote{}
	marketplace, err := fetchUpstreamMarketplaceRoutes(ctx, account.Website, client)
	if err == nil {
		for _, row := range marketplace {
			pin, ok := joined[row.ID]
			if !ok || !joinedRouteMatches(pin, row.ID, row.Model, row.Alias) {
				continue
			}
			if !scope[row.Model] && !scope[row.Alias] {
				continue
			}
			if row.Model == "" || row.Alias == "" {
				continue
			}
			byModel[row.Model] = append(byModel[row.Model], marketplaceRouteQuote(row))
		}
		result.Origin = "public_marketplace"
		result.QuoteTime = common.GetTimestamp()
	} else {
		result.Issues = append(result.Issues, "marketplace_unavailable_using_snapshot")
		result.Origin = "authorized_pricing_snapshot"
		result.QuoteTime = account.DiscoveryTime
		var pricing struct {
			Success *bool                `json:"success"`
			Data    []upstreamPricingRow `json:"data"`
		}
		if len(snapshot.Pricing) == 0 || common.Unmarshal(snapshot.Pricing, &pricing) != nil || pricing.Data == nil || (pricing.Success != nil && !*pricing.Success) {
			result.Issues = append(result.Issues, "pricing_snapshot_unavailable")
			return result, nil
		}
		var status struct {
			Data struct {
				Unit float64 `json:"quota_per_unit"`
			} `json:"data"`
		}
		_ = common.Unmarshal(snapshot.Status, &status)
		for _, row := range pricing.Data {
			if !joinedAliases[row.Model] {
				continue
			}
			base := row.Model
			if match := upstreamMerchantModel.FindStringSubmatch(row.Model); match != nil {
				base = match[1]
			}
			if !scope[base] && !scope[row.Model] {
				continue
			}
			route := UpstreamRouteQuote{AccessModel: row.Model, Origin: result.Origin, Issue: "model_multiplier_not_provided"}
			route.InputCoefficient = optionalUpstreamRouteAmount(row.Ratio)
			route.OutputCoefficient = optionalUpstreamRouteAmount(row.Completion)
			if row.BillingMode == "tiered_expr" {
				route.Issue = "tiered_price_requires_contract"
			} else if row.QuotaType != nil && *row.QuotaType == 0 && status.Data.Unit != 500000 {
				route.Issue = "pricing_unit_unconfirmed"
			} else if quote, err := normalizeUpstreamPrice(row, decimal.NewFromInt(1)); err == nil {
				route.Unit, route.Prices = quote.Unit, quote.Original
			} else {
				route.Issue = "route_price_unconfirmed"
			}
			// model_ratio is a pricing coefficient, never a fabricated discount.
			byModel[base] = append(byModel[base], route)
		}
	}
	keyword = strings.ToLower(strings.TrimSpace(keyword))
	for name, routes := range byModel {
		filtered := make([]UpstreamRouteQuote, 0, len(routes))
		seen := map[string]bool{}
		for _, route := range routes {
			if seen[route.AccessModel] {
				return result, errors.New("upstream returned duplicate access-model quotes; review its route identifiers")
			}
			seen[route.AccessModel] = true
			if keyword == "" || strings.Contains(strings.ToLower(name), keyword) || strings.Contains(strings.ToLower(route.AccessModel), keyword) || strings.Contains(strings.ToLower(route.ChannelNo), keyword) || strings.ToLower(fmt.Sprintf("ID%05d", route.ListingID)) == keyword || fmt.Sprint(route.ListingID) == keyword {
				filtered = append(filtered, route)
			}
		}
		if len(filtered) == 0 {
			continue
		}
		sort.Slice(filtered, func(i, j int) bool { return filtered[i].AccessModel < filtered[j].AccessModel })
		result.Models = append(result.Models, UpstreamModelRouteQuotes{Model: name, Routes: filtered})
		result.RouteCount += len(filtered)
	}
	sort.Slice(result.Models, func(i, j int) bool { return result.Models[i].Model < result.Models[j].Model })
	result.ModelCount = len(result.Models)
	return result, nil
}

func fetchUpstreamMarketplaceRoutes(ctx context.Context, origin string, client *http.Client) ([]upstreamMarketplaceRoute, error) {
	if err := ValidateUpstreamURL(origin); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(origin, "/")+"/api/marketplace/listings?sort=price_asc", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	// This public request forwards neither the Key nor browser/session credentials.
	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("public marketplace returned HTTP %d", response.StatusCode)
	}
	const limit = 8 * 1024 * 1024
	body, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || len(body) > limit {
		return nil, errors.New("public marketplace response exceeds the read limit")
	}
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			Items []upstreamMarketplaceRoute `json:"items"`
			Total int                        `json:"total"`
			FX    json.RawMessage            `json:"fx_rate_cny_per_usd"`
		} `json:"data"`
	}
	if common.Unmarshal(body, &envelope) != nil || !envelope.Success || envelope.Data.Items == nil || envelope.Data.Total > len(envelope.Data.Items) {
		return nil, errors.New("public marketplace does not provide a complete route quote list")
	}
	fx := optionalUpstreamRouteAmount(envelope.Data.FX)
	rate, err := decimal.NewFromString(fx)
	if err != nil || !rate.IsPositive() || rate.GreaterThan(decimal.NewFromInt(1000)) {
		return nil, errors.New("upstream marketplace CNY display rate is unconfirmed")
	}
	for i := range envelope.Data.Items {
		envelope.Data.Items[i].CNYPerUSD = fx
	}
	return envelope.Data.Items, nil
}

func optionalUpstreamRouteAmount(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	text := strings.TrimSpace(string(raw))
	if strings.HasPrefix(text, string(rune(34))) {
		if common.Unmarshal(raw, &text) != nil {
			return ""
		}
	}
	if len(text) > 64 || !upstreamRouteAmount.MatchString(text) {
		return ""
	}
	amount, err := decimal.NewFromString(text)
	// Inspection preserves upstream precision, without relaxing publishing rules.
	if err != nil || amount.IsNegative() || amount.GreaterThan(decimal.NewFromInt(1_000_000)) {
		return ""
	}
	return amount.String()
}

func marketplaceRouteQuote(row upstreamMarketplaceRoute) UpstreamRouteQuote {
	route := UpstreamRouteQuote{AccessModel: row.Alias, SupplierID: row.SupplierID, ChannelNo: row.ChannelNo, ListingID: row.ID, Origin: "public_marketplace", Status: row.Status}
	fx, err := decimal.NewFromString(row.CNYPerUSD)
	if err != nil || !fx.IsPositive() || fx.GreaterThan(decimal.NewFromInt(1000)) {
		route.Issue = "upstream marketplace CNY display rate is unconfirmed"
		return route
	}
	input, output := optionalUpstreamRouteAmount(row.Input), optionalUpstreamRouteAmount(row.Output)
	switch row.ChargeType {
	case "per_token":
		route.Unit = "per_million_tokens"
		route.Prices = model.UpstreamPrices{Input: input, Output: output, CacheRead: optionalUpstreamRouteAmount(row.CacheRead), CacheWrite: optionalUpstreamRouteAmount(row.CacheWrite)}
		route.Original = model.UpstreamPrices{Input: optionalUpstreamRouteAmount(row.OriginalInput), Output: optionalUpstreamRouteAmount(row.OriginalOutput)}
		if input == "" || output == "" {
			route.Issue = "route_price_unconfirmed"
		}
	case "per_request":
		route.Unit = "per_request"
		route.Prices.Request = input
		if input == "" {
			route.Issue = "route_price_unconfirmed"
		}
	default:
		route.Issue = "pricing_unit_unconfirmed"
	}
	// Match the marketplace's CNY view, including its cache/per-call prices.
	// Official face values are retained as the site's RMB multiplier reference.
	values := route.Prices.Values()
	for i, text := range values {
		if text == "" {
			continue
		}
		amount, _ := decimal.NewFromString(text)
		values[i] = amount.Mul(fx).Round(12).String()
		if _, err := model.ParseUpstreamAmount(values[i]); err != nil {
			route.Issue = "route_price_unconfirmed"
			return route
		}
	}
	route.Prices = model.UpstreamPrices{Input: values[0], Output: values[1], CacheRead: values[2], CacheWrite: values[3], Request: values[7]}
	if route.Unit == "per_million_tokens" && route.Prices.Input != "" && route.Original.Input != "" {
		price, _ := decimal.NewFromString(route.Prices.Input)
		official, _ := decimal.NewFromString(route.Original.Input)
		if official.IsPositive() {
			route.Multiplier = price.DivRound(official, 12).String()
			route.MultiplierSource = "upstream_cny_page_rule"
		}
	}
	return route
}

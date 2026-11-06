package service

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/shopspring/decimal"
)

var joinedRoutesHTTPIssue = regexp.MustCompile(`^http_([1-5][0-9]{2})$`)

func validJoinedRoutesIssue(issue string) bool {
	return joinedRoutesHTTPIssue.MatchString(issue) || issue == "request_failed" || issue == "response_too_large" || issue == "upstream_rejected" || issue == "invalid_response" || issue == "invalid_key_routes"
}

func joinedRoutesReadError(key UpstreamDiscoveredKey) error {
	if match := joinedRoutesHTTPIssue.FindStringSubmatch(key.JoinedRoutesIssue); match != nil {
		return fmt.Errorf("joined route reading returned HTTP %s from /api/marketplace/pins; sign in on the upstream Key page and retry authorization", match[1])
	}
	switch key.JoinedRoutesIssue {
	case "invalid_response", "invalid_key_routes":
		return errors.New("joined route response format could not be verified; existing routes and prices were preserved")
	case "upstream_rejected":
		return errors.New("upstream rejected joined route reading; check access to the upstream Key route page")
	case "request_failed", "response_too_large":
		return errors.New("joined route request could not be completed; open the upstream Key page and retry authorization")
	default:
		return errors.New("this authorization did not report joined route reading; replace the bookmark from the connection dialog and authorize the upstream Key page")
	}
}

// Listing ID is the membership identity. Optional browser enrichment must agree
// with that exact quote, and never turns a base model into all its merchants.
func joinedRouteMatches(pin UpstreamJoinedRoute, id int, base, alias string) bool {
	return pin.ListingID == id && (pin.Model == "" || pin.Model == base) && (pin.Alias == "" || pin.Alias == alias)
}

// Apply the current authorized route selection to saved catalogs too, so old
// over-imported candidates cannot remain visible or pass publication preview.
func FilterUpstreamJoinedCatalog(source model.UpstreamSource, quotes []model.UpstreamQuote) ([]model.UpstreamQuote, error) {
	if source.PricingMode != "model_routes" || source.AccountId == 0 {
		return quotes, nil
	}
	var account model.UpstreamAccount
	if err := model.DB.First(&account, source.AccountId).Error; err != nil {
		return nil, err
	}
	snapshot, err := readStoredUpstreamDiscovery(account)
	if err != nil {
		return nil, err
	}
	var joined []UpstreamJoinedRoute
	var readKey UpstreamDiscoveredKey
	var readTime int64
	for _, key := range snapshot.Keys {
		if key.ID == source.RemoteKeyId {
			readKey = key
			joined = key.JoinedRoutes
			readTime = key.ReadTime
			break
		}
	}
	if joined == nil {
		return nil, joinedRoutesReadError(readKey)
	}
	if readTime < common.GetTimestamp()-600 {
		return nil, errors.New("joined route selection is stale; authorize the upstream Key page again")
	}
	byID := map[int]UpstreamJoinedRoute{}
	for _, pin := range joined {
		byID[pin.ListingID] = pin
	}
	result := []model.UpstreamQuote{}
	for _, quote := range quotes {
		pin, ok := byID[quote.ListingID]
		if !ok {
			continue
		}
		if !joinedRouteMatches(pin, quote.ListingID, quote.BaseModel, quote.Model) || (quote.PriceCNYPerUSD == "" && quote.PriceIssue == "") {
			return nil, errors.New("refresh this Key's joined routes and CNY prices before publishing")
		}
		if pin.Blocked {
			quote.PriceIssue = "this joined route is blocked for the upstream Key"
		}
		result = append(result, quote)
	}
	return result, nil
}

// Merchant aliases select an exact route. Base-name automatic routing has no
// single verified price and must never borrow one merchant's quote.
func merchantRouteCatalog(rows []upstreamMarketplaceRoute, liveModels map[string]bool, permissions []string, joined []UpstreamJoinedRoute) ([]model.UpstreamQuote, error) {
	if joined == nil {
		return nil, errors.New("joined routes have not been read; reopen the connection and run the current authorization bookmark on the upstream Key page")
	}
	allowed := map[string]bool{}
	for _, name := range permissions {
		allowed[name] = true
	}
	result := []model.UpstreamQuote{}
	seen := map[string]bool{}
	byID := map[int]upstreamMarketplaceRoute{}
	for _, row := range rows {
		if _, exists := byID[row.ID]; exists {
			return nil, errors.New("upstream returned duplicate route identifiers")
		}
		byID[row.ID] = row
	}
	for _, pin := range joined {
		row, exists := byID[pin.ListingID]
		if !exists {
			// A joined route may disappear from the public market. Keep its
			// authorized identity for management, with no publishable price.
			match := upstreamMerchantModel.FindStringSubmatch(pin.Alias)
			if match == nil {
				continue
			}
			row = upstreamMarketplaceRoute{ID: pin.ListingID, Model: match[1], Alias: pin.Alias, Status: "unavailable"}
		}
		if !joinedRouteMatches(pin, row.ID, row.Model, row.Alias) {
			return nil, errors.New("joined route does not match its marketplace quote; authorize the Key page again")
		}
		match := upstreamMerchantModel.FindStringSubmatch(row.Alias)
		if match == nil || match[1] != row.Model {
			continue
		}
		if !liveModels[row.Model] && !liveModels[row.Alias] {
			continue
		}
		if permissions != nil && !allowed[row.Model] && !allowed[row.Alias] {
			continue
		}
		if seen[row.Alias] {
			return nil, errors.New("upstream returned duplicate access-model quotes; review its route identifiers")
		}
		seen[row.Alias] = true
		q := merchantRouteCatalogQuote(row)
		if !exists {
			q.PriceIssue = "this joined route has no current marketplace quote; it cannot be published"
		}
		if pin.Blocked {
			q.PriceIssue = "this joined route is blocked for the upstream Key"
		}
		if err := q.Validate(); err != nil {
			q.PriceIssue = err.Error()
		}
		result = append(result, q)
	}
	return model.NormalizeUpstreamCatalog(result)
}

func merchantRouteCatalogQuote(row upstreamMarketplaceRoute) model.UpstreamQuote {
	reference := marketplaceRouteQuote(row)
	q := model.UpstreamQuote{Model: row.Alias, BaseModel: row.Model, PricingMode: "model_routes", ListingID: row.ID, PriceCNYPerUSD: row.CNYPerUSD, ChannelNo: row.ChannelNo, SupplierID: row.SupplierID, RouteStatus: row.Status, Description: row.Description, Currency: "CNY", DisplayCurrency: "CNY", Unit: reference.Unit, Original: reference.Original, Cost: reference.Prices, UpstreamRatio: reference.Multiplier, PriceIssue: reference.Issue}
	if row.ChargeType == "per_request" {
		q.Original.Request = optionalUpstreamRouteAmount(row.OriginalInput)
	}
	if q.PriceIssue != "" {
		return q
	}
	if row.Status != "active" || (row.ChannelAlive != nil && !*row.ChannelAlive) {
		q.PriceIssue = "this merchant route is paused or unavailable upstream"
		return q
	}
	if row.LongContextThreshold < 0 || row.LongContextThreshold > 10_000_000 {
		q.PriceIssue = "invalid upstream long-context threshold"
		return q
	}
	if row.LongContextThreshold == 0 {
		return q
	}
	if q.Unit != "per_million_tokens" {
		q.PriceIssue = "request pricing cannot contain token tiers"
		return q
	}
	q.LongContextThreshold = row.LongContextThreshold
	q.LongContextInputMultiplier = optionalUpstreamRouteAmount(row.LongContextInput)
	q.LongContextOutputMultiplier = optionalUpstreamRouteAmount(row.LongContextOutput)
	inputMultiplier, err := model.ParseUpstreamAmount(q.LongContextInputMultiplier)
	if err != nil || !inputMultiplier.IsPositive() {
		q.PriceIssue = "long-context input multiplier is unconfirmed"
		return q
	}
	outputMultiplier, err := model.ParseUpstreamAmount(q.LongContextOutputMultiplier)
	if err != nil || !outputMultiplier.IsPositive() {
		q.PriceIssue = "long-context output multiplier is unconfirmed"
		return q
	}
	for _, prices := range []model.UpstreamPrices{q.Original, q.Cost} {
		if prices.Input == "" || prices.Output == "" {
			q.PriceIssue = "input and output prices are required"
			return q
		}
	}
	// This marketplace documents the threshold in non-cached input tokens.
	// Cache rates stay explicit, outside the text input/output tier multiplier.
	q.CostExpr, err = merchantLongContextContract(q.Cost, q.LongContextThreshold, inputMultiplier, outputMultiplier)
	if err != nil {
		q.PriceIssue = err.Error()
		return q
	}
	// Only the upstream's supplied official dimensions appear in this reference.
	// Missing official cache rates are not reverse-calculated from a rounded ratio.
	_, q.BillingExpr, err = q.Original.FixedBillingContract(q.Unit)
	if err != nil {
		q.PriceIssue = err.Error()
		return q
	}
	q.BillingMode = "tiered_expr"
	return q
}

func merchantLongContextContract(prices model.UpstreamPrices, threshold int64, inputMultiplier, outputMultiplier decimal.Decimal) (string, error) {
	input, err := model.ParseUpstreamAmount(prices.Input)
	if err != nil {
		return "", err
	}
	output, err := model.ParseUpstreamAmount(prices.Output)
	if err != nil {
		return "", err
	}
	longInput, longOutput := input.Mul(inputMultiplier).String(), output.Mul(outputMultiplier).String()
	if _, err = model.ParseUpstreamAmount(longInput); err != nil {
		return "", err
	}
	if _, err = model.ParseUpstreamAmount(longOutput); err != nil {
		return "", err
	}
	cacheTerms := ""
	for i, variable := range []string{"cr", "cc", "img", "ai", "ao"} {
		price := prices.Values()[i+2]
		if price == "" {
			continue
		}
		amount, err := model.ParseUpstreamAmount(price)
		if err != nil {
			return "", err
		}
		cacheTerms += " + " + variable + " * " + amount.String()
	}
	expression := fmt.Sprintf("p < %d ? tier(\"standard\", p * %s + c * %s%s) : tier(\"long_context\", p * %s + c * %s%s)", threshold, input.String(), output.String(), cacheTerms, longInput, longOutput, cacheTerms)
	_, err = billingexpr.CompileFromCache(expression)
	return strings.TrimSpace(expression), err
}

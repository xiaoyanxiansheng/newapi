package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

type UpstreamDiscoveryRecipe struct {
	Kind        string `json:"kind"`
	ListPath    string `json:"list_path,omitempty"`
	PageStart   int    `json:"page_start,omitempty"`
	KeySelector string `json:"key_selector,omitempty"`
	ModelsPath  string `json:"models_path,omitempty"`
}

type UpstreamDiscoveredKey struct {
	JoinedRoutesIssue string                `json:"joined_routes_issue,omitempty"`
	JoinedRoutes      []UpstreamJoinedRoute `json:"joined_routes"`
	UsedCNY           string                `json:"used_cny,omitempty"`
	ID                int                   `json:"id"`
	Name              string                `json:"name"`
	Key               string                `json:"key"`
	Group             string                `json:"group"`
	GroupID           int                   `json:"group_id,omitempty"`
	Status            int                   `json:"status"`
	Models            []string              `json:"models"`
	ExpiresAt         int64                 `json:"expires_at"`
	ReadTime          int64                 `json:"read_time,omitempty"`
}

// Nil means the authorized browser has not read route membership. An empty
// slice means it read the list successfully and this Key has no joined routes.
type UpstreamJoinedRoute struct {
	ListingID int    `json:"listing_id"`
	Model     string `json:"base_model"`
	Alias     string `json:"listing_alias"`
	Blocked   bool   `json:"blocked,omitempty"`
}

// The browser reads with its own HttpOnly cookies. Only the authorized Key
// snapshot is imported; browser cookies are never copied to this server.
type UpstreamBrowserDiscovery struct {
	ReaderVersion  int                     `json:"reader_version,omitempty"`
	BalanceCNY     string                  `json:"balance_cny,omitempty"`
	BalanceIssue   string                  `json:"balance_issue,omitempty"`
	MoneyOnly      bool                    `json:"money_only,omitempty"`
	PageURL        string                  `json:"page_url"`
	Connector      UpstreamDiscoveryRecipe `json:"connector"`
	Identity       UpstreamBrowserIdentity `json:"identity"`
	Keys           []UpstreamDiscoveredKey `json:"keys"`
	Complete       bool                    `json:"complete"`
	Pricing        json.RawMessage         `json:"pricing,omitempty"`
	Status         json.RawMessage         `json:"status,omitempty"`
	Sub2APIPricing json.RawMessage         `json:"sub2api_pricing,omitempty"`
}

func SaveUpstreamDiscovery(account model.UpstreamAccount, snapshot UpstreamBrowserDiscovery) error {
	page, err := url.Parse(snapshot.PageURL)
	if err != nil || page.User != nil || page.Scheme != "https" || page.Scheme+"://"+page.Host != account.Website || len(snapshot.PageURL) > 2048 {
		return errors.New("Key management page must belong to the upstream website")
	}
	if snapshot.Connector.Kind != "newapi" && snapshot.Connector.Kind != "api" && snapshot.Connector.Kind != "page" {
		return errors.New("invalid automatic Key reading recipe")
	}
	if len(snapshot.Connector.ListPath) > 2048 || len(snapshot.Connector.KeySelector) > 512 || snapshot.Connector.PageStart < 0 || snapshot.Connector.PageStart > 1 {
		return errors.New("invalid automatic Key reading recipe")
	}
	if snapshot.Connector.ListPath != "" {
		path, err := url.Parse(snapshot.Connector.ListPath)
		if err != nil || path.IsAbs() || path.Host != "" || !strings.HasPrefix(path.Path, "/") || strings.HasPrefix(path.Path, "//") || strings.ContainsAny(snapshot.Connector.ListPath, "\r\n") {
			return errors.New("invalid automatic Key reading recipe")
		}
	}
	if path := snapshot.Connector.ModelsPath; path != "" && path != "/v1/models" && path != "/api/v1/models" && path != "/api/models" && path != "/models" {
		return errors.New("invalid automatic model reading recipe")
	}
	if snapshot.Identity.ID < 0 || (snapshot.Connector.Kind == "newapi" && snapshot.Identity.ID <= 0) || len(snapshot.Identity.Username) > 255 || len(snapshot.Identity.Email) > 255 {
		return errors.New("invalid discovered upstream identity")
	}
	if err := model.ValidateUpstreamCNY(snapshot.BalanceCNY, true); err != nil {
		return err
	}
	if snapshot.BalanceIssue != "" && snapshot.BalanceIssue != "not_found" {
		return errors.New("invalid upstream balance read status")
	}
	account.BalanceCNY, account.BalanceIssue = snapshot.BalanceCNY, snapshot.BalanceIssue
	if snapshot.MoneyOnly {
		if len(snapshot.Keys) > 0 || snapshot.Complete || (snapshot.BalanceCNY == "" && snapshot.BalanceIssue == "") {
			return errors.New("invalid upstream balance page read")
		}
		return model.SaveUpstreamBalanceRead(account, snapshot.Identity.ID)
	}
	if len(snapshot.Keys) > 10000 || snapshot.Keys == nil || (len(snapshot.Keys) == 0 && !snapshot.Complete) {
		return errors.New("no readable existing Keys were discovered")
	}
	seen := map[int]bool{}
	for i := range snapshot.Keys {
		key := &snapshot.Keys[i]
		if err := model.ValidateUpstreamCNY(key.UsedCNY, false); err != nil {
			return err
		}
		if key.ID <= 0 || key.ID > 2147483647 || seen[key.ID] || len(key.Name) > 255 || len(key.Group) > 255 || len(key.Key) > 4096 || strings.ContainsAny(key.Key, "*\r\n\t •●…") || len(key.Models) > 10000 || key.Status < 1 || key.Status > 4 {
			return errors.New("invalid or duplicate discovered Key")
		}
		if key.GroupID < 0 || key.GroupID > 2147483647 || strings.Contains(key.Key, "...") {
			return errors.New("invalid discovered group or masked Key")
		}
		if key.Key != "" && len(key.Key) < 12 {
			return errors.New("the discovered Key is incomplete; reveal it on its page")
		}
		for _, name := range key.Models {
			if name == "" || len(name) > 255 {
				return errors.New("invalid discovered model permission")
			}
		}
		if len(key.JoinedRoutes) > 10000 {
			return errors.New("too many joined routes for this Key")
		}
		joined := map[int]bool{}
		if key.JoinedRoutesIssue != "" && (key.JoinedRoutes != nil || !validJoinedRoutesIssue(key.JoinedRoutesIssue)) {
			return errors.New("invalid joined route reading status")
		}
		for _, route := range key.JoinedRoutes {
			match := upstreamMerchantModel.FindStringSubmatch(route.Alias)
			if route.ListingID <= 0 || route.ListingID > 2147483647 || joined[route.ListingID] || len(route.Model) > 255 || len(route.Alias) > 255 || (route.Alias != "" && (match == nil || (route.Model != "" && match[1] != route.Model))) {
				return errors.New("invalid or duplicate joined route")
			}
			joined[route.ListingID] = true
		}
		seen[key.ID] = true
		key.ReadTime = common.GetTimestamp()
	}
	if snapshot.Connector.Kind == "page" {
		snapshot.Complete = false
	}
	var old UpstreamBrowserDiscovery
	if account.BrowserDiscovery != "" {
		previous, err := readStoredUpstreamDiscovery(account)
		if err != nil && !snapshot.Complete {
			return err
		}
		old = previous
	}
	metadata := discoveryKeyMetadata(snapshot)
	previousKeys := map[int]UpstreamDiscoveredKey{}
	for _, key := range old.Keys {
		previousKeys[key.ID] = key
	}
	for i, key := range snapshot.Keys {
		previous := previousKeys[key.ID].JoinedRoutes
		changed := previousKeys[key.ID].GroupID != key.GroupID || !bytes.Equal(old.Sub2APIPricing, snapshot.Sub2APIPricing) || (previous == nil) != (key.JoinedRoutes == nil) || len(previous) != len(key.JoinedRoutes)
		byID := map[int]UpstreamJoinedRoute{}
		for _, route := range previous {
			byID[route.ListingID] = route
		}
		for _, route := range key.JoinedRoutes {
			if byID[route.ListingID] != route {
				changed = true
			}
		}
		metadata[i].RouteSelectionChanged = changed
	}
	// A page may expose only a subset. Preserve other encrypted Keys and their
	// individual read timestamps rather than presenting them as newly verified.
	if !snapshot.Complete && account.BrowserDiscovery != "" {
		for _, key := range old.Keys {
			if !seen[key.ID] {
				snapshot.Keys = append(snapshot.Keys, key)
			}
		}
		if len(snapshot.Keys) > 10000 {
			return errors.New("upstream account exceeds the supported 10000-Key limit")
		}
	}
	raw, err := common.Marshal(snapshot)
	if err != nil {
		return err
	}
	if len(raw) > 8*1024*1024 {
		return errors.New("upstream response exceeds the 8 MB import limit")
	}
	sealed, err := common.SealUpstreamSecret(string(raw))
	if err != nil {
		return err
	}
	recipe, err := common.Marshal(snapshot.Connector)
	if err != nil {
		return err
	}
	account.KeyPageURL = snapshot.PageURL
	return model.SaveUpstreamBrowserDiscovery(account, sealed, string(recipe), snapshot.Connector.Kind, snapshot.Identity.ID, snapshot.Identity.Username, snapshot.Identity.Email, metadata, snapshot.Complete)
}

func readStoredUpstreamDiscovery(account model.UpstreamAccount) (UpstreamBrowserDiscovery, error) {
	var snapshot UpstreamBrowserDiscovery
	raw, err := common.OpenUpstreamSecret(string(account.BrowserDiscovery))
	if err != nil {
		return snapshot, err
	}
	err = common.UnmarshalJsonStr(raw, &snapshot)
	return snapshot, err
}

func readUpstreamDiscovery(account model.UpstreamAccount) (UpstreamBrowserDiscovery, error) {
	if account.DiscoveryTime < common.GetTimestamp()-600 {
		return UpstreamBrowserDiscovery{}, errors.New("open the upstream website and authorize a fresh Key page read")
	}
	return readStoredUpstreamDiscovery(account)
}

func discoveryKeyMetadata(snapshot UpstreamBrowserDiscovery) []model.UpstreamKeyMetadata {
	result := make([]model.UpstreamKeyMetadata, 0, len(snapshot.Keys))
	for _, key := range snapshot.Keys {
		masked := "********"
		if len(key.Key) > 8 {
			masked = key.Key[:4] + "********" + key.Key[len(key.Key)-4:]
		}
		issue := ""
		if key.Key == "" {
			issue = "the complete existing Key is not visible; reveal it on its page and authorize again"
		}
		models, _ := common.Marshal(key.Models)
		result = append(result, model.UpstreamKeyMetadata{RemoteId: key.ID, Name: key.Name, Masked: masked, Group: key.Group, Status: key.Status, ModelsJSON: string(models), ExpiresAt: key.ExpiresAt, Issue: issue, UsedCNY: key.UsedCNY})
	}
	return result
}

func fetchDiscoveredKeyModels(account model.UpstreamAccount, source model.UpstreamSource) ([]model.UpstreamQuote, string, error) {
	client := NewUpstreamHTTPClient()
	defer client.CloseIdleConnections()
	return fetchDiscoveredKeyModelsWithClient(account, source, client)
}

func fetchDiscoveredKeyModelsWithClient(account model.UpstreamAccount, source model.UpstreamSource, client *http.Client) ([]model.UpstreamQuote, string, error) {
	snapshot, err := readStoredUpstreamDiscovery(account)
	if err != nil {
		return nil, "", err
	}
	var key *UpstreamDiscoveredKey
	for i := range snapshot.Keys {
		if snapshot.Keys[i].ID == source.RemoteKeyId {
			key = &snapshot.Keys[i]
			break
		}
	}
	if account.Disabled || source.Disabled || source.KeyMissing || key == nil || key.Key == "" || key.Status != 1 || (key.ExpiresAt > 0 && key.ExpiresAt <= common.GetTimestamp()) {
		return nil, "", errors.New("refresh this Key page authorization before reading its models")
	}
	models, err := common.Marshal(key.Models)
	if err != nil {
		return nil, "", err
	}
	if key.Group != source.PriceGroup || string(models) != source.AllowedModelsJSON {
		return nil, "", errors.New("this Key's group or model permissions changed; refresh the account first")
	}
	accessKey := key.Key
	if snapshot.Connector.Kind == "newapi" && !strings.HasPrefix(accessKey, "sk-") {
		accessKey = "sk-" + accessKey
	}
	s := &upstreamAccountSession{client: client, origin: account.Website}
	var response struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	paths := []string{"/v1/models", "/api/v1/models", "/api/models", "/models"}
	var savedRecipe UpstreamDiscoveryRecipe
	if common.UnmarshalJsonStr(account.DiscoveryRecipe, &savedRecipe) == nil && savedRecipe.ModelsPath != "" {
		paths = append([]string{savedRecipe.ModelsPath}, paths...)
	}
	for _, path := range paths {
		if path != "/v1/models" && path != "/api/v1/models" && path != "/api/models" && path != "/models" {
			continue
		}
		raw, readErr := s.read("GET", path, accessKey, nil)
		if readErr != nil {
			if strings.Contains(readErr.Error(), "HTTP 404") || strings.Contains(readErr.Error(), "HTTP 405") {
				continue
			}
			return nil, "", readErr
		}
		if common.Unmarshal(raw, &response) == nil && response.Data != nil {
			snapshot.Connector.ModelsPath = path
			break
		}
	}
	if response.Data == nil {
		return nil, "", errors.New("this Key's model list could not be verified")
	}
	// Model permission does not imply membership in every merchant route.
	// Only the authorized browser can read this Key's joined-route selection.
	var snapshotPrices struct {
		Data []upstreamPricingRow `json:"data"`
	}
	_ = common.Unmarshal(snapshot.Pricing, &snapshotPrices)
	merchantCandidate := key.Group == "" || source.PricingMode == "model_routes"
	for _, row := range snapshotPrices.Data {
		if upstreamMerchantModel.MatchString(row.Model) {
			merchantCandidate = true
			break
		}
	}
	if merchantCandidate {
		if key.JoinedRoutes != nil && key.ReadTime < common.GetTimestamp()-600 {
			return nil, "", errors.New("joined route selection is stale; authorize the upstream Key page again")
		}
		rows, readErr := fetchUpstreamMarketplaceRoutes(context.Background(), account.Website, client)
		if readErr == nil {
			if key.JoinedRoutes == nil {
				return nil, "", joinedRoutesReadError(*key)
			}
			liveModels := map[string]bool{}
			for _, entry := range response.Data {
				liveModels[entry.ID] = true
			}
			quotes, parseErr := merchantRouteCatalog(rows, liveModels, key.Models, key.JoinedRoutes)
			if parseErr != nil {
				return nil, "", parseErr
			}
			if quotes != nil {
				sealed, sealErr := common.SealUpstreamSecret(accessKey)
				return quotes, sealed, sealErr
			}
		}
		if source.PricingMode == "model_routes" {
			return nil, "", errors.New("fresh merchant route prices could not be verified; previous prices were preserved")
		}
	}
	priceSnapshotFresh := account.DiscoveryTime >= common.GetTimestamp()-600 && key.ReadTime >= common.GetTimestamp()-600
	if !priceSnapshotFresh && len(snapshot.Sub2APIPricing) == 0 {
		return nil, "", errors.New("open the upstream website and authorize a fresh Key page read")
	}
	if recipe, recipeErr := common.Marshal(snapshot.Connector); recipeErr == nil {
		model.DB.Model(&account).Where("revision = ?", account.Revision).Update("discovery_recipe", string(recipe))
	}
	prices := map[string]model.UpstreamQuote{}
	priceIssue := "this Key can access the model but its group price is unconfirmed"
	displayCurrency := ""
	if len(snapshot.Sub2APIPricing) > 0 {
		quotes, parseErr := parseSub2APIGroupCatalog(snapshot.Sub2APIPricing, *key)
		sharedOriginalFallback := errors.Is(parseErr, errSub2APIGroupPricesAbsent) || errors.Is(parseErr, errSub2APICatalogUnavailable)
		if !priceSnapshotFresh && !sharedOriginalFallback {
			return nil, "", errors.New("open the upstream website and authorize a fresh Key page read")
		}
		if parseErr != nil {
			priceIssue = parseErr.Error()
		} else {
			for _, quote := range quotes {
				prices[quote.Model] = quote
			}
			displayCurrency = "CNY"
		}
		// A public plaza may omit a private Key group. Shared originals are
		// independent of groups, while the live Key endpoint supplies its rate.
		if parseErr == nil || sharedOriginalFallback {
			originals, catalogErr := sharedUpstreamOriginalCatalog()
			if catalogErr != nil {
				return nil, "", catalogErr
			}
			missing := false
			for _, entry := range response.Data {
				_, known := originals[entry.ID]
				if _, ok := prices[entry.ID]; (!ok && known) || isSub2APIImageModel(entry.ID) {
					missing = true
					break
				}
			}
			if missing {
				raw, readErr := s.read("GET", "/v1/sub2api/billing", accessKey, nil)
				if readErr != nil {
					priceIssue = "this Key's effective purchase multiplier could not be read; previous prices were preserved"
				} else if rate, rateErr := sub2APIKeyPurchaseRate(raw); rateErr != nil {
					priceIssue = rateErr.Error()
				} else {
					priceIssue = "this model has no confirmed shared original price"
					for _, entry := range response.Data {
						if isSub2APIImageModel(entry.ID) {
							if priceSnapshotFresh {
								prices[entry.ID] = sub2APIImageQuote(snapshot.Sub2APIPricing, *key, entry.ID, rate)
							}
							continue
						}
						if _, exists := prices[entry.ID]; exists {
							continue
						}
						if original, exists := originals[entry.ID]; exists {
							quote, quoteErr := sharedOriginalPurchaseQuote(original, rate)
							if quoteErr != nil {
								quote.PriceIssue = quoteErr.Error()
							}
							prices[entry.ID] = quote
						}
					}
					displayCurrency = "CNY"
				}
			}
		}
		// Never expose a public token price for image generation when the
		// exact image contract or its live multiplier could not be verified.
		for _, entry := range response.Data {
			if isSub2APIImageModel(entry.ID) && prices[entry.ID].Unit != "per_image" {
				prices[entry.ID] = model.UpstreamQuote{Model: entry.ID, Currency: "USD", Unit: "per_image", PriceIssue: priceIssue}
			}
		}
	} else if len(snapshot.Pricing) > 0 && key.Group != "" && key.Group != "auto" {
		var status struct {
			Success bool `json:"success"`
			Data    struct {
				Currency string  `json:"quota_display_type"`
				Exchange float64 `json:"usd_exchange_rate"`
				Unit     float64 `json:"quota_per_unit"`
			} `json:"data"`
		}
		if common.Unmarshal(snapshot.Status, &status) == nil && status.Success && status.Data.Unit == 500000 {
			quotes, parseErr := ParseUpstreamCatalog(snapshot.Pricing, model.UpstreamSource{Adapter: "newapi", PriceGroup: key.Group, PurchaseMultiplier: "1"})
			if parseErr == nil {
				for _, quote := range quotes {
					prices[quote.Model] = quote
				}
				displayCurrency = "CNY"
			}
		}
	}
	allowed := map[string]bool{}
	for _, name := range key.Models {
		allowed[name] = true
	}
	result := []model.UpstreamQuote{}
	for _, entry := range response.Data {
		if key.Models != nil && !allowed[entry.ID] {
			continue
		}
		quote, ok := prices[entry.ID]
		if !ok {
			quote = model.UpstreamQuote{Model: entry.ID, Currency: "USD", PriceIssue: priceIssue}
		}
		quote.PriceGroup = key.Group
		quote.DisplayCurrency = displayCurrency
		result = append(result, quote)
	}
	result, err = model.NormalizeUpstreamCatalog(result)
	if err != nil {
		return nil, "", err
	}
	sealed, err := common.SealUpstreamSecret(accessKey)
	return result, sealed, err
}

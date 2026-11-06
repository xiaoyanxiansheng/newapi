package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/shopspring/decimal"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func ValidateUpstreamURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return errors.New("use an HTTP(S) URL without embedded credentials or fragments")
	}
	return nil
}

// Catalog requests never forward a credential to another origin or use an
// unrestricted redirect. Private addresses are not upstream catalog sources.
func FetchUpstreamCatalog(source model.UpstreamSource) ([]model.UpstreamQuote, error) {
	if err := ValidateUpstreamURL(source.CatalogURL); err != nil {
		return nil, err
	}
	u, _ := url.Parse(source.CatalogURL)
	if source.CatalogKey != "" && u.Scheme != "https" {
		return nil, errors.New("authenticated catalogs require HTTPS")
	}
	base, _ := url.Parse(source.BaseURL)
	if source.CatalogKey != "" && (base == nil || !strings.EqualFold(u.Host, base.Host) || u.Scheme != base.Scheme) {
		return nil, errors.New("authenticated catalog URL must use the same origin as the API base URL")
	}
	client := NewUpstreamHTTPClient()
	defer client.CloseIdleConnections()
	req, err := http.NewRequest(http.MethodGet, source.CatalogURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if source.CatalogKey != "" {
		req.Header.Set("Authorization", "Bearer "+source.CatalogKey)
	}
	response, err := client.Do(req)
	if err != nil {
		return nil, errors.New("upstream catalog request failed; check the URL and access settings")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream catalog returned HTTP %d", response.StatusCode)
	}
	const limit = 8 * 1024 * 1024
	body, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, errors.New("could not read upstream catalog")
	}
	if len(body) > limit {
		return nil, errors.New("upstream catalog exceeds 8 MB")
	}
	return ParseUpstreamCatalog(body, source)
}

func NewUpstreamHTTPClient() *http.Client {
	transport := &http.Transport{DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, errors.New("upstream hostname could not be resolved")
		}
		if len(ips) == 0 {
			return nil, errors.New("upstream hostname has no addresses")
		}
		for _, entry := range ips {
			ip := entry.IP
			if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				return nil, errors.New("catalog must be hosted on a public upstream address")
			}
		}
		return (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	}}
	return &http.Client{Timeout: 30 * time.Second, Transport: transport, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
}

type upstreamPricingRow struct {
	BillingExpr     string          `json:"billing_expr"`
	Model           string          `json:"model_name"`
	Description     string          `json:"description"`
	QuotaType       *int            `json:"quota_type"`
	Ratio           json.RawMessage `json:"model_ratio"`
	Price           json.RawMessage `json:"model_price"`
	Completion      json.RawMessage `json:"completion_ratio"`
	Cache           json.RawMessage `json:"cache_ratio"`
	Write           json.RawMessage `json:"create_cache_ratio"`
	Image           json.RawMessage `json:"image_ratio"`
	Audio           json.RawMessage `json:"audio_ratio"`
	AudioCompletion json.RawMessage `json:"audio_completion_ratio"`
	CacheWrite1h    json.RawMessage `json:"create_cache_1h_ratio"`
	ImageOutput     json.RawMessage `json:"image_output_ratio"`
	BillingMode     string          `json:"billing_mode"`
	Groups          []string        `json:"enable_groups"`
}

func ParseUpstreamCatalog(body []byte, source model.UpstreamSource) ([]model.UpstreamQuote, error) {
	if source.Adapter == "catalog" {
		var envelope struct {
			Models []model.UpstreamQuote `json:"models"`
		}
		if err := common.Unmarshal(body, &envelope); err != nil {
			return nil, fmt.Errorf("invalid price catalog: %w", err)
		}
		if envelope.Models == nil {
			return nil, errors.New("expected a price catalog JSON object with a models array; HTML pages require a source-specific adapter or manual import")
		}
		return model.NormalizeUpstreamCatalog(envelope.Models)
	}
	if source.Adapter != "newapi" {
		return nil, errors.New("this source uses manual price import")
	}
	var envelope struct {
		Success           *bool                      `json:"success"`
		Data              []upstreamPricingRow       `json:"data"`
		Groups            map[string]json.RawMessage `json:"group_ratio"`
		GroupDescriptions map[string]string          `json:"usable_group"`
	}
	if err := common.Unmarshal(body, &envelope); err != nil || envelope.Data == nil || (envelope.Success != nil && !*envelope.Success) {
		return nil, errors.New("invalid upstream pricing response; previous prices were preserved")
	}
	multiplier, err := model.ParseUpstreamAmount(source.PurchaseMultiplier)
	if err != nil || multiplier.IsZero() {
		return nil, errors.New("confirm a positive purchase multiplier")
	}
	if source.PriceGroup != "" {
		raw, ok := envelope.Groups[source.PriceGroup]
		if !ok {
			return nil, errors.New("selected upstream price group is absent; do not guess its discount")
		}
		group, err := upstreamJSONAmount(raw)
		if err != nil || group.IsZero() {
			return nil, errors.New("selected upstream group has invalid pricing")
		}
		multiplier = multiplier.Mul(group)
	}
	quotes := make([]model.UpstreamQuote, 0, len(envelope.Data))
	for _, row := range envelope.Data {
		if source.PriceGroup != "" && len(row.Groups) > 0 && !common.StringsContains(row.Groups, source.PriceGroup) && !common.StringsContains(row.Groups, "all") {
			continue
		}
		quote, err := normalizeUpstreamPrice(row, multiplier)
		quote.GroupDescription = strings.TrimSpace(envelope.GroupDescriptions[source.PriceGroup])
		if err != nil {
			quote = model.UpstreamQuote{Model: row.Model, Description: row.Description, Currency: "USD", UpstreamRatio: multiplier.String(), PriceIssue: err.Error()}
		}
		quotes = append(quotes, quote)
	}
	return model.NormalizeUpstreamCatalog(quotes)
}
func normalizeUpstreamPrice(row upstreamPricingRow, multiplier decimal.Decimal) (model.UpstreamQuote, error) {
	if row.BillingMode == billing_setting.BillingModeTieredExpr {
		cost, err := billingexpr.ScalePrices(row.BillingExpr, multiplier.String())
		if err != nil {
			return model.UpstreamQuote{}, err
		}
		if err := billing_setting.SmokeTestExpr(cost); err != nil {
			return model.UpstreamQuote{}, err
		}
		return model.UpstreamQuote{Model: row.Model, Description: row.Description, Unit: "per_million_tokens", Currency: "USD", BillingMode: row.BillingMode, BillingExpr: row.BillingExpr, CostExpr: cost, UpstreamRatio: multiplier.String()}, nil
	}
	for _, raw := range []json.RawMessage{row.CacheWrite1h, row.ImageOutput} {
		if len(raw) > 0 && string(raw) != "null" {
			return model.UpstreamQuote{}, errors.New("this model has additional price dimensions; review its pricing manually before applying")
		}
	}
	if row.BillingMode != "" && row.BillingMode != "ratio" {
		return model.UpstreamQuote{}, errors.New("dynamic pricing requires a verified contract before publishing")
	}
	original := model.UpstreamPrices{}
	unit := "per_million_tokens"
	if row.QuotaType != nil && *row.QuotaType == 1 {
		price, err := upstreamJSONAmount(row.Price)
		if err != nil {
			return model.UpstreamQuote{}, fmt.Errorf("model %s has no confirmed request price", row.Model)
		}
		original.Request = price.String()
		unit = "per_request"
	} else if row.QuotaType != nil && *row.QuotaType == 0 {
		input, err := upstreamJSONAmount(row.Ratio)
		if err != nil {
			return model.UpstreamQuote{}, fmt.Errorf("model %s has no confirmed input price", row.Model)
		}
		input = input.Mul(decimal.NewFromInt(2))
		completion, err := upstreamJSONAmount(row.Completion)
		if err != nil {
			return model.UpstreamQuote{}, fmt.Errorf("model %s has no confirmed output price", row.Model)
		}
		original.Input = input.String()
		original.Output = input.Mul(completion).String()
		for _, field := range []struct {
			raw  json.RawMessage
			dest *string
		}{{row.Cache, &original.CacheRead}, {row.Write, &original.CacheWrite}, {row.Image, &original.ImageInput}, {row.Audio, &original.AudioInput}} {
			if len(field.raw) == 0 || string(field.raw) == "null" {
				continue
			}
			ratio, err := upstreamJSONAmount(field.raw)
			if err != nil {
				return model.UpstreamQuote{}, fmt.Errorf("model %s has an invalid cache price", row.Model)
			}
			*field.dest = input.Mul(ratio).String()
		}
		if len(row.AudioCompletion) > 0 && string(row.AudioCompletion) != "null" {
			if original.AudioInput == "" {
				return model.UpstreamQuote{}, errors.New("audio output price requires an audio input price")
			}
			audio, _ := model.ParseUpstreamAmount(original.AudioInput)
			ratio, err := upstreamJSONAmount(row.AudioCompletion)
			if err != nil {
				return model.UpstreamQuote{}, err
			}
			original.AudioOutput = audio.Mul(ratio).String()
		}
	} else {
		return model.UpstreamQuote{}, fmt.Errorf("model %s has an unsupported billing unit", row.Model)
	}
	cost, err := original.Scale(multiplier)
	if err != nil {
		return model.UpstreamQuote{}, err
	}

	return model.UpstreamQuote{Model: row.Model, Description: row.Description, Unit: unit, Currency: "USD", Original: original, Cost: cost, UpstreamRatio: multiplier.String()}, nil
}
func upstreamJSONAmount(raw json.RawMessage) (decimal.Decimal, error) {
	value := strings.TrimSpace(string(raw))
	if strings.HasPrefix(value, string(rune(34))) {
		var text string
		if err := common.Unmarshal(raw, &text); err != nil {
			return decimal.Zero, err
		}
		value = text
	}
	return model.ParseUpstreamAmount(value)
}

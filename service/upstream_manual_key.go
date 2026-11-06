package service

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

func NormalizeUpstreamKeyURL(raw string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(raw), "/")
	if err := ValidateUpstreamURL(base); err != nil {
		return "", err
	}
	parsed, _ := url.Parse(base)
	if parsed.Scheme != "https" || parsed.RawQuery != "" {
		return "", errors.New("use an HTTPS API address without query parameters")
	}
	// The existing OpenAI relay appends /v1 itself. Accept either common input.
	base = strings.TrimSuffix(base, "/v1")
	return base, nil
}

func FetchUpstreamManualKeyModels(source model.UpstreamSource) ([]model.UpstreamQuote, error) {
	client := NewUpstreamHTTPClient()
	defer client.CloseIdleConnections()
	return fetchUpstreamManualKeyModels(source, client)
}

func fetchUpstreamManualKeyModels(source model.UpstreamSource, client *http.Client) ([]model.UpstreamQuote, error) {
	if source.AccountId != 0 || source.Adapter != "direct-key" {
		return nil, errors.New("use the account workflow for account Keys")
	}
	base, err := NormalizeUpstreamKeyURL(source.BaseURL)
	if err != nil {
		return nil, err
	}
	key, err := common.OpenUpstreamSecret(source.RelayKey)
	if err != nil {
		return nil, err
	}
	if key == "" {
		return nil, errors.New("provide the existing API Key")
	}
	req, err := http.NewRequest(http.MethodGet, base+"/v1/models", nil)
	if err != nil {
		return nil, errors.New("invalid API address")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	response, err := client.Do(req)
	if err != nil {
		return nil, errors.New("upstream request failed; check the website and retry")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream returned HTTP %d; check account access and retry", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 8*1024*1024+1))
	if err != nil || len(body) > 8*1024*1024 {
		return nil, errors.New("upstream response could not be read within the size limit")
	}
	var envelope struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := common.Unmarshal(body, &envelope); err != nil || envelope.Data == nil {
		return nil, errors.New("this Key's model list could not be verified")
	}
	quotes := make([]model.UpstreamQuote, 0, len(envelope.Data))
	for _, entry := range envelope.Data {
		quotes = append(quotes, model.UpstreamQuote{Model: entry.ID, Currency: "USD", PriceIssue: "Verify upstream prices before publishing this manually entered Key."})
	}
	// A model list does not establish a Key's group, currency, or cost. In
	// particular, never substitute a website's cheapest public price group.
	return model.NormalizeUpstreamCatalog(quotes)
}

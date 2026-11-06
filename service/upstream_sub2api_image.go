package service

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/shopspring/decimal"
)

// Image generation contracts are group-specific per-image prices, not a
// text/image token catalog entry with the same model name.
func sub2APIImageQuote(raw json.RawMessage, key UpstreamDiscoveredKey, name string, tokenRate decimal.Decimal) model.UpstreamQuote {
	q := model.UpstreamQuote{Model: name, Currency: "USD", DisplayCurrency: "CNY", PriceGroup: key.Group, Unit: "per_image"}
	q.PriceIssue = "authorize the upstream Key page again to read its per-image group prices"
	var snapshot struct {
		Groups struct {
			Code *int `json:"code"`
			Data []struct {
				ID          int             `json:"id"`
				Name        string          `json:"name"`
				Description string          `json:"description"`
				Allowed     *bool           `json:"allow_image_generation"`
				Independent *bool           `json:"image_rate_independent"`
				Rate        json.RawMessage `json:"image_rate_multiplier"`
				Price1K     json.RawMessage `json:"image_price_1k"`
				Price2K     json.RawMessage `json:"image_price_2k"`
				Price4K     json.RawMessage `json:"image_price_4k"`
			} `json:"data"`
		} `json:"available_groups"`
	}
	if common.Unmarshal(raw, &snapshot) != nil || snapshot.Groups.Code == nil || *snapshot.Groups.Code != 0 || snapshot.Groups.Data == nil {
		return q
	}
	matched := false
	for _, g := range snapshot.Groups.Data {
		if g.ID != key.GroupID {
			continue
		}
		if matched || g.Name != key.Group {
			q.PriceIssue = "the authorized image price group does not match this Key"
			return q
		}
		matched = true
		if g.Allowed == nil || !*g.Allowed || g.Independent == nil {
			q.PriceIssue = "this Key's image generation pricing is unconfirmed"
			return q
		}
		rate := tokenRate
		if *g.Independent {
			var err error
			rate, err = upstreamJSONAmount(g.Rate)
			if err != nil || !rate.IsPositive() {
				q.PriceIssue = "this Key has an invalid image purchase multiplier"
				return q
			}
		}
		prices := []decimal.Decimal{}
		for _, p := range []json.RawMessage{g.Price1K, g.Price2K, g.Price4K} {
			price, err := upstreamJSONAmount(p)
			if err != nil {
				q.PriceIssue = "this image group has missing resolution prices"
				return q
			}
			prices = append(prices, price)
		}
		if !prices[0].Equal(prices[1]) || !prices[0].Equal(prices[2]) {
			q.PriceIssue = "this image group has resolution-dependent prices; verify the complete image contract before publishing"
			return q
		}
		q.UpstreamRatio = rate.String()
		q.GroupDescription = g.Description
		q.Original = model.UpstreamPrices{Request: prices[0].String()}
		q.Cost = model.UpstreamPrices{Request: prices[0].Mul(rate).String()}
		q.PriceIssue = ""
	}
	return q
}

func isSub2APIImageModel(name string) bool {
	return strings.HasPrefix(name, "gpt-image-") || strings.HasPrefix(name, "dall-e-") || name == "grok-imagine-image" || name == "grok-imagine-image-pro"
}

var errSub2APIImageTokenOriginal = errors.New("image generation requires its per-image group contract, not shared token prices")

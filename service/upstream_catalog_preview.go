package service

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"math"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

func UpstreamLocalBasePrices(name string) (model.UpstreamPrices, error) {
	if billing_setting.GetBillingMode(name) == billing_setting.BillingModeTieredExpr {
		return model.UpstreamPrices{}, errors.New("local dynamic pricing must be reviewed in existing model pricing; automatic ratio import is unavailable")
	}
	amount, ok := ratio_setting.GetModelPrice(name, false)
	if ok {
		if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
			return model.UpstreamPrices{}, errors.New("invalid local request price")
		}
		return model.UpstreamPrices{Request: decimal.NewFromFloat(amount).String()}, nil
	}
	ratio, ok, matched := ratio_setting.GetModelRatio(name)
	_, explicit := ratio_setting.GetModelRatioCopy()[matched]
	if !ok || !explicit || math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 {
		return model.UpstreamPrices{}, errors.New("configure this model's original price in existing model pricing first")
	}
	input := decimal.NewFromFloat(ratio).Mul(decimal.NewFromInt(2))
	completion := ratio_setting.GetCompletionRatio(name)
	if math.IsNaN(completion) || math.IsInf(completion, 0) || completion < 0 {
		return model.UpstreamPrices{}, errors.New("invalid local output price")
	}
	prices := model.UpstreamPrices{Input: input.String(), Output: input.Mul(decimal.NewFromFloat(completion)).String()}
	cache, hasCache := ratio_setting.GetCacheRatio(name)
	write, hasWrite := ratio_setting.GetCreateCacheRatio(name)
	image, hasImage := ratio_setting.GetImageRatio(name)
	for _, entry := range []struct {
		ratio float64
		ok    bool
		dest  *string
	}{
		{cache, hasCache, &prices.CacheRead},
		{write, hasWrite, &prices.CacheWrite},
		{image, hasImage, &prices.ImageInput},
		{ratio_setting.GetAudioRatio(name), ratio_setting.ContainsAudioRatio(name), &prices.AudioInput},
	} {
		if !entry.ok {
			continue
		}
		if math.IsNaN(entry.ratio) || math.IsInf(entry.ratio, 0) || entry.ratio < 0 {
			return model.UpstreamPrices{}, errors.New("invalid local media/cache price")
		}
		*entry.dest = input.Mul(decimal.NewFromFloat(entry.ratio)).String()
	}
	if ratio_setting.ContainsAudioCompletionRatio(name) {
		if prices.AudioInput == "" {
			return model.UpstreamPrices{}, errors.New("local audio input price is missing")
		}
		audio, _ := model.ParseUpstreamAmount(prices.AudioInput)
		completion := ratio_setting.GetAudioCompletionRatio(name)
		if math.IsNaN(completion) || math.IsInf(completion, 0) || completion < 0 {
			return model.UpstreamPrices{}, errors.New("invalid local audio output price")
		}
		prices.AudioOutput = audio.Mul(decimal.NewFromFloat(completion)).String()
	}
	return prices, nil
}

type UpstreamPreview struct {
	Fingerprint    string                   `json:"fingerprint"`
	Proposals      []model.UpstreamProposal `json:"proposals"`
	ChannelName    string                   `json:"channel_name"`
	CreatesChannel bool                     `json:"creates_channel"`
}

func PreviewUpstreamSelection(source model.UpstreamSource, revision int64, selected map[string]string) (UpstreamPreview, error) {
	if (source.AccountId > 0 || source.Adapter == "direct-key") && (source.KeyMissing || source.KeyStatus != 1 || source.KeyIssue != "" || source.LatestTime == 0 || source.LastError != "" || (source.KeyExpiresAt > 0 && source.KeyExpiresAt <= common.GetTimestamp())) {
		return UpstreamPreview{}, errors.New("this upstream Key is unavailable; refresh and verify it before publishing")
	}
	if source.Revision != revision {
		return UpstreamPreview{}, errors.New("catalog changed; reload and review prices again")
	}
	if len(selected) == 0 || len(selected) > 500 {
		return UpstreamPreview{}, errors.New("select between 1 and 500 models")
	}
	var quotes []model.UpstreamQuote
	if err := common.UnmarshalJsonStr(source.LatestJSON, &quotes); err != nil {
		return UpstreamPreview{}, err
	}
	var err error
	quotes, err = FilterUpstreamJoinedCatalog(source, quotes)
	if err != nil {
		return UpstreamPreview{}, err
	}
	index := map[string]model.UpstreamQuote{}
	for _, q := range quotes {
		index[q.Model] = q
	}
	names := make([]string, 0, len(selected))
	for name := range selected {
		names = append(names, name)
	}
	sort.Strings(names)
	preview := UpstreamPreview{ChannelName: source.Name, CreatesChannel: source.ChannelId == 0, Proposals: []model.UpstreamProposal{}}
	channelState := "new"
	if source.ChannelId > 0 {
		ch, err := model.GetChannelById(source.ChannelId, false)
		if err != nil {
			return preview, errors.New("published connection is unavailable; reload the upstream account and retry")
		}
		preview.ChannelName = ch.Name
		channelState = fmt.Sprintf("%d:%d:%s:%s:%s", ch.Id, ch.Status, ch.Models, ch.GetBaseURL(), ch.Group)
	}
	for _, name := range names {
		q, ok := index[name]
		if !ok {
			return preview, errors.New("selected model is absent from the latest catalog")
		}
		markup := selected[name]
		if markup == "" {
			markup = source.Markup
		}
		p := model.UpstreamProposal{Model: name, Markup: markup, MarkupOverride: selected[name], Cost: q.Cost, Unit: q.Unit, Enabled: true}
		p.DisplayCurrency = q.DisplayCurrency
		var err error
		if q.BillingMode == billing_setting.BillingModeTieredExpr {
			err = q.Validate()
			if q.PriceIssue != "" {
				err = errors.New(q.PriceIssue)
			}
			if err == nil {
				var m decimal.Decimal
				m, err = model.ParseUpstreamMarkup(markup)
				if err == nil {
					p.BillingExpr, err = billingexpr.ScalePrices(q.CostExpr, m.String())
				}
				p.BillingMode = q.BillingMode
				p.OriginalExpr = q.BillingExpr
				p.CostExpr = q.CostExpr
				p.Ratio = 1
			}
		} else {
			err = q.Validate()
			if q.PriceIssue != "" {
				err = errors.New(q.PriceIssue)
			}
			if err == nil {
				var m decimal.Decimal
				m, err = model.ParseUpstreamMarkup(markup)
				if err == nil {
					p.Sale, err = q.Cost.Scale(m)
				}
				if err == nil {
					p.BillingMode, p.BillingExpr, err = p.Sale.FixedBillingContract(q.Unit)
				}
				if err == nil {
					_, p.OriginalExpr, err = q.Original.FixedBillingContract(q.Unit)
				}
				p.Original = q.Original
				p.Ratio = 1
			}
		}
		if err != nil {
			p.Issue = err.Error()
		}
		if source.ChannelId > 0 {
			var l model.MarketListing
			err := model.DB.Where("channel_id = ? AND model_name = ?", source.ChannelId, name).First(&l).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return preview, err
			}
			if l.Id > 0 {
				p.ListingId = l.Id
				p.CurrentRatio = l.Ratio
				p.Enabled = l.Enabled
				p.CurrentBillingMode = l.BillingMode
				p.CurrentBillingExpr = l.BillingExpr
				p.CurrentOriginalExpr = l.OriginalBillingExpr
			}
		}
		preview.Proposals = append(preview.Proposals, p)
	}
	data, err := common.Marshal(struct {
		Revision  int64
		Channel   string
		Proposals []model.UpstreamProposal
	}{source.Revision, channelState, preview.Proposals})
	if err != nil {
		return preview, err
	}
	preview.Fingerprint = fmt.Sprintf("%x", sha256.Sum256(data))
	return preview, nil
}

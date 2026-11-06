package controller

import (
	"errors"
	"net/http"
	"net/url"
	"reflect"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type upstreamSourceView struct {
	model.UpstreamSource
	HasCatalogKey bool `json:"has_catalog_key"`
	HasRelayKey   bool `json:"has_relay_key"`
}

func GetUpstreamSources(c *gin.Context) {
	rows := []model.UpstreamSource{}
	if err := model.DB.Omit("latest_json").Order("id desc").Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	views := []upstreamSourceView{}
	for _, s := range rows {
		views = append(views, upstreamSourceView{s, s.CatalogKey != "", s.RelayKey != ""})
	}
	common.ApiSuccess(c, views)
}

type upstreamSourceInput struct {
	Name               string  `json:"name"`
	BaseURL            string  `json:"base_url"`
	CatalogURL         string  `json:"catalog_url"`
	Adapter            string  `json:"adapter"`
	PriceGroup         string  `json:"price_group"`
	PurchaseMultiplier string  `json:"purchase_multiplier"`
	Markup             string  `json:"markup"`
	CatalogKey         *string `json:"catalog_key"`
	RelayKey           *string `json:"relay_key"`
	ChannelId          int     `json:"channel_id"`
	Revision           int64   `json:"revision"`
}

func SaveUpstreamSource(c *gin.Context) {
	var req upstreamSourceInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid upstream source")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.BaseURL = strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
	req.CatalogURL = strings.TrimSpace(req.CatalogURL)
	req.PriceGroup = strings.TrimSpace(req.PriceGroup)
	if req.Name == "" || len(req.Name) > 255 || len(req.PriceGroup) > 64 {
		common.ApiErrorMsg(c, "provide a valid source name and price group")
		return
	}
	if req.Adapter != "newapi" && req.Adapter != "catalog" && req.Adapter != "manual" {
		common.ApiErrorMsg(c, "unsupported price source format")
		return
	}
	if req.Adapter == "newapi" && req.CatalogURL == "" {
		req.CatalogURL = req.BaseURL + "/api/pricing"
	}
	if req.Adapter != "manual" && req.CatalogURL == "" {
		common.ApiErrorMsg(c, "price catalog URL is required")
		return
	}
	for _, raw := range []string{req.BaseURL, req.CatalogURL} {
		if raw != "" {
			if len(raw) > 2048 {
				common.ApiErrorMsg(c, "URL is too long")
				return
			}
			if err := service.ValidateUpstreamURL(raw); err != nil {
				common.ApiError(c, err)
				return
			}
		}
	}
	if req.BaseURL == "" {
		common.ApiErrorMsg(c, "API base URL is required")
		return
	}
	base, _ := url.Parse(req.BaseURL)
	if base.RawQuery != "" {
		common.ApiErrorMsg(c, "API base URL cannot include query parameters")
		return
	}
	if _, err := model.ParseUpstreamMarkup(req.Markup); err != nil {
		common.ApiError(c, err)
		return
	}
	discount, err := model.ParseUpstreamAmount(req.PurchaseMultiplier)
	if err != nil || !discount.IsPositive() {
		common.ApiErrorMsg(c, "purchase multiplier must be positive")
		return
	}
	if req.ChannelId < 0 {
		common.ApiErrorMsg(c, "invalid target channel")
		return
	}
	if req.ChannelId > 0 {
		ch, err := model.GetChannelById(req.ChannelId, false)
		if err != nil || strings.TrimRight(ch.GetBaseURL(), "/") != req.BaseURL {
			common.ApiErrorMsg(c, "select a channel with the same API base URL")
			return
		}
	}
	s := model.UpstreamSource{Name: req.Name, BaseURL: req.BaseURL, CatalogURL: req.CatalogURL, Adapter: req.Adapter, PriceGroup: req.PriceGroup, PurchaseMultiplier: req.PurchaseMultiplier, Markup: req.Markup, ChannelId: req.ChannelId, CreatedTime: common.GetTimestamp()}
	id, _ := strconv.Atoi(c.Param("id"))
	var current model.UpstreamSource
	if id > 0 {
		if err := model.DB.First(&current, id).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		if current.AccountId > 0 {
			common.ApiErrorMsg(c, "manage account Keys from the upstream account page")
			return
		}
		if current.Adapter == "direct-key" {
			common.ApiErrorMsg(c, "manage manually entered Keys from the upstream page")
			return
		}
		s.CatalogKey = current.CatalogKey
		s.RelayKey = current.RelayKey
		previous, _ := url.Parse(current.BaseURL)
		if previous != nil && (!strings.EqualFold(previous.Host, base.Host) || previous.Scheme != base.Scheme) {
			if (current.CatalogKey != "" && req.CatalogKey == nil) || (current.RelayKey != "" && req.RelayKey == nil) {
				common.ApiErrorMsg(c, "clear or replace saved keys before changing the upstream origin")
				return
			}
		}
	}
	for _, secret := range []struct {
		input *string
		dest  *string
	}{{req.CatalogKey, &s.CatalogKey}, {req.RelayKey, &s.RelayKey}} {
		if secret.input != nil {
			*secret.dest = strings.TrimSpace(*secret.input)
		}
		if len(*secret.dest) > 16384 || strings.ContainsAny(*secret.dest, "\r\n") {
			common.ApiErrorMsg(c, "invalid API key")
			return
		}
	}
	if s.RelayKey != "" && base.Scheme != "https" {
		common.ApiErrorMsg(c, "relay API keys require an HTTPS API base URL")
		return
	}
	if s.CatalogKey != "" {
		catalog, _ := url.Parse(s.CatalogURL)
		if catalog == nil || catalog.Scheme != "https" || base.Scheme != catalog.Scheme || !strings.EqualFold(base.Host, catalog.Host) {
			common.ApiErrorMsg(c, "authenticated price catalogs must use HTTPS and the API base URL's origin")
			return
		}
	}
	if id == 0 {
		if err := model.DB.Create(&s).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{"id": s.Id})
		return
	}
	updates := map[string]any{"name": s.Name, "base_url": s.BaseURL, "catalog_url": s.CatalogURL, "adapter": s.Adapter, "price_group": s.PriceGroup, "purchase_multiplier": s.PurchaseMultiplier, "markup": s.Markup, "catalog_key": s.CatalogKey, "relay_key": s.RelayKey, "channel_id": s.ChannelId, "revision": req.Revision + 1}
	if s.Adapter != current.Adapter || s.BaseURL != current.BaseURL || s.CatalogURL != current.CatalogURL || s.CatalogKey != current.CatalogKey || s.PriceGroup != current.PriceGroup || s.PurchaseMultiplier != current.PurchaseMultiplier {
		updates["latest_time"] = 0
	}
	result := model.DB.Model(&current).Where("revision = ?", req.Revision).Updates(updates)
	if result.Error != nil {
		common.ApiError(c, result.Error)
		return
	}
	if result.RowsAffected != 1 {
		common.ApiErrorMsg(c, "source changed; reload before saving")
		return
	}
	common.ApiSuccess(c, gin.H{"id": id})
}
func upstreamSource(c *gin.Context) (model.UpstreamSource, error) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return model.UpstreamSource{}, errors.New("invalid source ID")
	}
	var s model.UpstreamSource
	err = model.DB.First(&s, id).Error
	return s, err
}

type upstreamCatalogRow struct {
	Monitoring     *upstreamListingMonitoring `json:"monitoring,omitempty"`
	Model          string                     `json:"model"`
	Latest         *model.UpstreamQuote       `json:"latest"`
	Reviewed       *model.UpstreamQuote       `json:"reviewed"`
	Change         string                     `json:"change"`
	MarkupOverride string                     `json:"markup_override"`
	Listing        *model.MarketListing       `json:"listing"`
}

type upstreamListingMonitoring struct {
	PriceRatio     float64                  `json:"price_ratio"`
	Stats          *model.MarketStatSummary `json:"stats"`
	Score          *service.MarketScore     `json:"score"`
	DefaultSuccess bool                     `json:"default_success"`
}

func GetUpstreamSource(c *gin.Context) {
	s, err := upstreamSource(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if s.AccountId > 0 {
		var account model.UpstreamAccount
		if err := model.DB.Select("id", "disabled").First(&account, s.AccountId).Error; err == nil {
			s.AccountDisabled = account.Disabled
		}
	}
	latest := []model.UpstreamQuote{}
	if s.LatestJSON != "" {
		if err := common.UnmarshalJsonStr(s.LatestJSON, &latest); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	var reviews []model.UpstreamReview
	if filtered, err := service.FilterUpstreamJoinedCatalog(s, latest); err != nil {
		latest = []model.UpstreamQuote{}
		s.LastError = err.Error()
	} else {
		latest = filtered
	}
	if err := model.DB.Where("source_id = ?", s.Id).Order("model_name asc").Find(&reviews).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var listings []model.MarketListing
	if s.ChannelId > 0 {
		if err := model.DB.Where("channel_id = ?", s.ChannelId).Find(&listings).Error; err != nil {
			common.ApiError(c, err)
			return
		}
	}
	byModel := map[string]*model.MarketListing{}
	pricingByModel := map[string]model.Pricing{}
	if len(listings) > 0 {
		for _, p := range model.GetPricing() {
			pricingByModel[p.ModelName] = p
		}
	}
	for i := range listings {
		byModel[listings[i].ModelName] = &listings[i]
	}
	byName := map[string]*model.UpstreamQuote{}
	for i := range latest {
		byName[latest[i].Model] = &latest[i]
	}
	rows := []upstreamCatalogRow{}
	for _, r := range reviews {
		if s.PricingMode == "model_routes" && byName[r.ModelName] == nil && byModel[r.ModelName] == nil {
			continue
		}
		row := upstreamCatalogRow{Model: r.ModelName, Latest: byName[r.ModelName], MarkupOverride: r.MarkupOverride, Listing: byModel[r.ModelName], Change: "unchanged"}
		if row.Listing != nil && row.Listing.Description == "" && row.Latest != nil {
			row.Listing.Description = row.Latest.GroupDescription
			if row.Listing.Description == "" {
				row.Listing.Description = row.Latest.Description
			}
		}
		if row.Listing != nil {
			pricing := row.Listing.OriginalPricing(pricingByModel[r.ModelName])
			stats := model.GetMarketStatSummary(s.ChannelId, r.ModelName)
			_, ratio := service.MarketListingPriceReference(row.Listing, pricing)
			cacheRatio := pricing.CacheRatio
			if cacheRatio == nil {
				cacheRatio = service.CacheRatioFromBillingExpr(row.Listing.OriginalBillingExpr)
				if cacheRatio == nil {
					cacheRatio = service.CacheRatioFromBillingExpr(pricing.BillingExpr)
				}
			}
			score := service.ScoreMarketListing(ratio, cacheRatio, stats)
			row.Monitoring = &upstreamListingMonitoring{PriceRatio: ratio, Stats: stats, Score: &score, DefaultSuccess: row.Listing.DefaultSuccess}
		}
		var old model.UpstreamQuote
		if err := common.UnmarshalJsonStr(r.QuoteJSON, &old); err != nil {
			common.ApiError(c, err)
			return
		}
		if !r.Missing {
			row.Reviewed = &old
		}
		if row.Latest == nil {
			if !r.Missing {
				row.Change = "removed"
			}
		} else if r.Missing {
			row.Change = "new"
		} else if !reflect.DeepEqual(old, *row.Latest) {
			row.Change = "changed"
		} else if !r.Reviewed {
			row.Change = "new"
		}
		markup := s.Markup
		if r.MarkupOverride != "" {
			markup = r.MarkupOverride
		}
		if row.Latest != nil && row.Listing != nil && r.ReviewedMarkup != "" && r.ReviewedMarkup != markup {
			row.Change = "changed"
		}
		rows = append(rows, row)
	}
	history := []model.UpstreamRefresh{}
	if err := model.DB.Omit("snapshot_json").Where("source_id = ?", s.Id).Order("id desc").Limit(20).Find(&history).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"source": upstreamSourceView{s, s.CatalogKey != "", s.RelayKey != ""}, "rows": rows, "history": history})
}
func RefreshUpstreamSource(c *gin.Context) {
	s, err := upstreamSource(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var quotes []model.UpstreamQuote
	var encryptedKey string
	if s.AccountId > 0 {
		var account model.UpstreamAccount
		if err = model.DB.First(&account, s.AccountId).Error; err == nil {
			quotes, encryptedKey, err = service.FetchUpstreamKeyModels(account, s)
		}
	} else if s.Adapter == "direct-key" {
		quotes, err = service.FetchUpstreamManualKeyModels(s)
	} else {
		quotes, err = service.FetchUpstreamCatalog(s)
	}
	if err != nil {
		updates := map[string]any{"last_error": err.Error()}
		if s.AccountId > 0 || s.Adapter == "direct-key" {
			updates["latest_time"] = 0
			updates["revision"] = s.Revision + 1
		}
		model.DB.Model(&s).Where("revision = ?", s.Revision).Updates(updates)
		common.ApiError(c, err)
		return
	}
	if err := model.SaveUpstreamKeySnapshot(s.Id, s.Revision, quotes, encryptedKey); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"models": len(quotes)})
}
func ImportUpstreamCatalog(c *gin.Context) {
	s, err := upstreamSource(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if s.Adapter == "direct-key" {
		common.ApiErrorMsg(c, "confirm manually entered Key prices from the model list")
		return
	}
	if s.AccountId > 0 {
		common.ApiErrorMsg(c, "refresh account Keys to read verified models and prices")
		return
	}
	var req struct {
		Revision int64                 `json:"revision"`
		Models   []model.UpstreamQuote `json:"models"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8*1024*1024)
	if err := c.ShouldBindJSON(&req); err != nil || req.Models == nil {
		common.ApiErrorMsg(c, "provide a models array with verified USD prices")
		return
	}
	if err := model.SaveUpstreamSnapshot(s.Id, req.Revision, req.Models); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

type upstreamSelectionInput struct {
	Revision    int64             `json:"revision"`
	Models      map[string]string `json:"models"`
	Fingerprint string            `json:"fingerprint"`
}

func PreviewUpstreamModels(c *gin.Context) {
	s, err := upstreamSource(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var req upstreamSelectionInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256*1024)
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid model selection")
		return
	}
	if s.LatestTime == 0 {
		common.ApiErrorMsg(c, "refresh the catalog after changing price source settings")
		return
	}
	preview, err := service.PreviewUpstreamSelection(s, req.Revision, req.Models)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, preview)
}
func ApplyUpstreamModels(c *gin.Context) {
	s, err := upstreamSource(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var req upstreamSelectionInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256*1024)
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid model selection")
		return
	}
	if s.LatestTime == 0 {
		common.ApiErrorMsg(c, "refresh this source before applying")
		return
	}
	preview, err := service.PreviewUpstreamSelection(s, req.Revision, req.Models)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Fingerprint == "" || req.Fingerprint != preview.Fingerprint {
		common.ApiErrorMsg(c, "prices or channel settings changed; preview again before applying")
		return
	}
	if err := model.ApplyUpstreamSelection(s.Id, req.Revision, preview.Proposals); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
func ReviewUpstreamChanges(c *gin.Context) {
	s, err := upstreamSource(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var req struct {
		Revision int64    `json:"revision"`
		Models   []string `json:"models"`
		Pause    bool     `json:"pause"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid review selection")
		return
	}
	if err := model.ReviewUpstreamModels(s.Id, req.Revision, req.Models, req.Pause); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
func GetUpstreamHistory(c *gin.Context) {
	s, err := upstreamSource(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var history model.UpstreamRefresh
	if err := model.DB.Where("source_id = ? AND id = ?", s.Id, c.Param("history_id")).First(&history).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var quotes []model.UpstreamQuote
	if err := common.UnmarshalJsonStr(history.SnapshotJSON, &quotes); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, quotes)
}

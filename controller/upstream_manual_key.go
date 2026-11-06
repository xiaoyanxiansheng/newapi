package controller

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetUpstreamManualKeys(c *gin.Context) {
	rows := []model.UpstreamSource{}
	if err := model.DB.Omit("latest_json").Where("account_id = ? AND adapter = ?", 0, "direct-key").Order("id desc").Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	views := []upstreamSourceView{}
	for _, row := range rows {
		views = append(views, upstreamSourceView{row, false, row.RelayKey != ""})
	}
	common.ApiSuccess(c, views)
}

func SaveUpstreamManualKey(c *gin.Context) {
	var req struct {
		Name     string  `json:"name"`
		BaseURL  string  `json:"base_url"`
		Key      *string `json:"key"`
		Markup   string  `json:"markup"`
		Revision int64   `json:"revision"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32768)
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid manually entered Key")
		return
	}
	base, err := service.NormalizeUpstreamKeyURL(req.BaseURL)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		u, _ := url.Parse(base)
		req.Name = u.Host
	}
	if len(req.Name) > 255 {
		common.ApiErrorMsg(c, "provide a valid Key name")
		return
	}
	if _, err := model.ParseUpstreamMarkup(req.Markup); err != nil {
		common.ApiError(c, err)
		return
	}
	id := 0
	if c.Param("id") != "" {
		id, err = strconv.Atoi(c.Param("id"))
		if err != nil || id <= 0 {
			common.ApiErrorMsg(c, "invalid source ID")
			return
		}
	}
	source := model.UpstreamSource{Name: req.Name, BaseURL: base, Adapter: "direct-key", Markup: req.Markup, PurchaseMultiplier: "1", KeyStatus: 1, CreatedTime: common.GetTimestamp()}
	if id > 0 {
		if err := model.DB.First(&source, id).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		if source.AccountId != 0 || source.Adapter != "direct-key" {
			common.ApiErrorMsg(c, "manage account Keys from the upstream account page")
			return
		}
		if source.BaseURL != base {
			common.ApiErrorMsg(c, "add a separate Key when changing its API address")
			return
		}
	}
	changed := false
	if req.Key != nil && strings.TrimSpace(*req.Key) != "" {
		key := strings.TrimSpace(*req.Key)
		if len(key) > 16384 || strings.ContainsAny(key, "* \t\r\n") {
			common.ApiErrorMsg(c, "invalid API key")
			return
		}
		previous := ""
		if source.RelayKey != "" {
			previous, err = common.OpenUpstreamSecret(source.RelayKey)
			if err != nil {
				common.ApiError(c, err)
				return
			}
		}
		if key != previous {
			source.RelayKey, err = common.SealUpstreamSecret(key)
			if err != nil {
				common.ApiError(c, err)
				return
			}
			if len(key) > 8 {
				source.KeyMasked = key[:4] + "********" + key[len(key)-4:]
			} else {
				source.KeyMasked = "********"
			}
			changed = true
		}
	}
	if source.RelayKey == "" {
		common.ApiErrorMsg(c, "provide the existing API Key")
		return
	}
	if id == 0 {
		if err := model.DB.Create(&source).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{"id": source.Id})
		return
	}
	updates := map[string]any{"name": req.Name, "markup": req.Markup, "relay_key": source.RelayKey, "key_masked": source.KeyMasked, "revision": req.Revision + 1}
	if changed {
		updates["latest_time"] = 0
		updates["last_error"] = ""
		updates["price_group"] = ""
		updates["key_issue"] = ""
	}
	result := model.DB.Model(&source).Where("revision = ?", req.Revision).Updates(updates)
	if result.Error != nil {
		common.ApiError(c, result.Error)
		return
	}
	if result.RowsAffected != 1 {
		common.ApiErrorMsg(c, "Key changed; reload before saving")
		return
	}
	common.ApiSuccess(c, gin.H{"id": id})
}

func upstreamManualPrice(c *gin.Context) (model.UpstreamSource, []model.UpstreamQuote, error) {
	source, err := upstreamSource(c)
	if err != nil {
		return source, nil, err
	}
	if source.AccountId != 0 || source.Adapter != "direct-key" {
		return source, nil, errors.New("confirm prices only for a manually entered Key")
	}
	if source.LatestTime == 0 || source.LastError != "" || source.KeyStatus != 1 || source.KeyMissing {
		return source, nil, errors.New("refresh and verify this Key before confirming prices")
	}
	var quotes []model.UpstreamQuote
	err = common.UnmarshalJsonStr(source.LatestJSON, &quotes)
	return source, quotes, err
}

func GetUpstreamManualPrice(c *gin.Context) {
	_, quotes, err := upstreamManualPrice(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	name := c.Query("model")
	for _, quote := range quotes {
		if quote.Model != name {
			continue
		}
		original, err := service.UpstreamLocalBasePrices(name)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		unit := "per_million_tokens"
		if original.Request != "" {
			unit = "per_request"
		}
		common.ApiSuccess(c, gin.H{"model": name, "original": original, "cost": quote.Cost, "currency": "USD", "unit": unit})
		return
	}
	common.ApiErrorMsg(c, "selected model is absent from the latest catalog")
}

func SaveUpstreamManualPrice(c *gin.Context) {
	source, quotes, err := upstreamManualPrice(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var req struct {
		Model    string               `json:"model"`
		Cost     model.UpstreamPrices `json:"cost"`
		Revision int64                `json:"revision"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "provide verified purchase prices for this model")
		return
	}
	if req.Revision != source.Revision {
		common.ApiErrorMsg(c, "Key changed; reload before saving")
		return
	}
	index := -1
	for i := range quotes {
		if quotes[i].Model == req.Model {
			index = i
			break
		}
	}
	if index < 0 {
		common.ApiErrorMsg(c, "selected model is absent from the latest catalog")
		return
	}
	original, err := service.UpstreamLocalBasePrices(req.Model)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	quote := model.UpstreamQuote{Model: req.Model, Original: original, Cost: req.Cost, Unit: "per_million_tokens", Currency: "USD"}
	if original.Request != "" {
		quote.Unit = "per_request"
	}
	ratio, _, err := model.DeriveUpstreamListingRatio(original, quote, "1")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	quote.UpstreamRatio = strconv.FormatFloat(ratio, 'f', -1, 64)
	quotes[index] = quote
	if err := model.SaveUpstreamSnapshot(source.Id, req.Revision, quotes); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetUpstreamRouteQuotes(c *gin.Context) {
	source, err := upstreamSource(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	keyword := strings.TrimSpace(c.Query("model"))
	if len(keyword) > 255 {
		common.ApiErrorMsg(c, "model search must be at most 255 characters")
		return
	}
	var account model.UpstreamAccount
	if source.AccountId <= 0 {
		common.ApiErrorMsg(c, "route quotes require an authorized upstream account")
		return
	}
	if err := model.DB.First(&account, source.AccountId).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	quotes, err := service.GetUpstreamRouteQuotes(c.Request.Context(), account, source, keyword)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	common.ApiSuccess(c, quotes)
}

package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"net/http"
)

func ManageUpstreamAccountLifecycle(c *gin.Context) {
	account, err := upstreamAccount(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var request struct {
		Revision *int64 `json:"revision"`
		Disabled *bool  `json:"disabled"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if c.ShouldBindJSON(&request) != nil || request.Revision == nil || (c.Request.Method != http.MethodDelete && request.Disabled == nil) {
		common.ApiErrorMsg(c, "invalid upstream channel management request")
		return
	}
	if c.Request.Method == http.MethodDelete {
		err = model.DeleteUpstreamAccount(account.Id, *request.Revision)
	} else {
		err = model.SetUpstreamAccountDisabled(account.Id, *request.Revision, *request.Disabled)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": c.Request.Method == http.MethodDelete})
}

func ManageUpstreamManualChannelLifecycle(c *gin.Context) {
	source, err := upstreamSource(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var request struct {
		Revision *int64 `json:"revision"`
		Disabled *bool  `json:"disabled"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if c.ShouldBindJSON(&request) != nil || request.Revision == nil || (c.Request.Method != http.MethodDelete && request.Disabled == nil) {
		common.ApiErrorMsg(c, "invalid upstream channel management request")
		return
	}
	if c.Request.Method == http.MethodDelete {
		err = model.DeleteUpstreamManualChannel(source.Id, *request.Revision)
	} else {
		err = model.SetUpstreamManualChannelDisabled(source.Id, *request.Revision, *request.Disabled)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": c.Request.Method == http.MethodDelete})
}

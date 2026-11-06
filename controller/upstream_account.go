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
	"gorm.io/gorm"
)

func GetUpstreamAccounts(c *gin.Context) {
	accounts := []model.UpstreamAccount{}
	if err := model.DB.Order("id desc").Find(&accounts).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	for i := range accounts {
		accounts[i].Workflow = service.UpstreamAccountWorkflow(accounts[i].Website)
		accounts[i].HasSession = service.HasUpstreamBrowserAuthorization(accounts[i])
	}
	common.ApiSuccess(c, accounts)
}

func SaveUpstreamAccount(c *gin.Context) {
	var req struct {
		Name           string  `json:"name"`
		Website        string  `json:"website"`
		Username       *string `json:"username"`
		KeyPageURL     *string `json:"key_page_url"`
		BalancePageURL *string `json:"balance_page_url"`
		Password       *string `json:"password"`
		Markup         string  `json:"markup"`
		Revision       int64   `json:"revision"`
		AuthType       string  `json:"auth_type"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid upstream account")
		return
	}
	id := 0
	var current model.UpstreamAccount
	if value := c.Param("account_id"); value != "" {
		var err error
		id, err = strconv.Atoi(value)
		if err != nil || id <= 0 {
			common.ApiErrorMsg(c, "invalid upstream account ID")
			return
		}
		if err := model.DB.First(&current, id).Error; err != nil {
			common.ApiError(c, err)
			return
		}
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Website = strings.TrimRight(strings.TrimSpace(req.Website), "/")
	keyPage := current.KeyPageURL
	if req.KeyPageURL != nil {
		origin, page, err := service.ParseUpstreamKeyPage(*req.KeyPageURL)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if req.Website != "" && req.Website != origin {
			common.ApiErrorMsg(c, "Key management page must belong to the upstream website")
			return
		}
		req.Website = origin
		keyPage = page
	} else if id > 0 && req.Website == "" {
		req.Website = current.Website
	}
	username := current.Username
	if req.Username != nil {
		username = strings.TrimSpace(*req.Username)
	}
	if req.AuthType == "" {
		if id > 0 {
			req.AuthType = current.AuthType
		} else if req.KeyPageURL != nil {
			req.AuthType = "browser"
		}
		// Preserve the legacy API contract for clients still sending credentials.
		if req.AuthType == "" {
			req.AuthType = "password"
		}
	}
	if req.AuthType != "password" && req.AuthType != "browser" {
		common.ApiErrorMsg(c, "invalid upstream login method")
		return
	}
	if req.Name == "" || (req.AuthType == "password" && username == "") || len(req.Name) > 255 || len(username) > 255 || len(req.Website) > 2048 {
		common.ApiErrorMsg(c, "provide a website name and login username")
		return
	}
	if err := service.ValidateUpstreamURL(req.Website); err != nil {
		common.ApiError(c, err)
		return
	}
	u, _ := url.Parse(req.Website)
	if u.Scheme != "https" || u.RawQuery != "" || (u.Path != "" && u.Path != "/") {
		common.ApiErrorMsg(c, "use the HTTPS website origin without paths or query parameters")
		return
	}
	if _, err := model.ParseUpstreamMarkup(req.Markup); err != nil {
		common.ApiError(c, err)
		return
	}
	if id > 0 && req.Website != current.Website {
		common.ApiErrorMsg(c, "add a separate upstream account when changing the website")
		return
	}
	if keyPage == "" {
		keyPage = req.Website + "/keys"
	}
	balancePage := current.BalancePageURL
	if req.BalancePageURL != nil {
		balancePage = strings.TrimSpace(*req.BalancePageURL)
		if balancePage != "" {
			origin, page, err := service.ParseUpstreamKeyPage(balancePage)
			if err != nil || origin != req.Website {
				common.ApiErrorMsg(c, "balance page must belong to the upstream website")
				return
			}
			balancePage = page
		}
	}
	a := model.UpstreamAccount{Name: req.Name, Website: req.Website, KeyPageURL: keyPage, Username: username, AuthType: req.AuthType, Markup: req.Markup, Workflow: service.UpstreamAccountWorkflow(req.Website), CreatedTime: common.GetTimestamp(), Password: current.Password}
	a.BalancePageURL = balancePage
	if req.AuthType == "password" && req.Password != nil && *req.Password != "" {
		if len(*req.Password) > 4096 {
			common.ApiErrorMsg(c, "password is too long")
			return
		}
		var err error
		a.Password, err = common.SealUpstreamSecret(*req.Password)
		if err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if req.AuthType == "password" && a.Password == "" {
		common.ApiErrorMsg(c, "provide the website login password")
		return
	}
	if id == 0 {
		if err := model.DB.Create(&a).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{"id": a.Id})
		return
	}
	identityChanged := a.Username != current.Username
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{"name": a.Name, "key_page_url": a.KeyPageURL, "username": a.Username, "password": a.Password, "auth_type": a.AuthType, "markup": a.Markup, "workflow": a.Workflow, "revision": req.Revision + 1}
		updates["balance_page_url"] = a.BalancePageURL
		if identityChanged || a.Password != current.Password || a.AuthType != current.AuthType {
			updates["last_error"] = ""
		}
		// The revision update serializes against Key sync. If Keys already exist,
		// roll back rather than reconnecting their models to a different identity.
		result := tx.Model(&current).Where("revision = ?", req.Revision).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("account changed; reload before saving")
		}
		if identityChanged {
			var count int64
			if err := tx.Model(&model.UpstreamSource{}).Where("account_id = ?", id).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return errors.New("login username cannot change after Keys have been read; add a separate upstream account")
			}
		}
		return tx.Model(&model.UpstreamSource{}).Where("account_id = ?", id).Updates(map[string]any{"markup": a.Markup, "revision": gorm.Expr("revision + 1")}).Error
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id})
}

func upstreamAccount(c *gin.Context) (model.UpstreamAccount, error) {
	id, err := strconv.Atoi(c.Param("account_id"))
	if err != nil || id <= 0 {
		return model.UpstreamAccount{}, errors.New("invalid upstream account ID")
	}
	var a model.UpstreamAccount
	err = model.DB.First(&a, id).Error
	return a, err
}

func GetUpstreamAccount(c *gin.Context) {
	a, err := upstreamAccount(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	a.Workflow = service.UpstreamAccountWorkflow(a.Website)
	a.HasSession = service.HasUpstreamBrowserAuthorization(a)
	keys := []model.UpstreamSource{}
	if err := model.DB.Omit("latest_json", "relay_key", "catalog_key").Where("account_id = ?", a.Id).Order("remote_key_id asc").Find(&keys).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	for i := range keys {
		keys[i].AccountDisabled = a.Disabled
	}
	common.ApiSuccess(c, gin.H{"account": a, "keys": keys})
}

func ConnectUpstreamBrowserAuthorization(c *gin.Context) {
	a, err := upstreamAccount(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var req struct {
		AccessToken string                            `json:"access_token"`
		UserID      int                               `json:"user_id"`
		Revision    int64                             `json:"revision"`
		Discovery   *service.UpstreamBrowserDiscovery `json:"discovery,omitempty"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8*1024*1024)
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid upstream browser authorization")
		return
	}
	if req.Revision != a.Revision {
		common.ApiErrorMsg(c, "account changed; reload before saving")
		return
	}
	if req.Discovery != nil {
		if err := service.SaveUpstreamDiscovery(a, *req.Discovery); err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{"connected": true, "keys": len(req.Discovery.Keys), "read_mode": req.Discovery.Connector.Kind, "complete": req.Discovery.Complete})
		return
	}
	sealed, identity, err := service.VerifyUpstreamBrowserAuthorization(a, req.AccessToken, req.UserID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	err = model.SaveUpstreamBrowserAuthorization(a, sealed, identity.ID, identity.Username, identity.Email)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"connected": true, "remote_user_id": identity.ID})
}

func RefreshUpstreamAccount(c *gin.Context) {
	a, err := upstreamAccount(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if a.BrowserDiscovery != "" {
		common.ApiErrorMsg(c, "open the upstream website and authorize a fresh Key page read")
		return
	}
	keys, err := service.FetchUpstreamExistingKeys(a)
	if err != nil {
		model.DB.Model(&a).Where("revision = ?", a.Revision).Update("last_error", err.Error())
		common.ApiError(c, err)
		return
	}
	if err := model.SyncUpstreamKeys(a, keys); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"keys": len(keys)})
}

func SetUpstreamListingState(c *gin.Context) {
	s, err := upstreamSource(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var req struct {
		Model    string `json:"model"`
		Enabled  bool   `json:"enabled"`
		Remove   bool   `json:"remove"`
		Revision int64  `json:"revision"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Model == "" {
		common.ApiErrorMsg(c, "invalid model management request")
		return
	}
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		var source model.UpstreamSource
		if err := tx.First(&source, s.Id).Error; err != nil {
			return err
		}
		if source.AccountId == 0 && source.Adapter != "direct-key" {
			return errors.New("manage models from an upstream account Key")
		}
		if source.Revision != req.Revision {
			return errors.New("Key changed; reload before managing this model")
		}
		if req.Enabled && !req.Remove {
			if err := model.EnsureUpstreamModelAllowed(tx, source, req.Model); err != nil {
				return err
			}
			if source.KeyMissing || source.KeyStatus != 1 || source.LatestTime == 0 || source.KeyIssue != "" || (source.KeyExpiresAt > 0 && source.KeyExpiresAt <= common.GetTimestamp()) {
				return errors.New("refresh and verify this Key before resuming a model")
			}
			var quotes []model.UpstreamQuote
			if err := common.UnmarshalJsonStr(source.LatestJSON, &quotes); err != nil {
				return err
			}
			verified := false
			for _, q := range quotes {
				if q.Model == req.Model && q.PriceIssue == "" && q.Validate() == nil {
					verified = true
					break
				}
			}
			if !verified {
				return errors.New("this model is missing or its price is unverified; refresh before resuming")
			}
		}
		var listing model.MarketListing
		if err := tx.Where("channel_id = ? AND model_name = ?", source.ChannelId, req.Model).First(&listing).Error; err != nil {
			return err
		}
		if req.Remove {
			if err := model.DeleteMarketListingsTx(tx, []int{listing.Id}); err != nil {
				return err
			}
			if err := tx.Model(&model.UpstreamReview{}).Where("source_id = ? AND model_name = ?", source.Id, req.Model).Updates(map[string]any{"listing_id": 0, "applied_markup": ""}).Error; err != nil {
				return err
			}
		} else {
			if !req.Enabled {
				if err := model.PruneTokenRouteBindings(tx, nil, []model.MarketListing{listing}); err != nil {
					return err
				}
			}
			if err := tx.Model(&listing).Updates(map[string]any{"enabled": req.Enabled, "updated_time": common.GetTimestamp()}).Error; err != nil {
				return err
			}
		}
		result := tx.Model(&source).Where("revision = ?", req.Revision).Update("revision", req.Revision+1)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("Key changed; reload")
		}
		return nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateMarketListings()
	common.ApiSuccess(c, nil)
}

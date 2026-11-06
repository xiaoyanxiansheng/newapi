package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
)

func TestUpstreamAccountSavesEncryptedPasswordAndRetainsItWhenEditing(t *testing.T) {
	db := upstreamControllerDB(t)
	t.Setenv("CRYPTO_SECRET", "persistent-test-secret-123")
	input := map[string]any{"name": "CCTQ", "website": "https://www.cctq.ai", "username": "owner", "password": "private-login-password", "markup": "1.1"}
	result := upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPost, "/", 0, input)
	require.Equal(t, true, result["success"])
	var account model.UpstreamAccount
	require.NoError(t, db.First(&account).Error)
	assert.NotEqual(t, "private-login-password", account.Password)
	decrypted, err := common.OpenUpstreamSecret(account.Password)
	require.NoError(t, err)
	assert.Equal(t, "private-login-password", decrypted)
	oldSecret := account.Password
	input["password"] = ""
	input["markup"] = "1.2"
	input["revision"] = 0
	result = upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPut, "/", account.Id, input)
	require.Equal(t, true, result["success"])
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.Equal(t, oldSecret, account.Password)
	for _, handler := range []gin.HandlerFunc{GetUpstreamAccounts, GetUpstreamAccount} {
		response := upstreamControllerCall(t, handler, http.MethodGet, "/", account.Id, nil)
		data, err := common.Marshal(response)
		require.NoError(t, err)
		assert.NotContains(t, string(data), "private-login-password")
		assert.NotContains(t, string(data), oldSecret)
	}
	result = upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPut, "/", account.Id, input)
	assert.Equal(t, false, result["success"])
}

func TestUpstreamAccountKeyCannotImportUnverifiedPricesOrResumeMissingModel(t *testing.T) {
	db := upstreamControllerDB(t)
	account := model.UpstreamAccount{Name: "fixture", Website: "https://fixture.example", Markup: "1.1"}
	require.NoError(t, db.Create(&account).Error)
	source := model.UpstreamSource{AccountId: account.Id, KeyStatus: 1, ChannelId: 7, Markup: "1.1"}
	require.NoError(t, db.Create(&source).Error)
	quote := model.UpstreamQuote{Model: "a", Currency: "USD", Unit: "per_request", Original: model.UpstreamPrices{Request: "20"}, Cost: model.UpstreamPrices{Request: "2"}}
	require.NoError(t, model.SaveUpstreamSnapshot(source.Id, 0, []model.UpstreamQuote{quote}))
	result := upstreamControllerCall(t, ImportUpstreamCatalog, http.MethodPost, "/", source.Id, map[string]any{"revision": 1, "models": []model.UpstreamQuote{quote}})
	assert.Equal(t, false, result["success"])
	listing := model.MarketListing{ChannelId: 7, ModelName: "a", Ratio: 0.11, Enabled: true}
	require.NoError(t, db.Create(&listing).Error)
	request := map[string]any{"revision": 1, "model": "a", "enabled": false, "remove": false}
	result = upstreamControllerCall(t, SetUpstreamListingState, http.MethodPost, "/", source.Id, request)
	require.Equal(t, true, result["success"])
	require.NoError(t, db.First(&listing, listing.Id).Error)
	assert.False(t, listing.Enabled)
	assert.Equal(t, 0.11, listing.Ratio)
	request["revision"] = 2
	request["enabled"] = true
	result = upstreamControllerCall(t, SetUpstreamListingState, http.MethodPost, "/", source.Id, request)
	require.Equal(t, true, result["success"])
	require.NoError(t, db.First(&listing, listing.Id).Error)
	assert.True(t, listing.Enabled)
	assert.Equal(t, 0.11, listing.Ratio)
	require.NoError(t, model.SaveUpstreamSnapshot(source.Id, 3, []model.UpstreamQuote{}))
	request["revision"] = 4
	request["enabled"] = true
	result = upstreamControllerCall(t, SetUpstreamListingState, http.MethodPost, "/", source.Id, request)
	assert.Equal(t, false, result["success"])
	request["enabled"] = false
	request["remove"] = true
	result = upstreamControllerCall(t, SetUpstreamListingState, http.MethodPost, "/", source.Id, request)
	require.Equal(t, true, result["success"])
	var count int64
	require.NoError(t, db.Model(&model.MarketListing{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestUpstreamAccountUsernameCanBeCorrectedOnlyBeforeKeysAreAssociated(t *testing.T) {
	for _, linked := range []bool{false, true} {
		t.Run(map[bool]string{false: "before Key reading", true: "after Key reading"}[linked], func(t *testing.T) {
			db := upstreamControllerDB(t)
			t.Setenv("CRYPTO_SECRET", "persistent-test-secret-123")
			sealed, err := common.SealUpstreamSecret("saved-password")
			require.NoError(t, err)
			account := model.UpstreamAccount{Name: "CCTQ", Website: "https://www.cctq.ai", Username: "email@example.com", Password: sealed, Markup: "1.1", Revision: 2, LastError: "previous login error"}
			require.NoError(t, db.Create(&account).Error)
			if linked {
				require.NoError(t, db.Create(&model.UpstreamSource{AccountId: account.Id, RemoteKeyId: 7}).Error)
			}
			input := map[string]any{"name": account.Name, "website": account.Website, "username": "correct-username", "markup": account.Markup, "revision": account.Revision}
			result := upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPut, "/", account.Id, input)
			var saved model.UpstreamAccount
			require.NoError(t, db.First(&saved, account.Id).Error)
			assert.Equal(t, sealed, saved.Password)
			if linked {
				assert.Equal(t, false, result["success"])
				assert.Equal(t, account.Username, saved.Username)
				assert.Equal(t, account.Revision, saved.Revision)
				assert.Equal(t, account.LastError, saved.LastError)
			} else {
				require.Equal(t, true, result["success"])
				assert.Equal(t, "correct-username", saved.Username)
				assert.Equal(t, int64(3), saved.Revision)
				assert.Empty(t, saved.LastError)
			}
			input["website"] = "https://cctq.ai"
			input["revision"] = saved.Revision
			result = upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPut, "/", account.Id, input)
			assert.Equal(t, false, result["success"])
		})
	}
}

func TestUpstreamAccountsExposeCurrentXXAPIConnectorEvenWhenStoredWorkflowIsEmpty(t *testing.T) {
	db := upstreamControllerDB(t)
	account := model.UpstreamAccount{Name: "xxapi", Website: "https://xxapi.info", Username: "owner", Workflow: ""}
	require.NoError(t, db.Create(&account).Error)
	result := upstreamControllerCall(t, GetUpstreamAccount, http.MethodGet, "/", account.Id, nil)
	require.Equal(t, true, result["success"])
	data := result["data"].(map[string]any)
	assert.Equal(t, "xxapi-existing-keys-v1", data["account"].(map[string]any)["workflow"])
	result = upstreamControllerCall(t, GetUpstreamAccounts, http.MethodGet, "/", 0, nil)
	require.Equal(t, true, result["success"])
	assert.Equal(t, "xxapi-existing-keys-v1", result["data"].([]any)[0].(map[string]any)["workflow"])
}

func TestUpstreamBrowserAccountDoesNotRequireOrStoreAGooglePassword(t *testing.T) {
	db := upstreamControllerDB(t)
	input := map[string]any{"name": "CCTQ", "website": "https://www.cctq.ai", "auth_type": "browser", "markup": "1.1"}
	result := upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPost, "/", 0, input)
	require.Equal(t, true, result["success"])
	var account model.UpstreamAccount
	require.NoError(t, db.First(&account).Error)
	assert.Empty(t, account.Password)
}

func TestUpstreamAccountResponsesNeverExposeBrowserAuthorization(t *testing.T) {
	db := upstreamControllerDB(t)
	account := model.UpstreamAccount{Name: "CCTQ", Website: "https://www.cctq.ai", AuthType: "browser", BrowserSession: "encrypted-browser-session-secret", RemoteUserId: 17}
	require.NoError(t, db.Create(&account).Error)
	for _, handler := range []gin.HandlerFunc{GetUpstreamAccounts, GetUpstreamAccount} {
		result := upstreamControllerCall(t, handler, http.MethodGet, "/", account.Id, nil)
		require.Equal(t, true, result["success"])
		raw, err := common.Marshal(result)
		require.NoError(t, err)
		assert.NotContains(t, string(raw), account.BrowserSession)
		assert.Contains(t, string(raw), "has_session")
	}
}

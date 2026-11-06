package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpstreamAccountKeyPageCreatesBrowserAccountWithoutCredentials(t *testing.T) {
	db := upstreamControllerDB(t)
	result := upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPost, "/", 0, map[string]any{
		"name": "CCTQ", "key_page_url": "https://cctq.ai/console/token?view=all#keys", "markup": "1.1",
	})
	require.Equal(t, true, result["success"])
	var account model.UpstreamAccount
	require.NoError(t, db.First(&account).Error)
	assert.Equal(t, "https://www.cctq.ai", account.Website)
	assert.Equal(t, "https://www.cctq.ai/console/token?view=all#keys", account.KeyPageURL)
	assert.Equal(t, "browser", account.AuthType)
	assert.Equal(t, "cctq-existing-keys-v1", account.Workflow)
	assert.Empty(t, account.Username)
	assert.Empty(t, account.Password)
}

func TestUpstreamAccountSimplifiedSettingsPreserveIdentityAndPublishedPrices(t *testing.T) {
	db := upstreamControllerDB(t)
	account := model.UpstreamAccount{Name: "xxapi", Website: "https://xxapi.info", KeyPageURL: "https://xxapi.info/console/token", Username: "owner", Password: "legacy-secret", AuthType: "password", BrowserSession: "sealed-session", RemoteUserId: 17, Markup: "1.1", Revision: 2}
	require.NoError(t, db.Create(&account).Error)
	source := model.UpstreamSource{AccountId: account.Id, RemoteKeyId: 33, ChannelId: 7, RelayKey: "sealed-key", LatestTime: 100, LatestJSON: "[]", Revision: 4, Markup: "1.1"}
	require.NoError(t, db.Create(&source).Error)
	listing := model.MarketListing{ChannelId: 7, ModelName: "a", Ratio: 0.11, Enabled: true}
	require.NoError(t, db.Create(&listing).Error)
	result := upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPut, "/", account.Id, map[string]any{
		"name": "Renamed website", "markup": "1.2", "auth_type": "browser", "revision": 2,
	})
	require.Equal(t, true, result["success"])
	var saved model.UpstreamAccount
	require.NoError(t, db.First(&saved, account.Id).Error)
	assert.Equal(t, account.Website, saved.Website)
	assert.Equal(t, account.KeyPageURL, saved.KeyPageURL)
	assert.Equal(t, account.Username, saved.Username)
	assert.Equal(t, account.Password, saved.Password)
	assert.Equal(t, account.BrowserSession, saved.BrowserSession)
	assert.Equal(t, account.RemoteUserId, saved.RemoteUserId)
	assert.Equal(t, "Renamed website", saved.Name)
	assert.Equal(t, "browser", saved.AuthType)
	assert.Equal(t, int64(3), saved.Revision)
	var savedSource model.UpstreamSource
	require.NoError(t, db.First(&savedSource, source.Id).Error)
	source.Markup = "1.2"
	source.Revision++
	assert.Equal(t, source, savedSource)
	var savedListing model.MarketListing
	require.NoError(t, db.First(&savedListing, listing.Id).Error)
	assert.Equal(t, listing, savedListing)
	result = upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPut, "/", account.Id, map[string]any{
		"name": saved.Name, "markup": "1.2", "auth_type": "browser", "revision": 3, "key_page_url": "https://www.cctq.ai/keys",
	})
	assert.Equal(t, false, result["success"])
	require.NoError(t, db.First(&saved, account.Id).Error)
	assert.Equal(t, account.Website, saved.Website)
	assert.Equal(t, int64(3), saved.Revision)
}

func TestUpstreamAccountInvalidKeyPageCannotBeSaved(t *testing.T) {
	db := upstreamControllerDB(t)
	for _, page := range []string{"", "http://xxapi.info/keys", "https://owner:password@xxapi.info/keys", "javascript:alert(1)", "https:///keys"} {
		t.Run(page, func(t *testing.T) {
			result := upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPost, "/", 0, map[string]any{
				"name": "site", "key_page_url": page, "markup": "1.1", "auth_type": "browser",
			})
			assert.Equal(t, false, result["success"])
			var count int64
			require.NoError(t, db.Model(&model.UpstreamAccount{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

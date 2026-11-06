package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpstreamNewWebsiteDiscoversExistingKeysWithoutDomainAdapterOrPassword(t *testing.T) {
	t.Setenv("CRYPTO_SECRET", "persistent-discovery-controller-test-secret")
	db := upstreamControllerDB(t)
	result := upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPost, "/", 0, map[string]any{"name": "new site", "key_page_url": "https://new-site.example/console/token", "markup": "1.1"})
	require.Equal(t, true, result["success"])
	var account model.UpstreamAccount
	require.NoError(t, db.First(&account).Error)
	assert.Equal(t, "browser-auto-v1", account.Workflow)
	snapshot := map[string]any{"page_url": account.KeyPageURL, "connector": map[string]any{"kind": "newapi", "list_path": "/api/token/?p=0&size=100", "page_start": 0}, "identity": map[string]any{"id": 17, "username": "owner"}, "complete": true, "keys": []map[string]any{{"id": 33, "name": "existing", "key": "sk-existing-imported-secret", "group": "cheap", "status": 1, "models": nil}}}
	result = upstreamControllerCall(t, ConnectUpstreamBrowserAuthorization, http.MethodPost, "/", account.Id, map[string]any{"revision": account.Revision, "discovery": snapshot})
	require.Equal(t, true, result["success"], result["message"])
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.Empty(t, account.Password)
	assert.NotContains(t, account.BrowserDiscovery, "sk-existing-imported-secret")
	raw, err := common.OpenUpstreamSecret(string(account.BrowserDiscovery))
	require.NoError(t, err)
	assert.Contains(t, raw, "sk-existing-imported-secret")
	var source model.UpstreamSource
	require.NoError(t, db.Where("account_id = ?", account.Id).First(&source).Error)
	assert.Equal(t, 33, source.RemoteKeyId)
	assert.Equal(t, "cheap", source.PriceGroup)
	assert.NotContains(t, source.KeyMasked, "existing-imported")
	public, err := common.Marshal(account)
	require.NoError(t, err)
	assert.NotContains(t, string(public), "sk-existing-imported-secret")
	assert.NotContains(t, string(public), string(account.BrowserDiscovery))
	result = upstreamControllerCall(t, RefreshUpstreamAccount, http.MethodPost, "/", account.Id, map[string]any{})
	assert.Equal(t, false, result["success"], "a stale server cache must not claim a fresh browser read")
}

func TestUpstreamDiscoveryRejectsAnotherOriginWithoutReplacingExistingAuthorization(t *testing.T) {
	db := upstreamControllerDB(t)
	account := model.UpstreamAccount{Name: "site", Website: "https://new-site.example", AuthType: "browser", Markup: "1.1", Revision: 3}
	require.NoError(t, db.Create(&account).Error)
	result := upstreamControllerCall(t, ConnectUpstreamBrowserAuthorization, http.MethodPost, "/", account.Id, map[string]any{"revision": 3, "discovery": map[string]any{"page_url": "https://other.example/keys", "connector": map[string]any{"kind": "page"}, "keys": []any{}, "complete": false}})
	assert.Equal(t, false, result["success"])
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.Equal(t, int64(3), account.Revision)
	assert.Empty(t, account.BrowserDiscovery)
	var count int64
	require.NoError(t, db.Model(&model.UpstreamSource{}).Count(&count).Error)
	assert.Zero(t, count)
}

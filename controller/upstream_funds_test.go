package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpstreamFundsImportReplacesKeySpendAndPreservesMissingBalance(t *testing.T) {
	t.Setenv("CRYPTO_SECRET", "upstream-funds-fixture-secret")
	db := upstreamControllerDB(t)
	account := model.UpstreamAccount{Name: "site", Website: "https://site.example", KeyPageURL: "https://site.example/keys", AuthType: "browser", Markup: "1.1"}
	require.NoError(t, db.Create(&account).Error)
	key := map[string]any{"id": 33, "name": "cc-max", "key": "sk-existing-fixture-key", "group": "vip", "status": 1, "used_cny": "78.76"}
	snapshot := map[string]any{"page_url": account.KeyPageURL, "connector": map[string]any{"kind": "newapi"}, "identity": map[string]any{"id": 7, "username": "owner"}, "keys": []any{key}, "complete": true, "balance_cny": "250.00"}
	result := upstreamControllerCall(t, ConnectUpstreamBrowserAuthorization, http.MethodPost, "/", account.Id, map[string]any{"revision": account.Revision, "discovery": snapshot})
	require.Equal(t, true, result["success"], result["message"])
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.Equal(t, "250.00", account.BalanceCNY)
	assert.Positive(t, account.BalanceReadTime)
	var source model.UpstreamSource
	require.NoError(t, db.Where("account_id = ?", account.Id).First(&source).Error)
	assert.Equal(t, "78.76", source.KeyUsedCNY)
	assert.Positive(t, source.KeyUsageReadTime)
	require.NoError(t, db.Model(&source).Update("latest_time", 123).Error)
	lastBalanceRead := account.BalanceReadTime
	delete(snapshot, "balance_cny")
	snapshot["balance_issue"] = "not_found"
	key["used_cny"] = "80.00"
	result = upstreamControllerCall(t, ConnectUpstreamBrowserAuthorization, http.MethodPost, "/", account.Id, map[string]any{"revision": account.Revision, "discovery": snapshot})
	require.Equal(t, true, result["success"], result["message"])
	require.NoError(t, db.First(&account, account.Id).Error)
	require.NoError(t, db.First(&source, source.Id).Error)
	assert.Equal(t, "80.00", source.KeyUsedCNY)
	assert.Equal(t, int64(123), source.LatestTime)
	assert.Equal(t, "250.00", account.BalanceCNY)
	assert.Equal(t, lastBalanceRead, account.BalanceReadTime)
	assert.Equal(t, "not_found", account.BalanceIssue)
	beforeSnapshot, beforeKeyPage, beforeDiscoveryTime := account.BrowserDiscovery, account.KeyPageURL, account.DiscoveryTime
	wallet := map[string]any{"page_url": "https://site.example/wallet", "connector": map[string]any{"kind": "newapi"}, "identity": map[string]any{"id": 7}, "keys": []any{}, "complete": false, "money_only": true, "balance_cny": "0.00"}
	result = upstreamControllerCall(t, ConnectUpstreamBrowserAuthorization, http.MethodPost, "/", account.Id, map[string]any{"revision": account.Revision, "discovery": wallet})
	require.Equal(t, true, result["success"], result["message"])
	require.NoError(t, db.First(&account, account.Id).Error)
	require.NoError(t, db.First(&source, source.Id).Error)
	assert.Equal(t, "0.00", account.BalanceCNY)
	assert.Empty(t, account.BalanceIssue)
	assert.Equal(t, beforeSnapshot, account.BrowserDiscovery)
	assert.Equal(t, beforeKeyPage, account.KeyPageURL)
	assert.Equal(t, beforeDiscoveryTime, account.DiscoveryTime)
	assert.Equal(t, "80.00", source.KeyUsedCNY)
	assert.False(t, source.KeyMissing)
}

func TestUpstreamFundsRejectMalformedMoneyAndAnotherAccount(t *testing.T) {
	db := upstreamControllerDB(t)
	account := model.UpstreamAccount{Name: "site", Website: "https://site.example", RemoteUserId: 7, BalanceCNY: "12.00"}
	require.NoError(t, db.Create(&account).Error)
	for _, value := range []string{"NaN", "1a2", "1e9", "¥1", "1,000", "99999999999999999", "1.123456789"} {
		snapshot := map[string]any{"page_url": "https://site.example/wallet", "connector": map[string]any{"kind": "newapi"}, "identity": map[string]any{"id": 7}, "keys": []any{}, "money_only": true, "balance_cny": value}
		result := upstreamControllerCall(t, ConnectUpstreamBrowserAuthorization, http.MethodPost, "/", account.Id, map[string]any{"revision": account.Revision, "discovery": snapshot})
		assert.Equal(t, false, result["success"], value)
	}
	snapshot := map[string]any{"page_url": "https://site.example/wallet", "connector": map[string]any{"kind": "newapi"}, "identity": map[string]any{"id": 8}, "keys": []any{}, "money_only": true, "balance_cny": "99.00"}
	result := upstreamControllerCall(t, ConnectUpstreamBrowserAuthorization, http.MethodPost, "/", account.Id, map[string]any{"revision": account.Revision, "discovery": snapshot})
	assert.Equal(t, false, result["success"])
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.Equal(t, "12.00", account.BalanceCNY)
	assert.Zero(t, account.Revision)
}

func TestUpstreamBalancePageURLMustStayWithinWebsiteAndIsOptional(t *testing.T) {
	db := upstreamControllerDB(t)
	input := map[string]any{"name": "site", "key_page_url": "https://site.example/keys", "balance_page_url": "https://site.example/wallet", "markup": "1.1"}
	result := upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPost, "/", 0, input)
	require.Equal(t, true, result["success"], result["message"])
	var account model.UpstreamAccount
	require.NoError(t, db.First(&account).Error)
	assert.Equal(t, "https://site.example/wallet", account.BalancePageURL)
	input["revision"] = account.Revision
	input["balance_page_url"] = "https://other.example/wallet"
	result = upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPut, "/", account.Id, input)
	assert.Equal(t, false, result["success"])
	input["balance_page_url"] = ""
	result = upstreamControllerCall(t, SaveUpstreamAccount, http.MethodPut, "/", account.Id, input)
	require.Equal(t, true, result["success"], result["message"])
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.Empty(t, account.BalancePageURL)
	assert.Equal(t, "https://site.example/keys", account.KeyPageURL)
}

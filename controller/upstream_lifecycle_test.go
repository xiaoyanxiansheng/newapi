package controller

import (
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
)

func TestUpstreamLifecycleRequiresRevisionAndExplicitStateThenDeletesAllLocalBindings(t *testing.T) {
	db := upstreamControllerDB(t)
	require.NoError(t, db.AutoMigrate(&model.MarketStat{}))
	account := model.UpstreamAccount{Name: "fixture", Website: "https://fixture.example", Markup: "1.1"}
	require.NoError(t, db.Create(&account).Error)
	source := model.UpstreamSource{AccountId: account.Id, Name: "existing", Adapter: "account"}
	require.NoError(t, db.Create(&source).Error)
	for _, payload := range []any{nil, map[string]any{"disabled": true}, map[string]any{"revision": 0}} {
		result := upstreamControllerCall(t, ManageUpstreamAccountLifecycle, http.MethodPost, "/", account.Id, payload)
		assert.Equal(t, false, result["success"])
	}
	result := upstreamControllerCall(t, ManageUpstreamAccountLifecycle, http.MethodPost, "/", account.Id, map[string]any{"revision": 0, "disabled": true})
	require.Equal(t, true, result["success"], result["message"])
	detail := upstreamControllerCall(t, GetUpstreamAccount, http.MethodGet, "/", account.Id, nil)
	data := detail["data"].(map[string]any)
	assert.Equal(t, true, data["account"].(map[string]any)["disabled"])
	assert.Equal(t, true, data["keys"].([]any)[0].(map[string]any)["account_disabled"])
	result = upstreamControllerCall(t, ManageUpstreamAccountLifecycle, http.MethodPost, "/", account.Id, map[string]any{"revision": 0, "disabled": false})
	assert.Equal(t, false, result["success"])
	result = upstreamControllerCall(t, ManageUpstreamAccountLifecycle, http.MethodDelete, "/", account.Id, map[string]any{"revision": 1})
	require.Equal(t, true, result["success"], result["message"])
	var count int64
	require.NoError(t, db.Model(&model.UpstreamSource{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestUpstreamManualLifecycleRejectsAccountKeyDeletionAndDisablesDirectKey(t *testing.T) {
	db := upstreamControllerDB(t)
	accountKey := model.UpstreamSource{AccountId: 1, Adapter: "account"}
	require.NoError(t, db.Create(&accountKey).Error)
	result := upstreamControllerCall(t, ManageUpstreamManualChannelLifecycle, http.MethodDelete, "/", accountKey.Id, map[string]any{"revision": 0})
	assert.Equal(t, false, result["success"])
	manual := model.UpstreamSource{Adapter: "direct-key", RelayKey: "encrypted-fixture-key", KeyStatus: 1}
	require.NoError(t, db.Create(&manual).Error)
	result = upstreamControllerCall(t, ManageUpstreamManualChannelLifecycle, http.MethodPost, "/", manual.Id, map[string]any{"revision": 0, "disabled": true})
	require.Equal(t, true, result["success"], result["message"])
	require.NoError(t, db.First(&manual, manual.Id).Error)
	assert.True(t, manual.Disabled)
	result = upstreamControllerCall(t, ManageUpstreamManualChannelLifecycle, http.MethodDelete, "/", manual.Id, map[string]any{"revision": manual.Revision})
	require.Equal(t, true, result["success"], result["message"])
	assert.Error(t, db.First(&model.UpstreamSource{}, manual.Id).Error)
}

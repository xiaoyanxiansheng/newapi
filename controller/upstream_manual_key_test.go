package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
)

func TestUpstreamManualKeyEncryptsRetainsAndRotatesKeyWithoutChangingLiveRoute(t *testing.T) {
	db := upstreamControllerDB(t)
	t.Setenv("CRYPTO_SECRET", "persistent-test-secret-123")
	input := map[string]any{"base_url": "https://provider.example/v1/", "key": "opaque-existing-provider-key", "markup": "1.1"}
	response := upstreamControllerCall(t, SaveUpstreamManualKey, http.MethodPost, "/", 0, input)
	require.Equal(t, true, response["success"])
	var source model.UpstreamSource
	require.NoError(t, db.First(&source).Error)
	assert.Equal(t, "provider.example", source.Name)
	assert.Equal(t, "https://provider.example", source.BaseURL)
	assert.Equal(t, "direct-key", source.Adapter)
	assert.Zero(t, source.AccountId)
	assert.Zero(t, source.ChannelId)
	sealed := source.RelayKey
	assert.NotEqual(t, input["key"], sealed)
	plain, err := common.OpenUpstreamSecret(sealed)
	require.NoError(t, err)
	assert.Equal(t, input["key"], plain)
	for _, handler := range []gin.HandlerFunc{GetUpstreamManualKeys, GetUpstreamSource} {
		result := upstreamControllerCall(t, handler, http.MethodGet, "/", source.Id, nil)
		raw, err := common.Marshal(result)
		require.NoError(t, err)
		assert.NotContains(t, string(raw), plain)
		assert.NotContains(t, string(raw), sealed)
	}
	channel := model.Channel{Key: plain, Name: "existing route"}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, db.Model(&source).Updates(map[string]any{"latest_time": 1000, "channel_id": channel.Id}).Error)
	input["revision"] = 0
	input["key"] = ""
	input["markup"] = "1.2"
	require.Equal(t, true, upstreamControllerCall(t, SaveUpstreamManualKey, http.MethodPut, "/", source.Id, input)["success"])
	require.NoError(t, db.First(&source, source.Id).Error)
	assert.Equal(t, sealed, source.RelayKey)
	assert.Equal(t, int64(1000), source.LatestTime)
	input["revision"] = 1
	input["key"] = "new-opaque-provider-key"
	require.Equal(t, true, upstreamControllerCall(t, SaveUpstreamManualKey, http.MethodPut, "/", source.Id, input)["success"])
	require.NoError(t, db.First(&source, source.Id).Error)
	assert.Zero(t, source.LatestTime)
	require.NoError(t, db.First(&channel, channel.Id).Error)
	assert.Equal(t, plain, channel.Key)
	require.Equal(t, false, upstreamControllerCall(t, SaveUpstreamManualKey, http.MethodPut, "/", source.Id, input)["success"])
	input["revision"] = 2
	input["base_url"] = "https://another.example"
	require.Equal(t, false, upstreamControllerCall(t, SaveUpstreamManualKey, http.MethodPut, "/", source.Id, input)["success"])
}

func TestUpstreamManualPricesRequireActualModelsAndCompatibleCostsBeforePublishing(t *testing.T) {
	db := upstreamControllerDB(t)
	t.Setenv("CRYPTO_SECRET", "persistent-test-secret-123")
	oldRatio, oldCompletion := ratio_setting.ModelRatio2JSONString(), ratio_setting.CompletionRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(oldRatio))
		require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(oldCompletion))
	})
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"manual-fixture":10}`))
	require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"manual-fixture":4}`))
	sealed, err := common.SealUpstreamSecret("opaque-existing-provider-key")
	require.NoError(t, err)
	source := model.UpstreamSource{Name: "manual", Adapter: "direct-key", BaseURL: "https://provider.example", RelayKey: sealed, KeyStatus: 1, Markup: "1.1"}
	require.NoError(t, db.Create(&source).Error)
	require.NoError(t, model.SaveUpstreamSnapshot(source.Id, 0, []model.UpstreamQuote{{Model: "manual-fixture", PriceIssue: "unconfirmed"}}))
	request := map[string]any{"revision": 1, "model": "manual-fixture", "cost": map[string]string{"input": "2", "output": "9"}}
	require.Equal(t, false, upstreamControllerCall(t, SaveUpstreamManualPrice, http.MethodPost, "/", source.Id, request)["success"])
	request["cost"] = map[string]string{"input": "2", "output": "8"}
	request["model"] = "not-permitted"
	require.Equal(t, false, upstreamControllerCall(t, SaveUpstreamManualPrice, http.MethodPost, "/", source.Id, request)["success"])
	request["model"] = "manual-fixture"
	require.Equal(t, true, upstreamControllerCall(t, SaveUpstreamManualPrice, http.MethodPost, "/", source.Id, request)["success"])
	require.Equal(t, false, upstreamControllerCall(t, SaveUpstreamManualPrice, http.MethodPost, "/", source.Id, request)["success"])
	var channelCount int64
	require.NoError(t, db.Model(&model.Channel{}).Count(&channelCount).Error)
	assert.Zero(t, channelCount)
	selection := upstreamSelectionInput{Revision: 2, Models: map[string]string{"manual-fixture": ""}}
	preview := upstreamControllerCall(t, PreviewUpstreamModels, http.MethodPost, "/", source.Id, selection)
	require.Equal(t, true, preview["success"])
	data := preview["data"].(map[string]any)
	proposal := data["proposals"].([]any)[0].(map[string]any)
	assert.Equal(t, "2.2", proposal["sale"].(map[string]any)["input"])
	selection.Fingerprint = data["fingerprint"].(string)
	require.Equal(t, true, upstreamControllerCall(t, ApplyUpstreamModels, http.MethodPost, "/", source.Id, selection)["success"])
	var channel model.Channel
	require.NoError(t, db.First(&channel).Error)
	assert.Equal(t, "opaque-existing-provider-key", channel.Key)
	var listing model.MarketListing
	require.NoError(t, db.First(&listing).Error)
	assert.Equal(t, float64(1), listing.Ratio)
	state := map[string]any{"revision": 3, "model": "manual-fixture", "enabled": false}
	require.Equal(t, true, upstreamControllerCall(t, SetUpstreamListingState, http.MethodPost, "/", source.Id, state)["success"])
	require.NoError(t, db.First(&listing, listing.Id).Error)
	assert.False(t, listing.Enabled)
	assert.Equal(t, float64(1), listing.Ratio)
}

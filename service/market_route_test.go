package service

import (
	"fmt"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupMarketRouteTest(t *testing.T) *gorm.DB {
	t.Helper()

	originalDB := model.DB
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	originalRatios := ratio_setting.ModelRatio2JSONString()

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.MarketListing{}, &model.UpstreamAccount{}, &model.UpstreamSource{}))
	model.DB = db
	common.MemoryCacheEnabled = false
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"route-model":1}`))
	model.InvalidateMarketListings()

	t.Cleanup(func() {
		model.DB = originalDB
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(originalRatios))
		model.InvalidateMarketListings()
		sqlDB, err := db.DB()
		if err == nil {
			require.NoError(t, sqlDB.Close())
		}
	})
	return db
}

func createRouteChannel(t *testing.T, db *gorm.DB, id int, status int, models string) {
	t.Helper()
	require.NoError(t, db.Create(&model.Channel{
		Id:     id,
		Type:   constant.ChannelTypeOpenAI,
		Key:    fmt.Sprintf("key-%d", id),
		Status: status,
		Name:   fmt.Sprintf("channel-%d", id),
		Models: models,
		Group:  "default",
	}).Error)
}

func createListing(t *testing.T, db *gorm.DB, channelId int, modelName string, ratio float64, enabled bool) {
	t.Helper()
	require.NoError(t, db.Create(&model.MarketListing{ChannelId: channelId, ModelName: modelName, Ratio: ratio, Enabled: enabled}).Error)
	model.InvalidateMarketListings()
}

func TestRouteRejectsInvalidUpstreamParentEvenWithWarmChannelCache(t *testing.T) {
	for _, reason := range []string{"key-missing", "key-disabled", "key-expired", "key-issue", "source-disabled", "account-disabled", "account-deleted", "model-revoked", "channel-deleted"} {
		t.Run(reason, func(t *testing.T) {
			db := setupMarketRouteTest(t)
			createRouteChannel(t, db, 1, common.ChannelStatusEnabled, "route-model")
			require.NoError(t, (&model.Channel{Id: 1, Models: "route-model", Group: "default", Status: common.ChannelStatusEnabled}).AddAbilities(db))
			createListing(t, db, 1, "route-model", 1, true)
			account := model.UpstreamAccount{Name: "guard", Website: "https://guard.example"}
			require.NoError(t, db.Create(&account).Error)
			source := model.UpstreamSource{AccountId: account.Id, ChannelId: 1, KeyStatus: 1, AllowedModelsJSON: "null"}
			require.NoError(t, db.Create(&source).Error)
			common.MemoryCacheEnabled = true
			model.InitChannelCache()
			listing := model.GetMarketListing(1, "route-model")
			_, ok := SellableListing(listing)
			require.True(t, ok)
			switch reason {
			case "key-missing":
				require.NoError(t, db.Model(&source).Update("key_missing", true).Error)
			case "key-disabled":
				require.NoError(t, db.Model(&source).Update("key_status", 2).Error)
			case "key-expired":
				require.NoError(t, db.Model(&source).Update("key_expires_at", common.GetTimestamp()-1).Error)
			case "key-issue":
				require.NoError(t, db.Model(&source).Update("key_issue", "revoked").Error)
			case "source-disabled":
				require.NoError(t, db.Model(&source).Update("disabled", true).Error)
			case "account-disabled":
				require.NoError(t, db.Model(&account).Update("disabled", true).Error)
			case "account-deleted":
				require.NoError(t, db.Delete(&account).Error)
			case "model-revoked":
				require.NoError(t, db.Model(&source).Update("allowed_models_json", "[\"other-model\"]").Error)
			case "channel-deleted":
				require.NoError(t, db.Delete(&model.Channel{}, 1).Error)
			}
			_, ok = SellableListing(listing)
			assert.False(t, ok)
			_, err := RouteCandidates(newRouteContext(map[string][]int{"route-model": {1}}, true), "route-model")
			assert.ErrorIs(t, err, ErrRouteUnavailable)
			assert.Empty(t, model.LiveTokenRoutes([]model.TokenRoute{{Model: "route-model", Channels: []int{1}, ListingIDs: []int{listing.Id}}}))
		})
	}
}

func TestPausedMarketListingCanBeMonitoredWithoutBecomingSellable(t *testing.T) {
	db := setupMarketRouteTest(t)
	createRouteChannel(t, db, 1, common.ChannelStatusEnabled, "route-model")
	paused := &model.MarketListing{ChannelId: 1, ModelName: "route-model", Ratio: 0.25, Enabled: false}
	_, monitorable := MonitorableListing(paused)
	require.True(t, monitorable)
	assert.False(t, paused.Enabled)
	_, sellable := SellableListing(paused)
	assert.False(t, sellable)
	_, monitorable = MonitorableListing(nil)
	assert.False(t, monitorable)
	paused.ModelName = "unlisted-model"
	_, monitorable = MonitorableListing(paused)
	assert.False(t, monitorable)
}

func newRouteContext(routes map[string][]int, autoRoute bool) *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(c, constant.ContextKeyTokenRoutes, routes)
	common.SetContextKey(c, constant.ContextKeyTokenAutoRoute, autoRoute)
	return c
}

func TestRouteCandidatesFollowUserOrderAndSkipUnsellable(t *testing.T) {
	db := setupMarketRouteTest(t)
	createRouteChannel(t, db, 1, common.ChannelStatusEnabled, "route-model")
	createRouteChannel(t, db, 2, common.ChannelStatusEnabled, "route-model")
	createRouteChannel(t, db, 3, common.ChannelStatusManuallyDisabled, "route-model")
	createRouteChannel(t, db, 4, common.ChannelStatusEnabled, "route-model")
	createListing(t, db, 1, "route-model", 0.5, true)
	createListing(t, db, 2, "route-model", 0.2, true)
	createListing(t, db, 3, "route-model", 0.1, true)
	createListing(t, db, 4, "route-model", 0, true)

	c := newRouteContext(map[string][]int{"route-model": {2, 3, 4, 1}}, true)
	cands, err := RouteCandidates(c, "route-model")
	require.NoError(t, err)
	ids := make([]int, 0, len(cands))
	for _, cand := range cands {
		ids = append(ids, cand.Channel.Id)
	}
	assert.Equal(t, []int{2, 1}, ids, "disabled channel and zero ratio listing must be skipped, user order kept")
}

func TestRouteAutoRouteOffOnlyUsesPrimary(t *testing.T) {
	db := setupMarketRouteTest(t)
	createRouteChannel(t, db, 1, common.ChannelStatusEnabled, "route-model")
	createRouteChannel(t, db, 2, common.ChannelStatusEnabled, "route-model")
	createListing(t, db, 1, "route-model", 0.5, true)
	createListing(t, db, 2, "route-model", 0.2, true)

	c := newRouteContext(map[string][]int{"route-model": {1, 2}}, false)
	_, err := PrepareRoute(c, "route-model")
	require.NoError(t, err)
	assert.Equal(t, 0, GetRetryLimit(c))

	ch, err := SelectRouteChannel(c, "route-model")
	require.NoError(t, err)
	assert.Equal(t, 1, ch.Id)

	c.Set("use_channel", []string{"1"})
	_, err = SelectRouteChannel(c, "route-model")
	assert.Error(t, err, "primary failure must not fall back when auto route is off")
}

func TestRouteAutoRouteOffFailsWhenPrimaryUnavailable(t *testing.T) {
	db := setupMarketRouteTest(t)
	createRouteChannel(t, db, 1, common.ChannelStatusManuallyDisabled, "route-model")
	createRouteChannel(t, db, 2, common.ChannelStatusEnabled, "route-model")
	createListing(t, db, 1, "route-model", 0.5, true)
	createListing(t, db, 2, "route-model", 0.2, true)

	c := newRouteContext(map[string][]int{"route-model": {1, 2}}, false)
	_, err := PrepareRoute(c, "route-model")
	assert.ErrorIs(t, err, ErrRouteUnavailable)
}

func TestRouteAutoRouteWalksChannelsInOrderAndBillsActualRatio(t *testing.T) {
	db := setupMarketRouteTest(t)
	createRouteChannel(t, db, 1, common.ChannelStatusEnabled, "route-model")
	createRouteChannel(t, db, 2, common.ChannelStatusEnabled, "route-model")
	createRouteChannel(t, db, 3, common.ChannelStatusEnabled, "route-model")
	createListing(t, db, 1, "route-model", 0.2, true)
	createListing(t, db, 2, "route-model", 0.9, true)
	createListing(t, db, 3, "route-model", 0.5, true)

	c := newRouteContext(map[string][]int{"route-model": {1, 2, 3}}, true)
	_, err := PrepareRoute(c, "route-model")
	require.NoError(t, err)
	assert.Equal(t, 2, GetRetryLimit(c))

	restore := UseRoutePreConsumeRatio(c)
	pre, ok := GetRouteRatio(c)
	require.True(t, ok)
	assert.Equal(t, 0.9, pre, "pre-consume must use the most expensive candidate")
	restore()
	actual, _ := GetRouteRatio(c)
	assert.Equal(t, 0.2, actual)

	var used []string
	wantRatios := []float64{0.2, 0.9, 0.5}
	for i, wantId := range []int{1, 2, 3} {
		ch, err := SelectRouteChannel(c, "route-model")
		require.NoError(t, err)
		assert.Equal(t, wantId, ch.Id)
		ratio, _ := GetRouteRatio(c)
		assert.Equal(t, wantRatios[i], ratio)
		used = append(used, strconv.Itoa(ch.Id))
		c.Set("use_channel", used)
	}
	_, err = SelectRouteChannel(c, "route-model")
	assert.Error(t, err)
}

func TestRouteRejectsModelOutsideKeyRoutes(t *testing.T) {
	db := setupMarketRouteTest(t)
	createRouteChannel(t, db, 1, common.ChannelStatusEnabled, "route-model")
	createListing(t, db, 1, "route-model", 0.2, true)

	_, err := RouteCandidates(newRouteContext(map[string][]int{}, true), "route-model")
	assert.ErrorIs(t, err, ErrRouteNone)

	_, err = RouteCandidates(newRouteContext(map[string][]int{"other": {1}}, true), "route-model")
	assert.ErrorIs(t, err, ErrRouteModelAbsent)
}

func TestSellableListingRequiresPriceEnabledAndBaseConfig(t *testing.T) {
	db := setupMarketRouteTest(t)
	createRouteChannel(t, db, 1, common.ChannelStatusEnabled, "route-model,unpriced-model")
	createListing(t, db, 1, "route-model", 0.2, false)
	createListing(t, db, 1, "unpriced-model", 0.2, true)

	_, ok := SellableListing(model.GetMarketListing(1, "route-model"))
	assert.False(t, ok, "disabled listing is not sellable")
	_, ok = SellableListing(model.GetMarketListing(1, "unpriced-model"))
	assert.False(t, ok, "model without base price is not sellable")
}

func TestRouteModelWithoutChannelsHasNoAvailableChannel(t *testing.T) {
	db := setupMarketRouteTest(t)
	createRouteChannel(t, db, 1, common.ChannelStatusEnabled, "route-model")
	createListing(t, db, 1, "route-model", 0.5, true)

	c := newRouteContext(map[string][]int{"route-model": {}, "other-model": {1}}, true)
	_, err := RouteCandidates(c, "route-model")
	assert.ErrorIs(t, err, ErrRouteUnavailable, "a model added without channels must fail as unavailable")
	_, err = RouteCandidates(c, "unknown-model")
	assert.ErrorIs(t, err, ErrRouteModelAbsent)
}

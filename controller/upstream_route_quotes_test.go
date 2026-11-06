package controller

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAdminRouteQuoteEndpointIsReadOnlyAndProtectsCredentials(t *testing.T) {
	redisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = redisEnabled })
	db := upstreamControllerDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	t.Setenv("CRYPTO_SECRET", "controller-route-test-secret-1234")
	snapshot := service.UpstreamBrowserDiscovery{
		Keys:    []service.UpstreamDiscoveredKey{{ID: 567, Key: "sk-do-not-expose-this-key", Models: []string{"example"}, JoinedRoutes: []service.UpstreamJoinedRoute{{ListingID: 287, Model: "example", Alias: "example@s1c13"}}}},
		Pricing: []byte(`{"success":true,"data":[{"model_name":"example@s1c13","quota_type":0,"model_ratio":0.5,"completion_ratio":2}]}`),
		Status:  []byte(`{"data":{"quota_per_unit":500000,"usd_exchange_rate":6.8896,"quota_display_type":"USD"}}`),
	}
	encoded, err := common.Marshal(snapshot)
	require.NoError(t, err)
	sealed, err := common.SealUpstreamSecret(string(encoded))
	require.NoError(t, err)
	account := model.UpstreamAccount{Name: "fixture", Website: "https://127.0.0.1", DiscoveryMode: "newapi", DiscoveryTime: 100, BrowserDiscovery: model.UpstreamDiscoveryStorage(sealed), Revision: 7, LastError: "preserve-account-state"}
	require.NoError(t, db.Create(&account).Error)
	source := model.UpstreamSource{Name: "existing Key", AccountId: account.Id, RemoteKeyId: 567, RelayKey: "private-relay-key", Revision: 8, LatestTime: 99, LatestJSON: `[{"model":"example","price_issue":"preserve-catalog"}]`}
	require.NoError(t, db.Create(&source).Error)
	listing := model.MarketListing{ChannelId: 1, ModelName: "example", Ratio: 0.5, Enabled: true}
	require.NoError(t, db.Create(&listing).Error)
	adminToken, userToken := "admin-read-route-quotes-token", "user-read-route-quotes-token"
	require.NoError(t, db.Create(&model.User{Username: "quote-admin", AffCode: "quotea", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AccessToken: &adminToken}).Error)
	require.NoError(t, db.Create(&model.User{Username: "quote-user", AffCode: "quoteb", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AccessToken: &userToken}).Error)
	router := gin.New()
	router.GET("/upstreams/:id/route-quotes", middleware.AdminAuth(), GetUpstreamRouteQuotes)
	for _, tc := range []struct {
		token  string
		status int
	}{{"", http.StatusUnauthorized}, {userToken, http.StatusForbidden}, {adminToken, http.StatusOK}} {
		req := httptest.NewRequest(http.MethodGet, "/upstreams/"+strconv.Itoa(source.Id)+"/route-quotes", nil)
		if tc.token != "" {
			req.Header.Set("Authorization", "Bearer "+tc.token)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		assert.Equal(t, tc.status, w.Code)
		assert.NotContains(t, w.Body.String(), "sk-do-not-expose")
		assert.NotContains(t, w.Body.String(), "private-relay-key")
		assert.NotContains(t, w.Body.String(), "sealed:v1")
		if tc.status == http.StatusOK {
			var response struct {
				Success bool                        `json:"success"`
				Data    service.UpstreamRouteQuotes `json:"data"`
			}
			require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
			require.True(t, response.Success)
			assert.True(t, response.Data.ReadOnly)
			assert.Equal(t, 1, response.Data.RouteCount)
			assert.Equal(t, "CNY", response.Data.Currency)
			assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		}
	}
	var afterAccount model.UpstreamAccount
	var afterSource model.UpstreamSource
	var afterListing model.MarketListing
	require.NoError(t, db.First(&afterAccount, account.Id).Error)
	require.NoError(t, db.First(&afterSource, source.Id).Error)
	require.NoError(t, db.First(&afterListing, listing.Id).Error)
	assert.Equal(t, account, afterAccount)
	assert.Equal(t, source, afterSource)
	assert.Equal(t, listing, afterListing)
}

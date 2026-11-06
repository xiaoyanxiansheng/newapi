package middleware

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestDistributorSpecificChannelCannotBypassRevokedUpstreamKey(t *testing.T) {
	require.NoError(t, i18n.Init())
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.UpstreamAccount{}, &model.UpstreamSource{}))
	previous := model.DB
	model.DB = db
	t.Cleanup(func() {
		model.DB = previous
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	account := model.UpstreamAccount{Name: "revoked-parent"}
	require.NoError(t, db.Create(&account).Error)
	channel := model.Channel{Type: 1, Models: "example", Status: common.ChannelStatusEnabled}
	require.NoError(t, db.Create(&channel).Error)
	source := model.UpstreamSource{AccountId: account.Id, ChannelId: channel.Id, KeyStatus: 1, KeyMissing: true}
	require.NoError(t, db.Create(&source).Error)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader("{\"model\":\"example\"}"))
	c.Request.Header.Set("Content-Type", "application/json")
	common.SetContextKey(c, constant.ContextKeyTokenSpecificChannelId, strconv.Itoa(channel.Id))
	Distribute()(c)
	assert.Equal(t, http.StatusForbidden, w.Code)
	assert.True(t, c.IsAborted())
}

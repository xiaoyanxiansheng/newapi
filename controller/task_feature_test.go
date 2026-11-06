package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserTaskDisabledReturnsForbiddenBeforeReadingHistory(t *testing.T) {
	previous := common.TaskEnabled
	common.TaskEnabled = false
	t.Cleanup(func() { common.TaskEnabled = previous })
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/task/self", nil)
	GetUserTask(context)
	require.Equal(t, http.StatusForbidden, response.Code)
	assert.JSONEq(t, "{\"success\":false,\"message\":\"Task logs are disabled by the administrator.\"}", response.Body.String())
}

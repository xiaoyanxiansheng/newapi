package helper

import (
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func TestSupplierListingModelMapsToItsExactUpstreamAlias(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{OriginModelName: "claude-opus-5-5", ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "claude-opus-5-5"}}
	request := &dto.GeneralOpenAIRequest{Model: "claude-opus-5-5"}
	for _, alias := range []string{"claude-opus-5-5@s1c13", "claude-opus-5-5@s46c260"} {
		c.Set("market_access_model", alias)
		c.Set("model_mapping", `{"claude-opus-5-5":"wrong-default-route"}`)
		require.NoError(t, ModelMappedHelper(c, info, request))
		assert.Equal(t, alias, request.Model)
		assert.Equal(t, "claude-opus-5-5", info.OriginModelName)
	}
}

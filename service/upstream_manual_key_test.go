package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUpstreamManualKeyReadsOnlyActualModelsWithoutInventingPrices(t *testing.T) {
	t.Setenv("CRYPTO_SECRET", "persistent-test-secret-123")
	sealed, err := common.SealUpstreamSecret("opaque-existing-provider-key")
	require.NoError(t, err)
	body := `{"data":[{"id":"a"},{"id":"b"}]}`
	status := http.StatusOK
	site := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodGet, r.Method)
		assert.Equal(t, "/custom/v1/models", r.URL.Path)
		assert.Equal(t, "Bearer opaque-existing-provider-key", r.Header.Get("Authorization"))
		assert.Empty(t, r.Header.Get("New-Api-User"))
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	defer site.Close()
	source := model.UpstreamSource{Adapter: "direct-key", BaseURL: site.URL + "/custom/v1", RelayKey: sealed}
	quotes, err := fetchUpstreamManualKeyModels(source, site.Client())
	require.NoError(t, err)
	require.Len(t, quotes, 2)
	assert.Equal(t, "a", quotes[0].Model)
	assert.Empty(t, quotes[0].Cost)
	assert.Empty(t, quotes[0].UpstreamRatio)
	assert.NotEmpty(t, quotes[0].PriceIssue)
	body = `{"data":[{"id":"a"},{"id":"a"}]}`
	_, err = fetchUpstreamManualKeyModels(source, site.Client())
	require.ErrorContains(t, err, "duplicate")
	body = `{"data":[]}`
	quotes, err = fetchUpstreamManualKeyModels(source, site.Client())
	require.NoError(t, err)
	assert.Empty(t, quotes)
	body = "<html>sign in</html>"
	_, err = fetchUpstreamManualKeyModels(source, site.Client())
	require.ErrorContains(t, err, "could not be verified")
	status = http.StatusUnauthorized
	_, err = fetchUpstreamManualKeyModels(source, site.Client())
	require.ErrorContains(t, err, "401")
}

func TestUpstreamManualKeyNormalizesAPIAddressesAndRejectsCredentialLeakPaths(t *testing.T) {
	for _, raw := range []string{"https://provider.example", "https://provider.example/v1/"} {
		result, err := NormalizeUpstreamKeyURL(raw)
		require.NoError(t, err)
		assert.Equal(t, "https://provider.example", result)
	}
	for _, raw := range []string{"http://provider.example", "https://owner:password@provider.example", "https://provider.example?key=secret", "https://provider.example#key"} {
		_, err := NormalizeUpstreamKeyURL(raw)
		require.Error(t, err)
	}
}

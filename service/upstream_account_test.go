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

func TestUpstreamExistingKeyPaginationRejectsPartialOrChangedLists(t *testing.T) {
	for _, tc := range []struct {
		name   string
		second string
		valid  bool
	}{
		{"complete", `{"success":true,"data":{"items":[{"id":2,"name":"second","key":"secret-second-key","group":"vip","status":1}],"total":2}}`, true},
		{"incomplete", `{"success":true,"data":{"items":[],"total":2}}`, false},
		{"duplicate", `{"success":true,"data":{"items":[{"id":1}],"total":2}}`, false},
		{"total changed", `{"success":true,"data":{"items":[{"id":2}],"total":3}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodGet, r.Method)
				assert.Equal(t, "/api/token/", r.URL.Path)
				assert.Equal(t, "Bearer account-session", r.Header.Get("Authorization"))
				assert.Equal(t, "17", r.Header.Get("New-Api-User"))
				if r.URL.Query().Get("p") == "1" {
					w.Write([]byte(`{"success":true,"data":{"items":[{"id":1,"name":"first","key":"secret-first-key","group":"vip","status":1,"model_limits_enabled":true,"model_limits":"a,b"}],"total":2}}`))
				} else {
					w.Write([]byte(tc.second))
				}
			}))
			defer site.Close()
			session := upstreamAccountSession{client: site.Client(), origin: site.URL, accessToken: "account-session", userId: 17}
			keys, err := session.existingKeys()
			if !tc.valid {
				require.Error(t, err)
				assert.Nil(t, keys)
				return
			}
			require.NoError(t, err)
			require.Len(t, keys, 2)
			assert.NotContains(t, keys[0].Masked, "secret-first-key")
			assert.Equal(t, `["a","b"]`, keys[0].ModelsJSON)
			assert.Equal(t, "null", keys[1].ModelsJSON)
		})
	}
}

func TestUpstreamKeyReadsActualModelsAndFixedGroupPricesWithoutMutatingKeys(t *testing.T) {
	t.Setenv("CRYPTO_SECRET", "persistent-test-secret-123")
	paths := []string{}
	statusBody := []byte(`{"success":true,"data":{"quota_display_type":"CNY","usd_exchange_rate":1,"quota_per_unit":500000}}`)
	keyBody := []byte(`{"success":true,"data":"existing-key-value"}`)
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.URL.Path {
		case "/api/token/":
			w.Write([]byte(`{"success":true,"data":{"items":[{"id":33,"name":"mine","key":"abcd****wxyz","group":"vip","status":1,"model_limits_enabled":true,"model_limits":"example,unknown"}],"total":1}}`))
		case "/api/token/33/key":
			assert.Equal(t, http.MethodPost, r.Method)
			w.Write(keyBody)
		case "/v1/models":
			assert.Equal(t, "Bearer sk-existing-key-value", r.Header.Get("Authorization"))
			assert.Empty(t, r.Header.Get("New-Api-User"))
			w.Write([]byte(`{"data":[{"id":"example"},{"id":"unknown"},{"id":"not-permitted"}]}`))
		case "/api/pricing":
			w.Write([]byte(`{"success":true,"data":[{"model_name":"example","quota_type":0,"model_ratio":10,"completion_ratio":4,"cache_ratio":0.1,"create_cache_ratio":1.25,"enable_groups":["vip"]},{"model_name":"catalog-only","quota_type":0,"model_ratio":1,"completion_ratio":1,"enable_groups":["vip"]}],"group_ratio":{"vip":0.1,"cheapest":0.01}}`))
		case "/api/status":
			w.Write(statusBody)
		default:
			t.Errorf("unexpected upstream operation: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer site.Close()
	session := upstreamAccountSession{client: site.Client(), origin: site.URL, accessToken: "dashboard-session", userId: 17}
	source := model.UpstreamSource{RemoteKeyId: 33, PriceGroup: "vip", AllowedModelsJSON: `["example","unknown"]`}
	quotes, sealed, err := session.keyModels(source)
	require.NoError(t, err)
	require.Len(t, quotes, 2)
	q := quotes[0]
	assert.Equal(t, "example", q.Model)
	assert.Equal(t, "0.1", q.UpstreamRatio)
	assert.Equal(t, "CNY", q.DisplayCurrency)
	assert.Equal(t, "20", q.Original.Input)
	assert.Equal(t, "2", q.Cost.Input)
	assert.Equal(t, "8", q.Cost.Output)
	assert.Equal(t, "0.2", q.Cost.CacheRead)
	assert.Equal(t, "2.5", q.Cost.CacheWrite)
	_, sale, err := model.DeriveUpstreamListingRatio(q.Original, q, "1.1")
	require.NoError(t, err)
	assert.Equal(t, "2.2", sale.Input)
	assert.Equal(t, "8.8", sale.Output)
	assert.NotEmpty(t, quotes[1].PriceIssue)
	key, err := common.OpenUpstreamSecret(sealed)
	require.NoError(t, err)
	assert.Equal(t, "sk-existing-key-value", key)
	assert.Equal(t, []string{"GET /api/token/", "POST /api/token/33/key", "GET /v1/models", "GET /api/pricing", "GET /api/status"}, paths)
	keyBody = []byte(`{"success":true,"data":{"key":"sk-existing-key-value"}}`)
	_, sealed, err = session.keyModels(source)
	require.NoError(t, err, "xxapi's full-Key object response must be accepted without creating Keys")
	key, err = common.OpenUpstreamSecret(sealed)
	require.NoError(t, err)
	assert.Equal(t, "sk-existing-key-value", key)
	statusBody = []byte(`{"success":true,"data":{"quota_display_type":"CNY","usd_exchange_rate":7,"quota_per_unit":500000}}`)
	_, _, err = session.keyModels(source)
	require.ErrorContains(t, err, "billing settings")
	source.PriceGroup = "cheapest"
	_, _, err = session.keyModels(source)
	require.ErrorContains(t, err, "changed")
}

func TestUpstreamReaderRejectsKeyMutationsAndUnverifiedWebsites(t *testing.T) {
	session := upstreamAccountSession{}
	for _, op := range []struct{ method, path string }{{"POST", "/api/token/"}, {"PUT", "/api/token/33"}, {"DELETE", "/api/token/33"}, {"POST", "/api/token/33/create/key"}, {"POST", "/api/token/0/key"}} {
		_, err := session.read(op.method, op.path, "", nil)
		require.ErrorContains(t, err, "outside")
	}
	_, err := loginUpstreamAccount(model.UpstreamAccount{Website: "https://unknown.example", AuthType: "browser"})
	require.ErrorContains(t, err, "sign-in")
	assert.NotEmpty(t, UpstreamAccountWorkflow("https://www.cctq.ai"))
}

func TestUpstreamAccountRecognizesVerifiedXXAPIAndRejectsLookalikeOrigins(t *testing.T) {
	assert.Equal(t, "xxapi-existing-keys-v1", UpstreamAccountWorkflow("https://xxapi.info"))
	assert.Empty(t, UpstreamAccountWorkflow("http://xxapi.info"))
	for _, origin := range []string{"https://4router.net", "https://xxapi.info:9443", "https://unknown.example"} {
		assert.Equal(t, "browser-auto-v1", UpstreamAccountWorkflow(origin))
	}
}

func TestUpstreamBrowserAuthorizationVerifiesIdentityWithoutUsingPasswordLogin(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    int
		id        int
		wantError string
	}{
		{"verified", 200, 17, ""}, {"different identity", 200, 18, "identity"}, {"expired", 401, 0, "expired"}, {"upstream outage", 500, 0, "HTTP 500"}, {"unclassified access rejection", 403, 0, "HTTP 403"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodGet, r.Method)
				assert.Equal(t, "/api/user/self", r.URL.Path)
				assert.Equal(t, "Bearer upstream-session", r.Header.Get("Authorization"))
				assert.Equal(t, "17", r.Header.Get("New-Api-User"))
				w.WriteHeader(tc.status)
				raw, err := common.Marshal(map[string]any{"success": true, "data": map[string]any{"id": tc.id, "username": "owner"}})
				require.NoError(t, err)
				_, err = w.Write(raw)
				require.NoError(t, err)
			}))
			defer site.Close()
			session := upstreamAccountSession{client: site.Client(), origin: site.URL, accessToken: "upstream-session", userId: 17}
			identity, err := session.verifyBrowserIdentity()
			if tc.wantError != "" {
				require.ErrorContains(t, err, tc.wantError)
				assert.Zero(t, identity.ID)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, 17, identity.ID)
		})
	}
	_, err := loginUpstreamAccount(model.UpstreamAccount{Website: "https://www.cctq.ai", AuthType: "browser"})
	require.ErrorContains(t, err, "connect its browser authorization")
}

func TestUpstreamLoginConflictSuggestsBrowserConnectionWithoutRepeatingLogin(t *testing.T) {
	requests := 0
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusConflict)
		w.Write([]byte(`{"success":false,"message":"Conflict"}`))
	}))
	defer site.Close()
	session := upstreamAccountSession{client: site.Client(), origin: site.URL}
	_, err := session.read(http.MethodPost, "/api/user/login", "", nil)
	require.ErrorContains(t, err, "HTTP 409")
	assert.Contains(t, err.Error(), "browser authorization")
	assert.Equal(t, 1, requests)
}

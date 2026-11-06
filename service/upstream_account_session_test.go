package service

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpstreamPasswordKeyRefreshesShareLoginAndCredentialChangesInvalidateIt(t *testing.T) {
	cache := upstreamPasswordSessionCache{entries: make(map[int]*upstreamPasswordSessionEntry)}
	account := model.UpstreamAccount{Id: 1, Website: "https://xxapi.info", Username: "owner", Password: "sealed-password"}
	var logins atomic.Int32
	login := func(model.UpstreamAccount) (*upstreamAccountSession, error) {
		logins.Add(1)
		return &upstreamAccountSession{client: &http.Client{}, userId: 17}, nil
	}
	var reads sync.WaitGroup
	for i := 0; i < 5; i++ {
		reads.Add(1)
		go func() {
			defer reads.Done()
			session, err := cache.get(account, login)
			assert.NoError(t, err)
			if assert.NotNil(t, session) {
				assert.Equal(t, 17, session.userId)
			}
		}()
	}
	reads.Wait()
	assert.EqualValues(t, 1, logins.Load())
	account.Password = "new-sealed-password"
	_, err := cache.get(account, login)
	require.NoError(t, err)
	assert.EqualValues(t, 2, logins.Load())
}

func TestUpstreamRejectedLoginDoesNotRepeatForEveryKey(t *testing.T) {
	cache := upstreamPasswordSessionCache{entries: make(map[int]*upstreamPasswordSessionEntry)}
	logins := 0
	login := func(model.UpstreamAccount) (*upstreamAccountSession, error) {
		logins++
		return nil, errors.New("upstream login returned HTTP 409")
	}
	account := model.UpstreamAccount{Id: 1, Website: "https://xxapi.info", Password: "sealed"}
	for i := 0; i < 5; i++ {
		session, err := cache.get(account, login)
		require.ErrorContains(t, err, "409")
		assert.Nil(t, session)
	}
	assert.Equal(t, 1, logins)
}

func TestUpstreamExpiringPasswordSessionRenewsWithoutAnotherLogin(t *testing.T) {
	refreshes := 0
	status := http.StatusOK
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		refreshes++
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/api/user/auth/refresh", r.URL.Path)
		assert.Equal(t, "http://"+r.Host, r.Header.Get("Origin"))
		w.WriteHeader(status)
		w.Write([]byte(`{"success":true,"data":{"access_token":"renewed","user":{"id":17}}}`))
	}))
	defer site.Close()
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	client := site.Client()
	client.Jar = jar
	account := model.UpstreamAccount{Id: 1, Website: site.URL, Password: "sealed"}
	cache := upstreamPasswordSessionCache{entries: make(map[int]*upstreamPasswordSessionEntry)}
	logins := 0
	login := func(model.UpstreamAccount) (*upstreamAccountSession, error) {
		logins++
		return &upstreamAccountSession{client: client, origin: site.URL, accessToken: "expiring", userId: 17}, nil
	}
	_, err = cache.get(account, login)
	require.NoError(t, err)
	cache.entries[1].expires = time.Now().Add(-time.Second)
	session, err := cache.get(account, login)
	require.NoError(t, err)
	assert.Equal(t, "renewed", session.accessToken)
	assert.Equal(t, 1, logins)
	assert.Equal(t, 1, refreshes)
	status = http.StatusUnauthorized
	cache.entries[1].expires = time.Now().Add(-time.Second)
	for i := 0; i < 5; i++ {
		session, err = cache.get(account, login)
		require.ErrorContains(t, err, "HTTP 401")
		assert.Nil(t, session)
	}
	assert.Equal(t, 1, logins, "Rejected renewal must not create another upstream login session")
	assert.Equal(t, 2, refreshes, "Only one renewal attempt should be made across concurrent Key reads")
}

func TestSavedBrowserAuthorizationReportsExpiredTokensAsDisconnected(t *testing.T) {
	t.Setenv("CRYPTO_SECRET", "persistent-test-secret-123")
	for _, tc := range []struct {
		name      string
		expiry    int64
		connected bool
	}{
		{"expired", time.Now().Add(-time.Minute).Unix(), false},
		{"valid", time.Now().Add(time.Minute).Unix(), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			token := "header." + base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"exp":%d}`, tc.expiry))) + ".signature"
			sealed, err := common.SealUpstreamSecret(token)
			require.NoError(t, err)
			assert.Equal(t, tc.connected, HasUpstreamBrowserAuthorization(model.UpstreamAccount{BrowserSession: sealed, RemoteUserId: 17}))
		})
	}
}

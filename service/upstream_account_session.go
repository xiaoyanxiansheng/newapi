package service

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

type upstreamPasswordSessionEntry struct {
	mu                          sync.Mutex
	website, username, password string
	session                     *upstreamAccountSession
	err                         error
	expires                     time.Time
}

type upstreamPasswordSessionCache struct {
	mu      sync.Mutex
	entries map[int]*upstreamPasswordSessionEntry
}

var upstreamPasswordSessions = upstreamPasswordSessionCache{entries: make(map[int]*upstreamPasswordSessionEntry)}

// Share a login across Key reads, including concurrent refreshes. Credentials
// changing bypass the old entry; a failed login is briefly held to avoid a
// burst of login attempts. No session or password is written to logs/storage.
func (cache *upstreamPasswordSessionCache) get(account model.UpstreamAccount, login func(model.UpstreamAccount) (*upstreamAccountSession, error)) (*upstreamAccountSession, error) {
	cache.mu.Lock()
	entry := cache.entries[account.Id]
	if entry == nil {
		entry = &upstreamPasswordSessionEntry{}
		cache.entries[account.Id] = entry
	}
	cache.mu.Unlock()
	entry.mu.Lock()
	defer entry.mu.Unlock()
	now := time.Now()
	credentialsMatch := entry.website == account.Website && entry.username == account.Username && entry.password == account.Password
	if credentialsMatch {
		if now.Before(entry.expires) {
			if entry.err != nil {
				return nil, entry.err
			}
			if entry.session != nil && !entry.session.rejected.Load() {
				return entry.session, nil
			}
		}
	}
	if credentialsMatch && entry.session != nil && entry.session.accessToken != "" && entry.session.client.Jar != nil {
		var renewed *upstreamAccountSession
		renewed, entry.err = entry.session.renewPasswordAuthorization()
		if entry.err == nil {
			entry.session = renewed
		}
	} else {
		if entry.session != nil {
			entry.session.client.CloseIdleConnections()
		}
		entry.website, entry.username, entry.password = account.Website, account.Username, account.Password
		entry.session, entry.err = login(account)
	}
	entry.expires = time.Now().Add(30 * time.Second)
	if entry.err == nil {
		entry.expires = time.Now().Add(4 * time.Minute)
		if expires := upstreamAccessTokenExpiry(entry.session.accessToken); expires > 0 {
			tokenExpiry := time.Unix(expires, 0).Add(-15 * time.Second)
			if tokenExpiry.Before(entry.expires) {
				entry.expires = tokenExpiry
			}
		}
	}
	if entry.err != nil {
		return nil, entry.err
	}
	return entry.session, entry.err
}

func (session *upstreamAccountSession) renewPasswordAuthorization() (*upstreamAccountSession, error) {
	raw, err := session.read(http.MethodPost, "/api/user/auth/refresh", "", map[string]any{})
	if err != nil {
		return nil, err
	}
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			AccessToken string `json:"access_token"`
			User        struct {
				ID int `json:"id"`
			} `json:"user"`
		} `json:"data"`
	}
	if common.Unmarshal(raw, &response) != nil || !response.Success || response.Data.AccessToken == "" || response.Data.User.ID != session.userId {
		return nil, errors.New("upstream session renewal was not accepted; sign in on the upstream website and connect browser authorization")
	}
	return &upstreamAccountSession{client: session.client, origin: session.origin, accessToken: response.Data.AccessToken, userId: session.userId}, nil
}

// Expiry is only a UI/cache hint. The upstream still verifies authenticity
// and identity before an authorization can be accepted or Keys can be read.
func upstreamAccessTokenExpiry(token string) int64 {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return 0
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if common.Unmarshal(raw, &claims) != nil {
		return 0
	}
	return claims.Exp
}

func HasUpstreamBrowserAuthorization(account model.UpstreamAccount) bool {
	if account.BrowserDiscovery != "" {
		return account.DiscoveryTime > common.GetTimestamp()-600
	}
	if account.BrowserSession == "" || account.RemoteUserId <= 0 {
		return false
	}
	token, err := common.OpenUpstreamSecret(account.BrowserSession)
	if err != nil {
		return false
	}
	expires := upstreamAccessTokenExpiry(token)
	return expires == 0 || expires > common.GetTimestamp()
}

package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ParseUpstreamKeyPage derives the API origin from the page the user will open.
// Keep the page route (including SPA fragments); API requests use only the origin.
func ParseUpstreamKeyPage(raw string) (origin, page string, err error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 2048 || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
		return "", "", errors.New("provide an HTTPS Key management page without embedded credentials")
	}
	u.Host = strings.ToLower(u.Host)
	if u.Port() == "443" {
		u.Host = strings.TrimSuffix(u.Host, ":443")
	}
	// CCTQ signs in on www. Use that origin for the scoped browser handshake.
	if u.Host == "cctq.ai" {
		u.Host = "www.cctq.ai"
	}
	origin = "https://" + u.Host
	if err := ValidateUpstreamURL(origin); err != nil {
		return "", "", err
	}
	return origin, u.String(), nil
}

// Every HTTPS origin can authorize discovery. Actual API support is verified
// from the logged-in browser rather than requiring a domain-specific adapter.
func UpstreamAccountWorkflow(website string) string {
	u, err := url.Parse(website)
	if err != nil {
		return ""
	}
	if u.Scheme == "https" && (u.Host == "cctq.ai" || u.Host == "www.cctq.ai") {
		return "cctq-existing-keys-v1"
	}
	if u.Scheme == "https" && u.Host == "xxapi.info" {
		return "xxapi-existing-keys-v1"
	}
	if u.Scheme == "https" && u.Host != "" && u.User == nil {
		return "browser-auto-v1"
	}
	return ""
}

type upstreamAccountSession struct {
	client      *http.Client
	origin      string
	accessToken string
	userId      int
	rejected    atomic.Bool
}

func (s *upstreamAccountSession) read(method, path, bearer string, payload any) ([]byte, error) {
	// POST /token/:id/key only reveals an existing Key. Never call create/edit/delete.
	allowed := method == http.MethodGet && (strings.HasPrefix(path, "/api/token/?") || path == "/api/pricing" || path == "/api/status" || path == "/api/user/self" || path == "/v1/models")
	if method == http.MethodGet && (path == "/api/v1/models" || path == "/api/models" || path == "/models" || path == "/v1/sub2api/billing") {
		allowed = true
	}
	if method == http.MethodPost {
		allowed = path == "/api/user/login" || path == "/api/user/auth/refresh"
		if strings.HasPrefix(path, "/api/token/") && strings.HasSuffix(path, "/key") {
			identity := strings.TrimSuffix(strings.TrimPrefix(path, "/api/token/"), "/key")
			id, err := strconv.Atoi(identity)
			allowed = err == nil && id > 0 && identity == strconv.Itoa(id)
		}
	}
	if !allowed {
		return nil, errors.New("upstream operation is outside the existing-Key read workflow")
	}
	var body io.Reader
	if payload != nil {
		b, err := common.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, s.origin+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "hwjai upstream account reader")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method == http.MethodPost {
		req.Header.Set("Origin", s.origin)
		req.Header.Set("Referer", s.origin+"/")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if s.userId > 0 && !strings.HasPrefix(path, "/v1/") {
		req.Header.Set("New-Api-User", strconv.Itoa(s.userId))
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, errors.New("upstream request failed; check the website and retry")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusUnauthorized && bearer == s.accessToken {
			s.rejected.Store(true)
		}
		if path == "/api/user/login" && resp.StatusCode == http.StatusConflict {
			return nil, errors.New("upstream login returned HTTP 409; sign in on the upstream website, review active sessions and connect browser authorization")
		}
		return nil, fmt.Errorf("upstream returned HTTP %d; check account access and retry", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024+1))
	if err != nil || len(b) > 8*1024*1024 {
		return nil, errors.New("upstream response could not be read within the size limit")
	}
	return b, nil
}

func loginUpstreamAccount(account model.UpstreamAccount) (*upstreamAccountSession, error) {
	if account.Id > 0 && (account.AuthType == "" || account.AuthType == "password") {
		return upstreamPasswordSessions.get(account, createUpstreamAccountSession)
	}
	return createUpstreamAccountSession(account)
}

func createUpstreamAccountSession(account model.UpstreamAccount) (*upstreamAccountSession, error) {
	if UpstreamAccountWorkflow(account.Website) == "" {
		return nil, errors.New("this website needs a verified account-reading workflow before it can be connected")
	}
	if account.AuthType == "browser" {
		if account.BrowserSession == "" || account.RemoteUserId <= 0 {
			return nil, errors.New("complete Google or other website sign-in and connect its browser authorization before reading Keys")
		}
		token, err := common.OpenUpstreamSecret(account.BrowserSession)
		if err != nil {
			return nil, err
		}
		session := &upstreamAccountSession{client: NewUpstreamHTTPClient(), origin: account.Website, accessToken: token, userId: account.RemoteUserId}
		if _, err := session.verifyBrowserIdentity(); err != nil {
			session.client.CloseIdleConnections()
			return nil, err
		}
		return session, nil
	}
	if account.AuthType != "" && account.AuthType != "password" {
		return nil, errors.New("invalid upstream login method")
	}
	password, err := common.OpenUpstreamSecret(account.Password)
	if err != nil {
		return nil, err
	}
	client := NewUpstreamHTTPClient()
	jar, _ := cookiejar.New(nil)
	client.Jar = jar
	session := &upstreamAccountSession{client: client, origin: account.Website}
	raw, err := session.read(http.MethodPost, "/api/user/login", "", map[string]string{"username": account.Username, "password": password})
	if err != nil {
		client.CloseIdleConnections()
		return nil, err
	}
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			AccessToken string `json:"access_token"`
			ID          int    `json:"id"`
			User        struct {
				ID int `json:"id"`
			} `json:"user"`
			Requires2FA bool `json:"requires_2fa"`
		} `json:"data"`
	}
	if err := common.Unmarshal(raw, &response); err != nil || !response.Success {
		client.CloseIdleConnections()
		return nil, errors.New("upstream login was not accepted; check username, password and any required verification")
	}
	if response.Data.Requires2FA {
		client.CloseIdleConnections()
		return nil, errors.New("upstream requires two-factor verification; complete the site-specific login setup first")
	}
	session.accessToken = response.Data.AccessToken
	session.userId = response.Data.User.ID
	if session.userId == 0 {
		session.userId = response.Data.ID
	}
	if session.userId <= 0 {
		client.CloseIdleConnections()
		return nil, errors.New("upstream login did not return a verified account identity")
	}
	return session, nil
}

type UpstreamBrowserIdentity struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
}

func (s *upstreamAccountSession) verifyBrowserIdentity() (UpstreamBrowserIdentity, error) {
	raw, err := s.read(http.MethodGet, "/api/user/self", s.accessToken, nil)
	if err != nil {
		if !strings.HasPrefix(err.Error(), "upstream returned HTTP 401;") {
			return UpstreamBrowserIdentity{}, err
		}
		return UpstreamBrowserIdentity{}, errors.New("upstream browser authorization expired or was rejected; sign in again and reconnect the account")
	}
	var response struct {
		Success bool                    `json:"success"`
		Data    UpstreamBrowserIdentity `json:"data"`
	}
	if err := common.Unmarshal(raw, &response); err != nil || !response.Success || response.Data.ID <= 0 || response.Data.ID != s.userId {
		return UpstreamBrowserIdentity{}, errors.New("upstream browser authorization did not verify the selected account identity")
	}
	return response.Data, nil
}

// The companion connects the website's own authorization after interactive
// Google/OAuth sign-in. It never asks for a Google password.
func VerifyUpstreamBrowserAuthorization(account model.UpstreamAccount, token string, userID int) (string, UpstreamBrowserIdentity, error) {
	if UpstreamAccountWorkflow(account.Website) == "" {
		return "", UpstreamBrowserIdentity{}, errors.New("this website needs a verified account-reading workflow before it can be connected")
	}
	if token == "" || len(token) > 16384 || strings.ContainsAny(token, "\r\n\t ") || userID <= 0 {
		return "", UpstreamBrowserIdentity{}, errors.New("invalid upstream browser authorization")
	}
	s := &upstreamAccountSession{client: NewUpstreamHTTPClient(), origin: account.Website, accessToken: token, userId: userID}
	defer s.client.CloseIdleConnections()
	identity, err := s.verifyBrowserIdentity()
	if err != nil {
		return "", UpstreamBrowserIdentity{}, err
	}
	sealed, err := common.SealUpstreamSecret(token)
	return sealed, identity, err
}

type upstreamRemoteKey struct {
	ID                 int    `json:"id"`
	Name               string `json:"name"`
	Key                string `json:"key"`
	Group              string `json:"group"`
	Status             int    `json:"status"`
	ModelLimitsEnabled bool   `json:"model_limits_enabled"`
	ModelLimits        string `json:"model_limits"`
	ExpiresAt          int64  `json:"expired_time"`
}

func FetchUpstreamExistingKeys(account model.UpstreamAccount) ([]model.UpstreamKeyMetadata, error) {
	if account.BrowserDiscovery != "" {
		snapshot, err := readUpstreamDiscovery(account)
		if err != nil {
			return nil, err
		}
		return discoveryKeyMetadata(snapshot), nil
	}
	s, err := loginUpstreamAccount(account)
	if err != nil {
		return nil, err
	}
	defer s.client.CloseIdleConnections()
	return s.existingKeys()
}

func (s *upstreamAccountSession) existingKeys() ([]model.UpstreamKeyMetadata, error) {
	result := []model.UpstreamKeyMetadata{}
	seen := map[int]bool{}
	expectedTotal := -1
	for page := 1; page <= 100; page++ {
		raw, err := s.read(http.MethodGet, fmt.Sprintf("/api/token/?p=%d&size=100", page), s.accessToken, nil)
		if err != nil {
			return nil, err
		}
		var response struct {
			Success bool `json:"success"`
			Data    struct {
				Items []upstreamRemoteKey `json:"items"`
				Total *int                `json:"total"`
			} `json:"data"`
		}
		if err := common.Unmarshal(raw, &response); err != nil || !response.Success || response.Data.Items == nil || response.Data.Total == nil {
			return nil, errors.New("upstream Key list format changed; previous Keys were preserved")
		}
		if len(response.Data.Items) == 0 && len(result) < *response.Data.Total {
			return nil, errors.New("upstream returned an incomplete Key list; refresh again")
		}
		if *response.Data.Total < 0 || *response.Data.Total > 10000 || (expectedTotal >= 0 && expectedTotal != *response.Data.Total) {
			return nil, errors.New("upstream Key list changed while reading; refresh again")
		}
		expectedTotal = *response.Data.Total
		for _, key := range response.Data.Items {
			if key.ID <= 0 || seen[key.ID] {
				return nil, errors.New("upstream Key pagination returned duplicate identities")
			}
			seen[key.ID] = true
			models := "null"
			if key.ModelLimitsEnabled {
				names := []string{}
				for _, name := range strings.Split(key.ModelLimits, ",") {
					if n := strings.TrimSpace(name); n != "" {
						names = append(names, n)
					}
				}
				encoded, err := common.Marshal(names)
				if err != nil {
					return nil, err
				}
				models = string(encoded)
			}
			masked := key.Key
			if !strings.Contains(masked, "*") {
				if len(masked) > 8 {
					masked = masked[:4] + "********" + masked[len(masked)-4:]
				} else {
					masked = "********"
				}
			}
			issue := ""
			if key.Group == "" || key.Group == "auto" {
				issue = "this Key has no fixed verified price group; its pricing workflow needs review"
			}
			result = append(result, model.UpstreamKeyMetadata{RemoteId: key.ID, Name: key.Name, Masked: masked, Group: key.Group, Status: key.Status, ModelsJSON: models, ExpiresAt: key.ExpiresAt, Issue: issue})
		}
		if len(result) == *response.Data.Total {
			return result, nil
		}
		if len(result) > *response.Data.Total {
			return nil, errors.New("upstream Key list changed while reading; refresh again")
		}
	}
	return nil, errors.New("upstream account exceeds the supported 10000-Key limit")
}

// Expanding a Key rechecks its metadata and intersects its actual model endpoint
// with its group pricing. The public website's complete catalog is never assumed.
func FetchUpstreamKeyModels(account model.UpstreamAccount, source model.UpstreamSource) ([]model.UpstreamQuote, string, error) {
	if account.BrowserDiscovery != "" {
		return fetchDiscoveredKeyModels(account, source)
	}
	s, err := loginUpstreamAccount(account)
	if err != nil {
		return nil, "", err
	}
	defer s.client.CloseIdleConnections()
	return s.keyModels(source)
}

func (s *upstreamAccountSession) keyModels(source model.UpstreamSource) ([]model.UpstreamQuote, string, error) {
	metadata, err := s.existingKeys()
	if err != nil {
		return nil, "", err
	}
	var current *model.UpstreamKeyMetadata
	for i := range metadata {
		if metadata[i].RemoteId == source.RemoteKeyId {
			current = &metadata[i]
			break
		}
	}
	if current == nil || current.Status != 1 || (current.ExpiresAt > 0 && current.ExpiresAt <= common.GetTimestamp()) {
		return nil, "", errors.New("this upstream Key is missing, disabled or expired; refresh the account")
	}
	if current.Group != source.PriceGroup || current.ModelsJSON != source.AllowedModelsJSON || current.Issue != "" {
		return nil, "", errors.New("this Key's group or model permissions changed; refresh the account first")
	}
	keyRaw, err := s.read(http.MethodPost, fmt.Sprintf("/api/token/%d/key", source.RemoteKeyId), s.accessToken, map[string]any{})
	if err != nil {
		return nil, "", err
	}
	var keyResponse struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := common.Unmarshal(keyRaw, &keyResponse); err != nil || !keyResponse.Success {
		return nil, "", errors.New("the existing Key could not be read; check website access")
	}
	key := ""
	if common.GetJsonType(keyResponse.Data) == "string" {
		if err := common.Unmarshal(keyResponse.Data, &key); err != nil {
			return nil, "", errors.New("the existing Key could not be read; check website access")
		}
	} else {
		var data struct {
			Key string `json:"key"`
		}
		if err := common.Unmarshal(keyResponse.Data, &data); err != nil {
			return nil, "", errors.New("the existing Key could not be read; check website access")
		}
		key = data.Key
	}
	if key == "" || len(key) > 4096 || strings.ContainsAny(key, "*\r\n\t ") {
		return nil, "", errors.New("the existing Key could not be read; check website access")
	}
	if !strings.HasPrefix(key, "sk-") {
		key = "sk-" + key
	}
	modelsRaw, err := s.read(http.MethodGet, "/v1/models", key, nil)
	if err != nil {
		return nil, "", err
	}
	var modelsResponse struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := common.Unmarshal(modelsRaw, &modelsResponse); err != nil || modelsResponse.Data == nil {
		return nil, "", errors.New("this Key's model list could not be verified")
	}
	pricingRaw, err := s.read(http.MethodGet, "/api/pricing", s.accessToken, nil)
	if err != nil {
		return nil, "", err
	}
	statusRaw, err := s.read(http.MethodGet, "/api/status", "", nil)
	if err != nil {
		return nil, "", err
	}
	var status struct {
		Success bool `json:"success"`
		Data    struct {
			Currency     string  `json:"quota_display_type"`
			ExchangeRate float64 `json:"usd_exchange_rate"`
			QuotaPerUnit float64 `json:"quota_per_unit"`
		} `json:"data"`
	}
	if err := common.Unmarshal(statusRaw, &status); err != nil || !status.Success {
		return nil, "", errors.New("upstream billing display settings could not be verified")
	}
	if status.Data.QuotaPerUnit != 500000 || status.Data.ExchangeRate != 1 || status.Data.Currency != "CNY" {
		return nil, "", errors.New("upstream currency or price units changed; verify its billing settings before publishing")
	}
	displayCurrency := "CNY"
	quotes, err := ParseUpstreamCatalog(pricingRaw, model.UpstreamSource{Adapter: "newapi", PriceGroup: current.Group, PurchaseMultiplier: "1"})
	if err != nil {
		return nil, "", err
	}
	pricing := map[string]model.UpstreamQuote{}
	for _, q := range quotes {
		pricing[q.Model] = q
	}
	allowed := map[string]bool{}
	restricted := source.AllowedModelsJSON != "null" && source.AllowedModelsJSON != ""
	if restricted {
		var names []string
		if err := common.UnmarshalJsonStr(source.AllowedModelsJSON, &names); err != nil {
			return nil, "", err
		}
		for _, n := range names {
			allowed[n] = true
		}
	}
	result := []model.UpstreamQuote{}
	for _, m := range modelsResponse.Data {
		if restricted && !allowed[m.ID] {
			continue
		}
		q, ok := pricing[m.ID]
		if !ok {
			q = model.UpstreamQuote{Model: m.ID, Currency: "USD", PriceIssue: "this Key can access the model but its group price is unconfirmed"}
		}
		q.PriceGroup = current.Group
		q.DisplayCurrency = displayCurrency
		result = append(result, q)
	}
	result, err = model.NormalizeUpstreamCatalog(result)
	if err != nil {
		return nil, "", err
	}
	encrypted, err := common.SealUpstreamSecret(key)
	return result, encrypted, err
}

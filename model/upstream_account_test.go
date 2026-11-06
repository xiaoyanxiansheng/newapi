package model

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"testing"
)

func TestUpstreamPartialPageDiscoveryPreservesUnseenKeysAndSellingPrices(t *testing.T) {
	db := upstreamTestDB(t)
	account := UpstreamAccount{Name: "site", Website: "https://new-site.example", KeyPageURL: "https://new-site.example/keys", RemoteUserId: 17, Username: "owner", Markup: "1.1"}
	require.NoError(t, db.Create(&account).Error)
	metadata := []UpstreamKeyMetadata{{RemoteId: 33, Name: "first", Masked: "mask1", Group: "vip", Status: 1, ModelsJSON: "null"}, {RemoteId: 34, Name: "second", Masked: "mask2", Group: "vip", Status: 1, ModelsJSON: "null"}}
	require.NoError(t, SyncUpstreamKeys(account, metadata))
	require.NoError(t, db.First(&account, account.Id).Error)
	require.NoError(t, db.Model(&UpstreamSource{}).Where("account_id = ?", account.Id).Update("latest_time", 777).Error)
	listing := MarketListing{ChannelId: 9, ModelName: "model", Enabled: true, Ratio: 0.11}
	require.NoError(t, db.Create(&listing).Error)
	require.NoError(t, SaveUpstreamBrowserDiscovery(account, "encrypted-snapshot", "{}", "page", 17, "owner", "", metadata[:1], false))
	var unseen UpstreamSource
	require.NoError(t, db.Where("account_id = ? AND remote_key_id = ?", account.Id, 34).First(&unseen).Error)
	assert.False(t, unseen.KeyMissing)
	assert.Equal(t, int64(777), unseen.LatestTime)
	var saved MarketListing
	require.NoError(t, db.First(&saved, listing.Id).Error)
	assert.True(t, saved.Enabled)
	assert.Equal(t, 0.11, saved.Ratio)
	require.NoError(t, db.First(&account, account.Id).Error)
	revision := account.Revision
	require.Error(t, SaveUpstreamBrowserDiscovery(account, "replacement", "{}", "page", 17, "owner", "", []UpstreamKeyMetadata{metadata[0], metadata[0]}, false))
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.Equal(t, revision, account.Revision)
	assert.Equal(t, "encrypted-snapshot", string(account.BrowserDiscovery))
}

func TestUpstreamKeySyncInvalidatesChangedPermissionsWithoutChangingPublishedPrices(t *testing.T) {
	db := upstreamTestDB(t)
	account := UpstreamAccount{Name: "site", Website: "https://www.cctq.ai", Markup: "1.1"}
	require.NoError(t, db.Create(&account).Error)
	keys := []UpstreamKeyMetadata{{RemoteId: 33, Name: "mine", Masked: "masked", Group: "vip", Status: 1, ModelsJSON: "null"}}
	require.NoError(t, SyncUpstreamKeys(account, keys))
	require.Error(t, SyncUpstreamKeys(account, keys))
	require.NoError(t, db.First(&account, account.Id).Error)
	var source UpstreamSource
	require.NoError(t, db.Where("account_id = ?", account.Id).First(&source).Error)
	listing := MarketListing{ChannelId: 7, ModelName: "a", Ratio: 0.11, Enabled: true}
	require.NoError(t, db.Create(&listing).Error)
	require.NoError(t, db.Model(&source).Updates(map[string]any{"latest_time": 100, "channel_id": 7}).Error)
	keys[0].Group = "new-group"
	require.NoError(t, SyncUpstreamKeys(account, keys))
	require.NoError(t, db.First(&source, source.Id).Error)
	assert.Zero(t, source.LatestTime)
	assert.Equal(t, 7, source.ChannelId)
	require.NoError(t, db.First(&listing, listing.Id).Error)
	assert.Equal(t, 0.11, listing.Ratio)
	assert.True(t, listing.Enabled)
	require.NoError(t, db.First(&account, account.Id).Error)
	require.NoError(t, SyncUpstreamKeys(account, nil))
	require.ErrorIs(t, db.First(&source, source.Id).Error, gorm.ErrRecordNotFound)
	require.ErrorIs(t, db.First(&listing, listing.Id).Error, gorm.ErrRecordNotFound)
}

func TestUpstreamPublishUsesExistingEncryptedKeyAndUpdatesRotatedKeyOnlyAfterApply(t *testing.T) {
	db := upstreamTestDB(t)
	t.Setenv("CRYPTO_SECRET", "persistent-test-secret-123")
	first, err := common.SealUpstreamSecret("sk-existing-first")
	require.NoError(t, err)
	account := UpstreamAccount{Name: "fixture", Website: "https://www.cctq.ai", Markup: "1.1"}
	require.NoError(t, db.Create(&account).Error)
	source := UpstreamSource{AccountId: account.Id, RemoteKeyId: 33, KeyStatus: 1, Name: "mine", BaseURL: "https://www.cctq.ai", Markup: "1.1"}
	require.NoError(t, db.Create(&source).Error)
	require.NoError(t, SaveUpstreamKeySnapshot(source.Id, 0, []UpstreamQuote{upstreamQuoteFixture("a")}, first))
	p := UpstreamProposal{Model: "a", Ratio: 0.11, Markup: "1.1", Enabled: true}
	require.NoError(t, ApplyUpstreamSelection(source.Id, 1, []UpstreamProposal{p}))
	require.NoError(t, db.First(&source, source.Id).Error)
	var channel Channel
	require.NoError(t, db.First(&channel, source.ChannelId).Error)
	assert.Equal(t, "sk-existing-first", channel.Key)
	var listing MarketListing
	require.NoError(t, db.Where("channel_id = ?", channel.Id).First(&listing).Error)
	assert.Equal(t, 0.11, listing.Ratio)
	rotated, err := common.SealUpstreamSecret("sk-existing-rotated")
	require.NoError(t, err)
	require.NoError(t, SaveUpstreamKeySnapshot(source.Id, 2, []UpstreamQuote{upstreamQuoteFixture("a")}, rotated))
	require.NoError(t, db.First(&channel, channel.Id).Error)
	assert.Equal(t, "sk-existing-first", channel.Key)
	p.ListingId = listing.Id
	p.CurrentRatio = 0.11
	require.NoError(t, ApplyUpstreamSelection(source.Id, 3, []UpstreamProposal{p}))
	require.NoError(t, db.First(&channel, channel.Id).Error)
	assert.Equal(t, "sk-existing-rotated", channel.Key)
	require.NoError(t, db.Model(&source).Update("key_missing", true).Error)
	require.ErrorContains(t, ApplyUpstreamSelection(source.Id, 4, []UpstreamProposal{p}), "unavailable")
}

func TestUpstreamBrowserConnectionProtectsExistingAccountAndPrices(t *testing.T) {
	for _, tc := range []struct {
		name      string
		username  string
		pinnedID  int
		linked    bool
		stale     bool
		wantError string
	}{
		{name: "new browser identity", username: "old-login"},
		{name: "new account pins verified username"},
		{name: "same pinned identity reconnects", username: "owner", pinnedID: 17, linked: true},
		{name: "matching legacy email reconnects", username: "owner@example.com", linked: true},
		{name: "different pinned identity is rejected", username: "owner", pinnedID: 18, linked: true, wantError: "different upstream account"},
		{name: "different legacy identity is rejected", username: "other-owner", linked: true, wantError: "different upstream account"},
		{name: "empty legacy identity is rejected", linked: true, wantError: "different upstream account"},
		{name: "stale connection cannot replace session", username: "owner", pinnedID: 17, linked: true, stale: true, wantError: "account changed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := upstreamTestDB(t)
			account := UpstreamAccount{Name: "site", Username: tc.username, BrowserSession: "previous-sealed-session", Password: "previous-sealed-password", RemoteUserId: tc.pinnedID, Revision: 2, LastError: "previous error"}
			require.NoError(t, db.Create(&account).Error)
			source := UpstreamSource{AccountId: account.Id, RemoteKeyId: 33, LatestTime: 100, Revision: 4, RelayKey: "existing-sealed-key", ChannelId: 7}
			if tc.linked {
				require.NoError(t, db.Create(&source).Error)
			}
			listing := MarketListing{ChannelId: 7, ModelName: "a", Ratio: 0.11, Enabled: true}
			require.NoError(t, db.Create(&listing).Error)
			expected := account
			if tc.stale {
				account.Revision--
			}
			err := SaveUpstreamBrowserAuthorization(account, "new-sealed-session", 17, "owner", "owner@example.com")
			var saved UpstreamAccount
			require.NoError(t, db.First(&saved, expected.Id).Error)
			if tc.wantError != "" {
				require.ErrorContains(t, err, tc.wantError)
				assert.Equal(t, expected, saved)
			} else {
				require.NoError(t, err)
				assert.Equal(t, "browser", saved.AuthType)
				assert.Equal(t, "new-sealed-session", saved.BrowserSession)
				assert.Equal(t, 17, saved.RemoteUserId)
				assert.Equal(t, int64(3), saved.Revision)
				assert.Empty(t, saved.Password)
				assert.Empty(t, saved.LastError)
				expectedUsername := tc.username
				if expectedUsername == "" {
					expectedUsername = "owner"
				}
				assert.Equal(t, expectedUsername, saved.Username)
			}
			if tc.linked {
				var savedSource UpstreamSource
				require.NoError(t, db.First(&savedSource, source.Id).Error)
				if tc.wantError != "" {
					assert.Equal(t, source, savedSource)
				} else if tc.pinnedID == 17 {
					assert.Equal(t, source, savedSource, "renewing the same identity must not invalidate reviewed prices")
				} else {
					assert.Zero(t, savedSource.LatestTime)
					assert.Equal(t, int64(5), savedSource.Revision)
					assert.Equal(t, source.RelayKey, savedSource.RelayKey)
					assert.Equal(t, source.ChannelId, savedSource.ChannelId)
				}
			}
			var savedListing MarketListing
			require.NoError(t, db.First(&savedListing, listing.Id).Error)
			assert.Equal(t, listing, savedListing)
		})
	}
}

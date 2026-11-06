package model

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"testing"
)

func upstreamLifecycleFixture(t *testing.T) (*gorm.DB, UpstreamAccount, []UpstreamSource, UpstreamAccount, UpstreamSource) {
	t.Helper()
	db := upstreamTestDB(t)
	require.NoError(t, db.AutoMigrate(&MarketStat{}, &MarketProbeUsageRecord{}))
	account := UpstreamAccount{Name: "owned", Website: "https://owned.example", BrowserDiscovery: "encrypted-snapshot", Markup: "1.1"}
	other := UpstreamAccount{Name: "other", Website: "https://other.example", Markup: "1.1"}
	require.NoError(t, db.Create(&account).Error)
	require.NoError(t, db.Create(&other).Error)
	sources := []UpstreamSource{}
	var unrelated UpstreamSource
	for index, owner := range []UpstreamAccount{account, account, other} {
		status := common.ChannelStatusEnabled
		if index == 1 {
			status = common.ChannelStatusAutoDisabled
		}
		channel := Channel{Name: owner.Name, Key: "local-relay-secret", Models: "example", Group: "default", Status: status}
		require.NoError(t, db.Create(&channel).Error)
		require.NoError(t, channel.AddAbilities(db))
		source := UpstreamSource{AccountId: owner.Id, RemoteKeyId: index + 1, ChannelId: channel.Id, Adapter: "account", Name: owner.Name, KeyStatus: 1, AllowedModelsJSON: "null", LatestTime: 10, RelayKey: "encrypted-key", Markup: "1.1"}
		require.NoError(t, db.Create(&source).Error)
		require.NoError(t, db.Create(&UpstreamReview{SourceId: source.Id, ModelName: "example"}).Error)
		require.NoError(t, db.Create(&UpstreamRefresh{SourceId: source.Id, SnapshotJSON: "cached-price-and-key-data"}).Error)
		require.NoError(t, db.Create(&MarketListing{ChannelId: channel.Id, ModelName: "example", Ratio: 1, Enabled: true}).Error)
		require.NoError(t, db.Create(&MarketStat{ChannelId: channel.Id, ModelName: "example", Bucket: 1}).Error)
		require.NoError(t, db.Create(&MarketProbeUsageRecord{ChannelId: channel.Id, ModelName: "example"}).Error)
		if owner.Id == account.Id {
			sources = append(sources, source)
		} else {
			unrelated = source
		}
	}
	return db, account, sources, other, unrelated
}

func TestUpstreamDeletingWebsiteRemovesBoundKeysModelsAndCredentialsOnlyForThatWebsite(t *testing.T) {
	db, account, sources, other, unrelated := upstreamLifecycleFixture(t)
	require.NoError(t, DeleteUpstreamAccount(account.Id, account.Revision))
	var count int64
	for _, entity := range []any{&UpstreamAccount{}, &UpstreamSource{}, &UpstreamReview{}, &UpstreamRefresh{}, &Channel{}, &Ability{}, &MarketListing{}, &MarketStat{}, &MarketProbeUsageRecord{}} {
		require.NoError(t, db.Model(entity).Count(&count).Error)
		assert.EqualValues(t, 1, count, "the unrelated website's records must survive: %T", entity)
	}
	var remaining UpstreamSource
	require.NoError(t, db.First(&remaining, unrelated.Id).Error)
	assert.Equal(t, other.Id, remaining.AccountId)
	assert.Equal(t, "encrypted-key", remaining.RelayKey)
	for _, source := range sources {
		require.Error(t, SaveUpstreamSnapshot(source.Id, source.Revision, []UpstreamQuote{}), "a stale refresh must not recreate a deleted Key")
	}
}

func TestUpstreamDisabledWebsiteCannotRepublishAfterKeySyncAndReenableKeepsModelsPaused(t *testing.T) {
	db, account, sources, _, unrelated := upstreamLifecycleFixture(t)
	require.NoError(t, SetUpstreamAccountDisabled(account.Id, account.Revision, true))
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.True(t, account.Disabled)
	for _, source := range sources {
		var channel Channel
		require.NoError(t, db.First(&channel, source.ChannelId).Error)
		assert.Equal(t, common.ChannelStatusManuallyDisabled, channel.Status)
		var listing MarketListing
		require.NoError(t, db.Where("channel_id = ?", channel.Id).First(&listing).Error)
		assert.False(t, listing.Enabled)
		var enabled int64
		require.NoError(t, db.Model(&Ability{}).Where("channel_id = ? AND enabled = ?", channel.Id, true).Count(&enabled).Error)
		assert.Zero(t, enabled)
		enableListing := true
		_, err := UpdateMarketListing(listing.Id, nil, &enableListing, nil, nil)
		require.ErrorContains(t, err, "disabled")
	}
	require.NoError(t, SyncUpstreamKeys(account, []UpstreamKeyMetadata{{RemoteId: 1, Name: "owned", Status: 1, ModelsJSON: "null"}, {RemoteId: 2, Name: "owned", Status: 1, ModelsJSON: "null"}, {RemoteId: 4, Name: "new", Status: 1, ModelsJSON: "null"}}))
	var newSource UpstreamSource
	require.NoError(t, db.Where("account_id = ? AND remote_key_id = ?", account.Id, 4).First(&newSource).Error)
	require.ErrorContains(t, ApplyUpstreamSelection(newSource.Id, newSource.Revision, []UpstreamProposal{{Model: "example"}}), "disabled")
	require.NoError(t, db.First(&account, account.Id).Error)
	require.NoError(t, SetUpstreamAccountDisabled(account.Id, account.Revision, false))
	for index, source := range sources {
		var channel Channel
		require.NoError(t, db.First(&channel, source.ChannelId).Error)
		expected := common.ChannelStatusEnabled
		if index == 1 {
			expected = common.ChannelStatusAutoDisabled
		}
		assert.Equal(t, expected, channel.Status)
		var listing MarketListing
		require.NoError(t, db.Where("channel_id = ?", channel.Id).First(&listing).Error)
		assert.False(t, listing.Enabled)
	}
	var otherListing MarketListing
	require.NoError(t, db.Where("channel_id = ?", unrelated.ChannelId).First(&otherListing).Error)
	assert.True(t, otherListing.Enabled)
}

func TestUpstreamLifecycleRejectsStaleRevisionAndSharedRelayWithoutPartialDeletion(t *testing.T) {
	db, account, sources, other, _ := upstreamLifecycleFixture(t)
	require.ErrorContains(t, DeleteUpstreamAccount(account.Id, 99), "changed")
	shared := UpstreamSource{AccountId: other.Id, ChannelId: sources[0].ChannelId}
	require.NoError(t, db.Create(&shared).Error)
	require.ErrorContains(t, DeleteUpstreamAccount(account.Id, account.Revision), "shared")
	require.ErrorContains(t, SetUpstreamAccountDisabled(account.Id, account.Revision, true), "shared")
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.False(t, account.Disabled)
	assert.Zero(t, account.Revision)
	var count int64
	require.NoError(t, db.Model(&UpstreamSource{}).Count(&count).Error)
	assert.EqualValues(t, 4, count)
}

package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUpstreamDeletionCascadesSavedSelectionsAndKeepsOtherParents(t *testing.T) {
	for _, action := range []string{"channel", "batch", "status", "website", "missing-key"} {
		t.Run(action, func(t *testing.T) {
			db, account, sources, _, unrelated := upstreamLifecycleFixture(t)
			t.Setenv("CRYPTO_SECRET", "integrity-test-secret")
			snapshot, err := common.SealUpstreamSecret("{\"keys\":[{\"id\":1,\"key\":\"first\"},{\"id\":2,\"key\":\"second\"}]}")
			require.NoError(t, err)
			require.NoError(t, db.Model(&account).Update("browser_discovery", snapshot).Error)
			var listings []MarketListing
			require.NoError(t, db.Order("id").Find(&listings).Error)
			token := Token{UserId: 7, Key: "cascade-fixture"}
			require.NoError(t, token.setRoutes([]TokenRoute{
				{Model: "example", Channels: []int{sources[0].ChannelId, unrelated.ChannelId, sources[1].ChannelId}, ListingIDs: []int{listings[0].Id, listings[2].Id, listings[1].Id}},
				{Model: "legacy", Channels: []int{sources[0].ChannelId}},
				{Model: "deliberately-empty", Channels: []int{}},
			}))
			require.NoError(t, db.Create(&token).Error)
			require.NoError(t, db.AutoMigrate(&Log{}))
			history := Log{ChannelId: sources[0].ChannelId, ModelName: "example", Quota: 123}
			require.NoError(t, db.Create(&history).Error)
			expected := []int{unrelated.ChannelId, sources[1].ChannelId}
			switch action {
			case "channel":
				require.NoError(t, (&Channel{Id: sources[0].ChannelId}).Delete())
			case "batch":
				n, err := BatchDeleteChannels([]int{sources[0].ChannelId, 99999})
				require.NoError(t, err)
				assert.EqualValues(t, 1, n)
			case "status":
				require.NoError(t, db.Model(&Channel{}).Where("id = ?", sources[0].ChannelId).Update("status", common.ChannelStatusManuallyDisabled).Error)
				n, err := DeleteChannelByStatus(common.ChannelStatusManuallyDisabled)
				require.NoError(t, err)
				assert.EqualValues(t, 1, n)
			case "website":
				require.NoError(t, DeleteUpstreamAccount(account.Id, account.Revision))
				expected = []int{unrelated.ChannelId}
			case "missing-key":
				require.NoError(t, SyncUpstreamKeys(account, []UpstreamKeyMetadata{{RemoteId: 2, Status: 1, ModelsJSON: "null"}}))
			}
			require.NoError(t, db.First(&token, token.Id).Error)
			routes := token.GetRoutes()
			require.Len(t, routes, 2)
			assert.Equal(t, expected, routes[0].Channels)
			assert.Equal(t, listings[2].Id, routes[0].ListingID(0))
			assert.Equal(t, "deliberately-empty", routes[1].Model)
			for _, entity := range []any{&UpstreamSource{}, &UpstreamReview{}, &UpstreamRefresh{}, &Channel{}, &Ability{}, &MarketListing{}, &MarketStat{}, &MarketProbeUsageRecord{}} {
				var count int64
				require.NoError(t, db.Model(entity).Count(&count).Error)
				assert.EqualValues(t, len(expected), count, "%T", entity)
			}
			require.NoError(t, db.First(&history, history.Id).Error)
			assert.Equal(t, 123, history.Quota)
			if action != "website" {
				require.NoError(t, db.First(&account, account.Id).Error)
				plain, err := common.OpenUpstreamSecret(string(account.BrowserDiscovery))
				require.NoError(t, err)
				assert.NotContains(t, plain, "first")
				assert.Contains(t, plain, "second")
			}
		})
	}
}

func TestUpstreamCascadeRollsBackRatherThanLeavingHalfDeletedTree(t *testing.T) {
	db, account, sources, _, _ := upstreamLifecycleFixture(t)
	token := Token{Key: "malformed-routes", Routes: "[{broken"}
	require.NoError(t, db.Create(&token).Error)
	require.ErrorContains(t, DeleteUpstreamAccount(account.Id, account.Revision), "malformed")
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.Equal(t, "encrypted-snapshot", string(account.BrowserDiscovery))
	for _, source := range sources {
		require.NoError(t, db.First(&UpstreamSource{}, source.Id).Error)
		require.NoError(t, db.First(&Channel{}, source.ChannelId).Error)
		var count int64
		require.NoError(t, db.Model(&MarketListing{}).Where("channel_id = ?", source.ChannelId).Count(&count).Error)
		assert.EqualValues(t, 1, count)
	}
}

func TestUpstreamListingDeletionKeepsOtherOffersOnSameChannel(t *testing.T) {
	db := upstreamTestDB(t)
	channel := Channel{Models: "example@s1c1,example@s2c2", Status: common.ChannelStatusEnabled}
	require.NoError(t, db.Create(&channel).Error)
	offers := []MarketListing{{ChannelId: channel.Id, ModelName: "example@s1c1", Enabled: true, Ratio: 1}, {ChannelId: channel.Id, ModelName: "example@s2c2", Enabled: true, Ratio: 1}}
	require.NoError(t, db.Create(&offers).Error)
	review := UpstreamReview{SourceId: 1, ModelName: offers[0].ModelName, ListingId: offers[0].Id, AppliedMarkup: "1.1"}
	require.NoError(t, db.Create(&review).Error)
	token := Token{Key: "offer-deletion"}
	require.NoError(t, token.setRoutes([]TokenRoute{{Model: "example", Channels: []int{channel.Id, channel.Id}, ListingIDs: []int{offers[0].Id, offers[1].Id}}}))
	require.NoError(t, db.Create(&token).Error)
	require.NoError(t, DeleteMarketListings([]int{offers[0].Id}))
	require.NoError(t, db.First(&token, token.Id).Error)
	require.Len(t, token.GetRoutes(), 1)
	assert.Equal(t, []int{offers[1].Id}, token.GetRoutes()[0].ListingIDs)
	require.NoError(t, db.First(&review, review.Id).Error)
	assert.Zero(t, review.ListingId)
	assert.Empty(t, review.AppliedMarkup)
	require.NoError(t, db.First(&Channel{}, channel.Id).Error)
}

func TestUpstreamRepairPrunesOnlyInvalidReferencesAndIsIdempotent(t *testing.T) {
	db, account, sources, _, unrelated := upstreamLifecycleFixture(t)
	require.NoError(t, db.Model(&account).Update("browser_discovery", "").Error)
	require.NoError(t, db.Model(&sources[0]).Update("key_missing", true).Error)
	var survivor MarketListing
	require.NoError(t, db.Where("channel_id = ?", unrelated.ChannelId).First(&survivor).Error)
	token := Token{Key: "repair-route-fixture"}
	require.NoError(t, token.setRoutes([]TokenRoute{{Model: "example", Channels: []int{sources[0].ChannelId, sources[1].ChannelId, unrelated.ChannelId, 999}, ListingIDs: []int{0, survivor.Id, survivor.Id, 888}}}))
	require.NoError(t, db.Create(&token).Error)
	require.NoError(t, ReconcileUpstreamIntegrity())
	require.NoError(t, db.First(&token, token.Id).Error)
	require.Len(t, token.GetRoutes(), 1)
	assert.Equal(t, []int{unrelated.ChannelId}, token.GetRoutes()[0].Channels)
	assert.Equal(t, []int{survivor.Id}, token.GetRoutes()[0].ListingIDs)
	assert.ErrorIs(t, db.First(&UpstreamSource{}, sources[0].Id).Error, gorm.ErrRecordNotFound)
	before := token.Routes
	require.NoError(t, ReconcileUpstreamIntegrity())
	require.NoError(t, db.First(&token, token.Id).Error)
	assert.Equal(t, before, token.Routes)
}

func TestUpstreamUnavailableListingCannotBeReinsertedFromStaleMarketResponse(t *testing.T) {
	db := upstreamTestDB(t)
	channel := Channel{Models: "example", Status: common.ChannelStatusEnabled}
	require.NoError(t, db.Create(&channel).Error)
	listing := MarketListing{ChannelId: channel.Id, ModelName: "example", Enabled: true, Ratio: 1}
	require.NoError(t, db.Create(&listing).Error)
	token := Token{UserId: 7, Key: "stale-market-add"}
	require.NoError(t, db.Create(&token).Error)
	require.NoError(t, DeleteMarketListings([]int{listing.Id}))
	_, err := MutateTokenRoutes(token.Id, token.UserId, func(routes []TokenRoute) ([]TokenRoute, error) {
		return append(routes, TokenRoute{Model: "example", Channels: []int{channel.Id}, ListingIDs: []int{listing.Id}}), nil
	}, listing.Id)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	require.NoError(t, db.First(&token, token.Id).Error)
	assert.Empty(t, token.GetRoutes())
}

func TestUpstreamRevokedModelPermissionsPauseOnlyAffectedSelections(t *testing.T) {
	db, account, sources, _, unrelated := upstreamLifecycleFixture(t)
	allowed := MarketListing{ChannelId: sources[0].ChannelId, ModelName: "still-allowed", Ratio: 0.75, Enabled: true}
	require.NoError(t, db.Create(&allowed).Error)
	var revoked MarketListing
	require.NoError(t, db.Where("channel_id = ? AND model_name = ?", sources[0].ChannelId, "example").First(&revoked).Error)
	token := Token{Key: "permission-shrink"}
	require.NoError(t, token.setRoutes([]TokenRoute{
		{Model: "example", Channels: []int{sources[0].ChannelId, unrelated.ChannelId}},
		{Model: "still-allowed", Channels: []int{sources[0].ChannelId}, ListingIDs: []int{allowed.Id}},
	}))
	require.NoError(t, db.Create(&token).Error)
	require.NoError(t, SyncUpstreamKeys(account, []UpstreamKeyMetadata{{RemoteId: 1, Status: 1, ModelsJSON: "[\"still-allowed\"]"}, {RemoteId: 2, Status: 1, ModelsJSON: "null"}}))
	require.NoError(t, db.First(&revoked, revoked.Id).Error)
	assert.False(t, revoked.Enabled)
	assert.Equal(t, float64(1), revoked.Ratio)
	require.NoError(t, db.First(&allowed, allowed.Id).Error)
	assert.True(t, allowed.Enabled)
	assert.Equal(t, 0.75, allowed.Ratio)
	require.NoError(t, db.First(&token, token.Id).Error)
	require.Len(t, token.GetRoutes(), 2)
	assert.Equal(t, []int{unrelated.ChannelId}, token.GetRoutes()[0].Channels)
	assert.Equal(t, []int{allowed.Id}, token.GetRoutes()[1].ListingIDs)
	enabled := true
	_, err := UpdateMarketListing(revoked.Id, nil, &enabled, nil, nil)
	require.ErrorContains(t, err, "no longer allowed")
}

func TestUpstreamBaseModelPermissionRetainsSupplierOffersWithoutGrantingVariants(t *testing.T) {
	db := upstreamTestDB(t)
	account := UpstreamAccount{Name: "supplier"}
	require.NoError(t, db.Create(&account).Error)
	channel := Channel{Models: "example@s1c1,example@s2c2,example-thinking", Status: common.ChannelStatusEnabled}
	require.NoError(t, db.Create(&channel).Error)
	source := UpstreamSource{AccountId: account.Id, ChannelId: channel.Id, KeyStatus: 1, AllowedModelsJSON: "[\"example\"]"}
	require.NoError(t, db.Create(&source).Error)
	offers := []MarketListing{{ChannelId: channel.Id, ModelName: "example@s1c1", Enabled: true, Ratio: 1}, {ChannelId: channel.Id, ModelName: "example@s2c2", Enabled: true, Ratio: 1}, {ChannelId: channel.Id, ModelName: "example-thinking", Enabled: true, Ratio: 1}}
	require.NoError(t, db.Create(&offers).Error)
	assert.True(t, UpstreamChannelUsable(channel.Id, offers[0].ModelName))
	assert.True(t, UpstreamChannelUsable(channel.Id, offers[1].ModelName))
	assert.False(t, UpstreamChannelUsable(channel.Id, offers[2].ModelName))
	require.NoError(t, ReconcileUpstreamIntegrity())
	require.NoError(t, db.Order("id").Find(&offers).Error)
	assert.True(t, offers[0].Enabled)
	assert.True(t, offers[1].Enabled)
	assert.False(t, offers[2].Enabled)
	require.NoError(t, db.Model(&source).Update("allowed_models_json", "[\"example@s1c1\"]").Error)
	assert.True(t, UpstreamChannelUsable(channel.Id, offers[0].ModelName))
	assert.False(t, UpstreamChannelUsable(channel.Id, offers[1].ModelName))
}

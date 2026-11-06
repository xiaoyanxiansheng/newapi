package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func upstreamTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&UpstreamAccount{}, &UpstreamSource{}, &UpstreamReview{}, &UpstreamRefresh{}, &Channel{}, &MarketListing{}, &Ability{}, &Token{}, &MarketStat{}, &MarketProbeUsageRecord{}))
	previous := DB
	memory := common.MemoryCacheEnabled
	DB = db
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		DB = previous
		common.MemoryCacheEnabled = memory
		InvalidateMarketListings()
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	return db
}
func upstreamQuoteFixture(name string) UpstreamQuote {
	return UpstreamQuote{Model: name, Currency: "USD", Unit: "per_million_tokens", Original: UpstreamPrices{Input: "20", Output: "80", CacheRead: "2", CacheWrite: "25"}, Cost: UpstreamPrices{Input: "2", Output: "8", CacheRead: "0.2", CacheWrite: "2.5"}}
}

func TestUpstreamEmptyJoinedCatalogPreservesMerchantModeAndExistingListings(t *testing.T) {
	db := upstreamTestDB(t)
	source := UpstreamSource{PricingMode: "model_routes", ChannelId: 7}
	require.NoError(t, db.Create(&source).Error)
	listing := MarketListing{ChannelId: 7, ModelName: "example@s1c13", Ratio: 1.1, Enabled: true}
	require.NoError(t, db.Create(&listing).Error)
	require.NoError(t, SaveUpstreamSnapshot(source.Id, 0, []UpstreamQuote{}))
	require.NoError(t, db.First(&source, source.Id).Error)
	assert.Equal(t, "model_routes", source.PricingMode)
	assert.Equal(t, "[]", source.LatestJSON)
	var after MarketListing
	require.NoError(t, db.First(&after, listing.Id).Error)
	assert.Equal(t, listing, after)
}
func TestUpstreamExistingRatioPricesAllDimensionsAndRejectsMismatches(t *testing.T) {
	q := upstreamQuoteFixture("example")
	ratio, sale, err := DeriveUpstreamListingRatio(q.Original, q, "1.1")
	require.NoError(t, err)
	assert.Equal(t, 0.11, ratio)
	assert.Equal(t, UpstreamPrices{Input: "2.2", Output: "8.8", CacheRead: "0.22", CacheWrite: "2.75"}, sale)
	q.Cost.Output = "9"
	_, _, err = DeriveUpstreamListingRatio(q.Original, q, "1.1")
	require.ErrorContains(t, err, "different ratios")
	q = upstreamQuoteFixture("example")
	q.Cost.CacheRead = ""
	q.Original.CacheRead = ""
	base := q.Original
	base.CacheRead = "2"
	_, _, err = DeriveUpstreamListingRatio(base, q, "1.1")
	require.ErrorContains(t, err, "missing")
	q = upstreamQuoteFixture("example")
	q.Original.CacheRead = "0"
	q.Cost.CacheRead = "0"
	ratio, sale, err = DeriveUpstreamListingRatio(q.Original, q, "1.1")
	require.NoError(t, err)
	assert.Equal(t, 0.11, ratio)
	assert.Equal(t, "0", sale.CacheRead)
}
func TestUpstreamRequestPricesPreserveDecimalPrecisionAndRejectInvalidAmounts(t *testing.T) {
	q := UpstreamQuote{Model: "request", Currency: "USD", Unit: "per_request", Original: UpstreamPrices{Request: "20"}, Cost: UpstreamPrices{Request: "2"}}
	ratio, sale, err := DeriveUpstreamListingRatio(q.Original, q, "1.1")
	require.NoError(t, err)
	assert.Equal(t, 0.11, ratio)
	assert.Equal(t, "2.2", sale.Request)
	for _, bad := range []string{"-1", "NaN", "Infinity", "1e99", "0.0000000000001", "1000001", ""} {
		_, err := ParseUpstreamAmount(bad)
		require.Error(t, err, bad)
	}
	tiny, err := ParseUpstreamAmount("1e-8")
	require.NoError(t, err)
	assert.Equal(t, "0.00000001", tiny.String())
	q.Currency = "CNY"
	_, _, err = DeriveUpstreamListingRatio(q.Original, q, "1.1")
	require.Error(t, err)
}
func TestUpstreamRefreshPreservesLivePricesAndUnreviewedReferences(t *testing.T) {
	db := upstreamTestDB(t)
	s := UpstreamSource{Name: "test", Markup: "1.1"}
	require.NoError(t, db.Create(&s).Error)
	listing := MarketListing{ChannelId: 7, ModelName: "a", Ratio: 0.11, Enabled: true}
	require.NoError(t, db.Create(&listing).Error)
	q := upstreamQuoteFixture("a")
	require.NoError(t, SaveUpstreamSnapshot(s.Id, 0, []UpstreamQuote{q, upstreamQuoteFixture("gone")}))
	q.Cost.Output = "9"
	require.NoError(t, SaveUpstreamSnapshot(s.Id, 1, []UpstreamQuote{q}))
	require.NoError(t, SaveUpstreamSnapshot(s.Id, 2, []UpstreamQuote{q}))
	var reference UpstreamReview
	require.NoError(t, db.Where("source_id = ? AND model_name = ?", s.Id, "a").First(&reference).Error)
	assert.False(t, reference.Reviewed)
	assert.Contains(t, reference.QuoteJSON, `"output":"8"`)
	var removed UpstreamReview
	require.NoError(t, db.Where("source_id = ? AND model_name = ?", s.Id, "gone").First(&removed).Error)
	var current MarketListing
	require.NoError(t, db.First(&current, listing.Id).Error)
	assert.Equal(t, 0.11, current.Ratio)
	assert.True(t, current.Enabled)
	require.Error(t, SaveUpstreamSnapshot(s.Id, 1, []UpstreamQuote{}))
	var count int64
	require.NoError(t, db.Model(&UpstreamRefresh{}).Count(&count).Error)
	assert.Equal(t, int64(3), count)
	require.NoError(t, ReviewUpstreamModels(s.Id, 3, []string{"a", "gone"}, false))
	require.NoError(t, db.First(&reference, reference.Id).Error)
	assert.True(t, reference.Reviewed)
	assert.Contains(t, reference.QuoteJSON, `"output":"9"`)
	require.NoError(t, db.First(&removed, removed.Id).Error)
	assert.True(t, removed.Missing)
}
func TestUpstreamApplyOnlySelectedModelsKeepsPausedStateAndRejectsStaleListings(t *testing.T) {
	db := upstreamTestDB(t)
	base := "https://example.com"
	ch := Channel{Name: "existing", Type: 1, Status: common.ChannelStatusEnabled, BaseURL: &base, Key: "existing-key", Group: "default", Models: "keep"}
	require.NoError(t, db.Create(&ch).Error)
	s := UpstreamSource{Name: "source", BaseURL: base, ChannelId: ch.Id, Markup: "1.1"}
	require.NoError(t, db.Create(&s).Error)
	l := MarketListing{ChannelId: ch.Id, ModelName: "a", Ratio: 0.1, Enabled: false}
	require.NoError(t, db.Create(&l).Error)
	require.NoError(t, SaveUpstreamSnapshot(s.Id, 0, []UpstreamQuote{upstreamQuoteFixture("a"), upstreamQuoteFixture("b")}))
	p := UpstreamProposal{Model: "a", Ratio: 0.11, Markup: "1.1", ListingId: l.Id, CurrentRatio: 0.1, Enabled: false}
	require.NoError(t, ApplyUpstreamSelection(s.Id, 1, []UpstreamProposal{p}))
	require.NoError(t, db.First(&ch, ch.Id).Error)
	assert.Equal(t, "keep,a", ch.Models)
	assert.Equal(t, "existing-key", ch.Key)
	require.NoError(t, db.First(&l, l.Id).Error)
	assert.Equal(t, 0.11, l.Ratio)
	assert.False(t, l.Enabled)
	var bCount int64
	require.NoError(t, db.Model(&MarketListing{}).Where("model_name = ?", "b").Count(&bCount).Error)
	assert.Zero(t, bCount)
	p.CurrentRatio = 0.11
	require.NoError(t, db.Model(&l).Update("ratio", 0.2).Error)
	require.ErrorContains(t, ApplyUpstreamSelection(s.Id, 2, []UpstreamProposal{p}), "listing changed")
	require.NoError(t, db.First(&l, l.Id).Error)
	assert.Equal(t, 0.2, l.Ratio)
}
func TestUpstreamApplyCreatesAChannelAndRollsBackAnInvalidSelection(t *testing.T) {
	db := upstreamTestDB(t)
	s := UpstreamSource{Name: "new", BaseURL: "https://example.com", RelayKey: "relay-secret", Markup: "1.1"}
	require.NoError(t, db.Create(&s).Error)
	require.NoError(t, SaveUpstreamSnapshot(s.Id, 0, []UpstreamQuote{upstreamQuoteFixture("a")}))
	require.Error(t, ApplyUpstreamSelection(s.Id, 1, []UpstreamProposal{{Model: "absent", Ratio: 0.11}}))
	var count int64
	require.NoError(t, db.Model(&Channel{}).Count(&count).Error)
	assert.Zero(t, count)
	require.NoError(t, ApplyUpstreamSelection(s.Id, 1, []UpstreamProposal{{Model: "a", Ratio: 0.11, Markup: "1.1", Enabled: true}}))
	require.NoError(t, db.First(&s, s.Id).Error)
	require.Positive(t, s.ChannelId)
	var ch Channel
	require.NoError(t, db.First(&ch, s.ChannelId).Error)
	assert.Equal(t, "a", ch.Models)
	assert.Equal(t, "relay-secret", ch.Key)
}

func TestUpstreamPauseTargetsTheLinkedListingBeforeFirstImport(t *testing.T) {
	db := upstreamTestDB(t)
	s := UpstreamSource{Name: "source", ChannelId: 7, Markup: "1.1"}
	require.NoError(t, db.Create(&s).Error)
	require.NoError(t, SaveUpstreamSnapshot(s.Id, 0, []UpstreamQuote{upstreamQuoteFixture("a")}))
	l := MarketListing{ChannelId: 7, ModelName: "a", Ratio: 0.11, Enabled: true}
	require.NoError(t, db.Create(&l).Error)
	other := MarketListing{ChannelId: 8, ModelName: "a", Ratio: 0.2, Enabled: true}
	require.NoError(t, db.Create(&other).Error)
	require.NoError(t, ReviewUpstreamModels(s.Id, 1, []string{"a"}, true))
	require.NoError(t, db.First(&l, l.Id).Error)
	assert.False(t, l.Enabled)
	assert.Equal(t, 0.11, l.Ratio)
	require.NoError(t, db.First(&other, other.Id).Error)
	assert.True(t, other.Enabled)
}

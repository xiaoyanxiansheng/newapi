package controller

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMerchantDirectoryHidesUnjoinedCandidatesAndRejectsPublishingThem(t *testing.T) {
	db := upstreamControllerDB(t)
	t.Setenv("CRYPTO_SECRET", "merchant-directory-secret")
	snapshot := fmt.Sprintf(`{"keys":[{"id":567,"read_time":%d,"joined_routes":[{"listing_id":287,"base_model":"claude-opus-5-5","listing_alias":"claude-opus-5-5@s1c13"},{"listing_id":581,"base_model":"claude-opus-5-5","listing_alias":"claude-opus-5-5@s46c260"}]}]}`, common.GetTimestamp())
	sealed, err := common.SealUpstreamSecret(snapshot)
	require.NoError(t, err)
	account := model.UpstreamAccount{BrowserDiscovery: model.UpstreamDiscoveryStorage(sealed)}
	require.NoError(t, db.Create(&account).Error)
	source := model.UpstreamSource{AccountId: account.Id, RemoteKeyId: 567, PricingMode: "model_routes", KeyStatus: 1, LatestTime: 100, Markup: "1.1"}
	require.NoError(t, db.Create(&source).Error)
	quotes := []model.UpstreamQuote{}
	for _, r := range []struct {
		id    int
		alias string
	}{{287, "claude-opus-5-5@s1c13"}, {581, "claude-opus-5-5@s46c260"}, {749, "claude-opus-5-5@s1c299"}} {
		q := model.UpstreamQuote{Model: r.alias, BaseModel: "claude-opus-5-5", ListingID: r.id, PriceCNYPerUSD: "6.8896", PricingMode: "model_routes", Currency: "CNY", Unit: "per_million_tokens", Original: model.UpstreamPrices{Input: "4", Output: "20"}, Cost: model.UpstreamPrices{Input: "2.88", Output: "14.4"}}
		quotes = append(quotes, q)
		raw, err := common.Marshal(q)
		require.NoError(t, err)
		require.NoError(t, db.Create(&model.UpstreamReview{SourceId: source.Id, ModelName: q.Model, QuoteJSON: string(raw)}).Error)
	}
	raw, err := common.Marshal(quotes)
	require.NoError(t, err)
	source.LatestJSON = string(raw)
	require.NoError(t, db.Save(&source).Error)
	result := upstreamControllerCall(t, GetUpstreamSource, http.MethodGet, "/", source.Id, nil)
	require.Equal(t, true, result["success"])
	data := result["data"].(map[string]any)
	rows := data["rows"].([]any)
	require.Len(t, rows, 2)
	_, err = service.PreviewUpstreamSelection(source, source.Revision, map[string]string{"claude-opus-5-5@s1c299": ""})
	require.Error(t, err)
	// Old raw-USD snapshots must not be publishable after the CNY repair.
	quotes[0].PriceCNYPerUSD = ""
	raw, err = common.Marshal(quotes)
	require.NoError(t, err)
	source.LatestJSON = string(raw)
	preview, err := service.PreviewUpstreamSelection(source, source.Revision, map[string]string{quotes[0].Model: ""})
	assert.True(t, err != nil || (len(preview.Proposals) > 0 && preview.Proposals[0].Issue != ""))
}

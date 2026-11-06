package billingexpr

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestScalePricesPreservesBoundaryCacheAndRequestRules(t *testing.T) {
	original := `v1:(len < 272000 ? tier("standard", p * 5 + c * 30 + cr * 0.5 + cc * 6.25 + cc1h * 10) : tier("long", p * 10 + c * 45 + cr * 1 + cc * 12.5 + cc1h * 20)) * (param("service_tier") == "fast" ? 2 : 1)`
	sale, err := ScalePrices(original, "0.242")
	require.NoError(t, err)
	require.Contains(t, sale, "272000")
	require.Contains(t, sale, "p * 1.21")
	require.NotContains(t, sale, ") * 0.242")
	for _, length := range []float64{271999, 272000, 272001} {
		for _, body := range []string{`{}`, `{"service_tier":"fast"}`} {
			params := TokenParams{P: 5000, C: 1000, CR: 200000, CC: 60000, CC1h: 7000, Len: length}
			request := RequestInput{Body: []byte(body)}
			a, before, err := RunExprWithRequest(original, params, request)
			require.NoError(t, err)
			b, after, err := RunExprWithRequest(sale, params, request)
			require.NoError(t, err)
			require.InDelta(t, a*0.242, b, 0.000001)
			require.Equal(t, before.MatchedTier, after.MatchedTier)
			require.Equal(t, before.RequestRules, after.RequestRules)
		}
	}
}
func TestScalePricesPreservesTimeRulesAndRejectsIncompleteContract(t *testing.T) {
	expression := `tier("off-peak", p * 1 + c * 4 + cr * 0.02) * (hour("Asia/Shanghai") >= 9 ? 2 : 1)`
	sale, err := ScalePrices(expression, "0.11")
	require.NoError(t, err)
	require.Contains(t, sale, `hour("Asia/Shanghai") >= 9 ? 2 : 1`)
	for _, bad := range []string{"", "p * c", "v2:p * 5", "p *"} {
		_, err := ScalePrices(bad, "1.1")
		require.Error(t, err)
	}
}

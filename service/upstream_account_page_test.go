package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpstreamKeyPagePreservesRouteAndDerivesCanonicalOrigin(t *testing.T) {
	for _, tc := range []struct{ input, origin, page string }{
		{" https://CCTQ.ai:443/console/token?view=all#keys ", "https://www.cctq.ai", "https://www.cctq.ai/console/token?view=all#keys"},
		{"https://XXAPI.info/console/token", "https://xxapi.info", "https://xxapi.info/console/token"},
		{"https://unknown.example:8443/#/keys", "https://unknown.example:8443", "https://unknown.example:8443/#/keys"},
	} {
		t.Run(tc.input, func(t *testing.T) {
			origin, page, err := ParseUpstreamKeyPage(tc.input)
			require.NoError(t, err)
			assert.Equal(t, tc.origin, origin)
			assert.Equal(t, tc.page, page)
		})
	}
	assert.Equal(t, "browser-auto-v1", UpstreamAccountWorkflow("https://unknown.example:8443"))
}

func TestUpstreamKeyPageRejectsInvalidOrCredentialBearingURLs(t *testing.T) {
	for _, input := range []string{"", "https:///keys", "http://xxapi.info/keys", "https://owner:password@xxapi.info/keys", "javascript:alert(1)", "https://xxapi.info/" + strings.Repeat("a", 2048)} {
		_, _, err := ParseUpstreamKeyPage(input)
		require.Error(t, err)
	}
}

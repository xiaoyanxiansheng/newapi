package common

import (
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func TestUpstreamCredentialsRequirePersistentEncryptionAndRejectWrongServerSecret(t *testing.T) {
	t.Setenv("CRYPTO_SECRET", "")
	t.Setenv("SESSION_SECRET", "")
	_, err := SealUpstreamSecret("saved-password")
	require.Error(t, err)
	t.Setenv("CRYPTO_SECRET", "persistent-test-secret-123")
	sealed, err := SealUpstreamSecret("saved-password")
	require.NoError(t, err)
	assert.False(t, strings.Contains(sealed, "saved-password"))
	second, err := SealUpstreamSecret("saved-password")
	require.NoError(t, err)
	assert.NotEqual(t, sealed, second)
	value, err := OpenUpstreamSecret(sealed)
	require.NoError(t, err)
	assert.Equal(t, "saved-password", value)
	t.Setenv("CRYPTO_SECRET", "different-server-secret-123")
	_, err = OpenUpstreamSecret(sealed)
	require.Error(t, err)
	_, err = OpenUpstreamSecret("plaintext-key")
	require.Error(t, err)
}

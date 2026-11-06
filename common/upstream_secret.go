package common

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"strings"
)

func upstreamSecretCipher() (cipher.AEAD, error) {
	secret := os.Getenv("CRYPTO_SECRET")
	if secret == "" {
		secret = os.Getenv("SESSION_SECRET")
	}
	if len(secret) < 16 {
		return nil, errors.New("configure a persistent CRYPTO_SECRET before saving upstream credentials")
	}
	key := sha256.Sum256([]byte("hwjai-upstream-credentials:" + secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func SealUpstreamSecret(value string) (string, error) {
	aead, err := upstreamSecretCipher()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nonce, nonce, []byte(value), []byte("upstream-v1"))
	return "sealed:v1:" + base64.RawStdEncoding.EncodeToString(sealed), nil
}

func OpenUpstreamSecret(value string) (string, error) {
	if !strings.HasPrefix(value, "sealed:v1:") {
		return "", errors.New("upstream credential is not encrypted")
	}
	aead, err := upstreamSecretCipher()
	if err != nil {
		return "", err
	}
	data, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(value, "sealed:v1:"))
	if err != nil || len(data) < aead.NonceSize() {
		return "", errors.New("invalid encrypted upstream credential")
	}
	plain, err := aead.Open(nil, data[:aead.NonceSize()], data[aead.NonceSize():], []byte("upstream-v1"))
	if err != nil {
		return "", errors.New("upstream credential cannot be decrypted with the current server secret")
	}
	return string(plain), nil
}

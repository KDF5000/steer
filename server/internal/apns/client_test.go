package apns

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testClient(t *testing.T) (*Client, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "AuthKey.p8")
	if err := os.WriteFile(file, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := New(Config{KeyFile: file, KeyID: "key-123", TeamID: "team-123", Topic: "com.steer.watch"})
	if err != nil {
		t.Fatal(err)
	}
	return c, key
}
func TestProviderJWTAndPayload(t *testing.T) {
	c, key := testClient(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/3/device/token-1" || r.Header.Get("apns-topic") != "com.steer.watch" || r.Header.Get("apns-push-type") != "alert" {
			t.Error("incorrect APNs destination or headers")
		}
		parts := strings.Split(strings.TrimPrefix(r.Header.Get("authorization"), "bearer "), ".")
		if len(parts) != 3 {
			t.Error("invalid JWT")
			w.WriteHeader(500)
			return
		}
		signature, err := base64.RawURLEncoding.DecodeString(parts[2])
		if err != nil || len(signature) != 64 {
			t.Error("invalid signature")
			return
		}
		hash := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
		if !ecdsa.Verify(&key.PublicKey, hash[:], new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])) {
			t.Error("signature does not verify")
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload["conversationId"] != "session-1" {
			t.Error("notification lost task route")
		}
		w.WriteHeader(200)
	}))
	defer server.Close()
	c.endpoint = server.URL
	if err := c.Send(context.Background(), "token-1", "sandbox", "delivery-1", "task-1", map[string]any{"conversationId": "session-1", "aps": map[string]any{"alert": "done"}}); err != nil {
		t.Fatal(err)
	}
	first, err := c.authorization()
	if err != nil {
		t.Fatal(err)
	}
	second, _ := c.authorization()
	if first != second {
		t.Error("provider token was unnecessarily regenerated")
	}
}
func TestInvalidDeviceAndPayloadLimit(t *testing.T) {
	c, _ := testClient(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(410)
		_, _ = w.Write([]byte(`{"reason":"Unregistered"}`))
	}))
	defer server.Close()
	c.endpoint = server.URL
	err := c.Send(context.Background(), "token", "production", "delivery", "collapse", map[string]any{"aps": map[string]string{"alert": "done"}})
	var rejected Error
	if !errors.As(err, &rejected) || !rejected.InvalidToken() {
		t.Fatalf("invalid token was not recognized: %v", err)
	}
	if err := c.Send(context.Background(), "token", "sandbox", "delivery", "collapse", strings.Repeat("x", 5000)); err == nil {
		t.Error("oversize payload accepted")
	}
}

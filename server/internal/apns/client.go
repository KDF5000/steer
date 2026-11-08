package apns

import (
	"bytes"
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
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type Config struct{ KeyFile, KeyID, TeamID, Topic string }
type Client struct {
	config   Config
	key      *ecdsa.PrivateKey
	http     *http.Client
	mu       sync.Mutex
	jwt      string
	issued   time.Time
	endpoint string
}

func New(c Config) (*Client, error) {
	if c.KeyFile == "" || c.KeyID == "" || c.TeamID == "" || c.Topic == "" {
		return nil, errors.New("APNs key file, key ID, team ID and topic are required")
	}
	data, err := os.ReadFile(c.KeyFile)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, errors.New("APNs key is not PEM encoded")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok || key.Curve != elliptic.P256() {
		return nil, errors.New("APNs key must use ECDSA P-256")
	}
	return &Client{config: c, key: key, http: &http.Client{Timeout: 20 * time.Second}}, nil
}
func (c *Client) Topic() string { return c.config.Topic }
func (c *Client) authorization() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	if c.jwt != "" && now.Sub(c.issued) < 20*time.Minute {
		return c.jwt, nil
	}
	header, _ := json.Marshal(map[string]string{"alg": "ES256", "kid": c.config.KeyID})
	claims, _ := json.Marshal(map[string]any{"iss": c.config.TeamID, "iat": now.Unix()})
	encode := base64.RawURLEncoding.EncodeToString
	unsigned := encode(header) + "." + encode(claims)
	digest := sha256.Sum256([]byte(unsigned))
	r, s, err := ecdsa.Sign(rand.Reader, c.key, digest[:])
	if err != nil {
		return "", err
	}
	signature := make([]byte, 64)
	r.FillBytes(signature[:32])
	s.FillBytes(signature[32:])
	c.jwt = unsigned + "." + encode(signature)
	c.issued = now
	return c.jwt, nil
}

type Error struct {
	Status int
	Reason string
}

func (e Error) Error() string {
	return fmt.Sprintf("APNs rejected delivery: %d %s", e.Status, e.Reason)
}
func (e Error) InvalidToken() bool {
	return e.Status == 410 || e.Reason == "BadDeviceToken" || e.Reason == "DeviceTokenNotForTopic"
}
func (c *Client) Send(ctx context.Context, token, environment, id, collapse string, payload any) error {
	auth, err := c.authorization()
	if err != nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if len(body) > 4096 {
		return errors.New("APNs payload exceeds 4096 bytes")
	}
	endpoint := "https://api.push.apple.com"
	if environment == "sandbox" {
		endpoint = "https://api.sandbox.push.apple.com"
	}
	if c.endpoint != "" {
		endpoint = c.endpoint
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/3/device/"+token, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("authorization", "bearer "+auth)
	request.Header.Set("apns-topic", c.config.Topic)
	request.Header.Set("apns-push-type", "alert")
	request.Header.Set("apns-priority", "10")
	request.Header.Set("apns-id", id)
	request.Header.Set("apns-collapse-id", collapse)
	request.Header.Set("apns-expiration", fmt.Sprint(time.Now().Add(24*time.Hour).Unix()))
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == 200 {
		return nil
	}
	var result struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&result)
	return Error{Status: response.StatusCode, Reason: strings.TrimSpace(result.Reason)}
}

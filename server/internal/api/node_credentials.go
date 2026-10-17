package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

// Only the host credential travels to Relay. Never return an upstream error
// body here: a proxy or server may include sensitive request information.
func (s *Server) issueRelayNodeCredential(ctx context.Context, nodeID string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	body, err := json.Marshal(map[string]string{"nodeId": nodeID})
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.relayHTTP.BaseURL+"/v1/node-credentials", bytes.NewReader(body))
	if err != nil {
		return "", errors.New("Relay credential endpoint is not configured correctly.")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+s.relayHTTP.Token)
	// Credentials must not follow redirects to a different endpoint.
	client := *s.relayHTTP.HTTP
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		return "", errors.New("Could not obtain a Node credential. Check the Steer Server connection to Relay and try again.")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusMethodNotAllowed || response.StatusCode == http.StatusServiceUnavailable {
		return "", errors.New("Relay does not support Node credential issuance or signing is not configured. Upgrade Relay Server and configure its host and node tokens.")
	}
	if response.StatusCode != http.StatusCreated {
		return "", errors.New("Relay could not issue a Node credential. Check the server-side Relay host token and configuration.")
	}
	var result struct {
		NodeID    string `json:"nodeId"`
		NodeToken string `json:"nodeToken"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 8<<10)).Decode(&result); err != nil || result.NodeID != nodeID || !strings.HasPrefix(result.NodeToken, "relay_node_v1.") || len(result.NodeToken) > 1024 {
		return "", errors.New("Relay returned an invalid Node credential.")
	}
	return result.NodeToken, nil
}

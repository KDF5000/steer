package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIssueRelayNodeCredential(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    int
		body      string
		wantError string
	}{
		{"success", 201, `{"nodeId":"node-a","nodeToken":"relay_node_v1.scoped"}`, ""},
		{"old server", 404, "not found", "Upgrade Relay Server"},
		{"signing disabled", 503, "disabled", "Upgrade Relay Server"},
		{"bad host token", 401, "sensitive-upstream-body", "server-side Relay host token"},
		{"redirect", 307, "", "server-side Relay host token"},
		{"wrong identity", 201, `{"nodeId":"node-b","nodeToken":"relay_node_v1.scoped"}`, "invalid Node credential"},
		{"missing token", 201, `{"nodeId":"node-a"}`, "invalid Node credential"},
		{"global token", 201, `{"nodeId":"node-a","nodeToken":"shared-root"}`, "invalid Node credential"},
		{"invalid response", 201, "not json", "invalid Node credential"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != "/v1/node-credentials" || r.Header.Get("Authorization") != "Bearer host-only" {
					t.Error("incorrect server-side credential request")
				}
				var input struct {
					NodeID string `json:"nodeId"`
				}
				if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.NodeID != "node-a" {
					t.Error("wrong requested Node identity")
				}
				if tc.status == 307 {
					w.Header().Set("Location", "/must-not-follow")
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer relay.Close()
			server := New(nil, relay.URL, "host-only", "", "", nil)
			token, err := server.issueRelayNodeCredential(context.Background(), "node-a")
			if tc.wantError == "" {
				if err != nil || token != "relay_node_v1.scoped" {
					t.Fatalf("credential request failed: %v", err)
				}
			} else if err == nil || !strings.Contains(err.Error(), tc.wantError) || strings.Contains(err.Error(), "sensitive-upstream-body") || token != "" {
				t.Fatalf("unexpected failure: %v", err)
			}
		})
	}
}

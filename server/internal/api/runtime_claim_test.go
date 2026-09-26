package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/KDF5000/relay/controlplane"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestRuntimeDiscoveryAndExplicitClaim(t *testing.T) {
	st, workspaceID := runtimeTestStore(t)
	otherWorkspaceID := "runtime-other-" + uuid.NewString()
	if err := st.EnsureWorkspace(context.Background(), otherWorkspaceID, "Other workspace"); err != nil {
		t.Fatal(err)
	}
	if err := st.AssignRuntime(context.Background(), otherWorkspaceID, "node-a/claimed"); err != nil {
		t.Fatal(err)
	}

	relayServer := runtimeRelayServer(t)
	server := New(st, relayServer.URL, "", relayServer.URL, workspaceID, nil)
	call := func(method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s %s = %d, want %d: %s", method, path, response.Code, want, response.Body.String())
		}
		return response
	}

	var available []controlplane.Node
	if err := json.Unmarshal(call(http.MethodGet, "/api/v1/runtimes/available", "", http.StatusOK).Body.Bytes(), &available); err != nil {
		t.Fatal(err)
	}
	if len(available) != 1 || len(available[0].Runtimes) != 2 {
		t.Fatalf("unexpected available Runtimes: %+v", available)
	}
	for _, runtime := range available[0].Runtimes {
		if runtime.ID == "node-a/claimed" {
			t.Fatalf("assigned Runtime was discoverable: %+v", available)
		}
	}

	call(http.MethodPost, "/api/v1/runtimes/claim-available", `{}`, http.StatusBadRequest)
	call(http.MethodPost, "/api/v1/runtimes/claim-available", `{"runtimeIds":["node-a/claimed"]}`, http.StatusConflict)
	claimed := call(http.MethodPost, "/api/v1/runtimes/claim-available", `{"runtimeIds":["node-a/codex"]}`, http.StatusOK)
	if !strings.Contains(claimed.Body.String(), `"id":"node-a/codex"`) || strings.Contains(claimed.Body.String(), `"id":"node-a/trae"`) {
		t.Fatalf("claim returned the wrong workspace inventory: %s", claimed.Body.String())
	}
	assigned, err := st.RuntimeAssigned(context.Background(), workspaceID, "node-a/codex")
	if err != nil || !assigned {
		t.Fatalf("selected Runtime was not assigned: assigned=%t err=%v", assigned, err)
	}
	remaining := call(http.MethodGet, "/api/v1/runtimes/available", "", http.StatusOK)
	if strings.Contains(remaining.Body.String(), `node-a/codex`) || !strings.Contains(remaining.Body.String(), `node-a/trae`) {
		t.Fatalf("discovery was not updated after claim: %s", remaining.Body.String())
	}
}

func TestRegisterDoesNotAutomaticallyClaimRuntimes(t *testing.T) {
	st, workspaceID := runtimeTestStore(t)
	var nodeRequests atomic.Int32
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/v1/nodes" {
			nodeRequests.Add(1)
			writeJSON(w, http.StatusOK, []map[string]any{{"id": "node-a", "runtimes": []map[string]any{{"id": "node-a/codex", "provider": "codex"}}}})
			return
		}
		http.NotFound(w, r)
	}))
	defer relayServer.Close()

	server := New(st, relayServer.URL, "", relayServer.URL, workspaceID, nil, WithAuthentication(time.Hour))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"runtime-`+uuid.NewString()+`@example.test","password":"password123","displayName":"Runtime owner"}`))
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("register = %d: %s", response.Code, response.Body.String())
	}
	if nodeRequests.Load() != 0 {
		t.Fatalf("registration unexpectedly queried Relay %d times", nodeRequests.Load())
	}
	unassigned, err := st.UnassignedRuntime(context.Background(), "node-a/codex")
	if err != nil || !unassigned {
		t.Fatalf("registration claimed Runtime: unassigned=%t err=%v", unassigned, err)
	}
}

func runtimeTestStore(t *testing.T) (*store.Store, string) {
	t.Helper()
	databaseURL := os.Getenv("STEER_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set STEER_TEST_DATABASE_URL for integration tests")
	}
	st, err := store.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	workspaceID := "runtime-test-" + uuid.NewString()
	if err := st.EnsureWorkspace(context.Background(), workspaceID, "Runtime test"); err != nil {
		t.Fatal(err)
	}
	return st, workspaceID
}

func runtimeRelayServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/v1/nodes" {
			writeJSON(w, http.StatusOK, []map[string]any{{
				"id":       "node-a",
				"state":    "online",
				"capacity": 2,
				"runtimes": []map[string]any{
					{"id": "node-a/codex", "provider": "codex"},
					{"id": "node-a/trae", "provider": "trae"},
					{"id": "node-a/claimed", "provider": "codex"},
				},
			}})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	return server
}

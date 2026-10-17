package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestRuntimeBindingHTTPContract(t *testing.T) {
	databaseURL := os.Getenv("STEER_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set STEER_TEST_DATABASE_URL for integration tests")
	}
	ctx := context.Background()
	st, err := store.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}

	suffix := uuid.NewString()
	user, workspace, _, err := st.CreateUser(ctx, "runtime-"+suffix+"@example.test", "Runtime owner", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	enrollment, err := st.CreateRelayNodeEnrollment(ctx, user.ID, "enrollment-"+suffix, "node_"+suffix, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	nodeID := "node_" + suffix
	node, err := st.EnrollRelayNode(ctx, enrollment.TokenHash, nodeID, "Test Node", 2, "online", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	physicalRuntimeID := nodeID + "/codex"
	if err := st.SyncRelayNode(ctx, node.ID, node.Name, node.Capacity, "online", time.Now(), []store.RelayNodeRuntime{{
		ID: physicalRuntimeID, NodeID: nodeID, Provider: "codex", State: "healthy",
	}}); err != nil {
		t.Fatal(err)
	}
	if err := st.BindRelayNodeRuntimes(ctx, workspace.ID, user.ID, nodeID, []string{physicalRuntimeID}); err != nil {
		t.Fatal(err)
	}
	if err := st.SyncRelayNode(ctx, node.ID, node.Name, node.Capacity, "offline", time.Now(), []store.RelayNodeRuntime{{
		ID: physicalRuntimeID, NodeID: nodeID, Provider: "codex", State: "healthy",
	}}); err != nil {
		t.Fatal(err)
	}
	bindings, err := st.WorkspaceRuntimeBindings(ctx, workspace.ID)
	if err != nil || len(bindings) != 1 {
		t.Fatalf("bindings = %+v: %v", bindings, err)
	}
	bindingID := bindings[0].ID
	agent, err := st.CreateAgent(ctx, workspace.ID, store.Agent{
		Name: "Bound Agent", RuntimeProvider: "codex", RuntimeID: &bindingID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteOwnedRelayNode(ctx, user.ID, nodeID); !errors.Is(err, store.ErrRelayNodeReferenced) {
		t.Fatalf("delete referenced offline Node = %v, want %v", err, store.ErrRelayNodeReferenced)
	}

	removableEnrollment, err := st.CreateRelayNodeEnrollment(ctx, user.ID, "removable-"+suffix, "removable-node-"+suffix, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	removableNodeID := "removable-node-" + suffix
	removableNode, err := st.EnrollRelayNode(ctx, removableEnrollment.TokenHash, removableNodeID, "Removable Node", 1, "offline", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	removableRuntimeID := removableNodeID + "/codex"
	if err := st.SyncRelayNode(ctx, removableNode.ID, removableNode.Name, removableNode.Capacity, "offline", time.Now(), []store.RelayNodeRuntime{{
		ID: removableRuntimeID, NodeID: removableNodeID, Provider: "codex", State: "healthy",
	}}); err != nil {
		t.Fatal(err)
	}
	if err := st.BindRelayNodeRuntimes(ctx, workspace.ID, user.ID, removableNodeID, []string{removableRuntimeID}); err != nil {
		t.Fatal(err)
	}
	bindingsBeforeRemoval, err := st.WorkspaceRuntimeBindings(ctx, workspace.ID)
	if err != nil {
		t.Fatal(err)
	}
	var removableBindingID string
	for _, binding := range bindingsBeforeRemoval {
		if binding.NodeRuntimeID == removableRuntimeID {
			removableBindingID = binding.ID
			break
		}
	}
	if removableBindingID == "" {
		t.Fatal("removable Runtime binding was not created")
	}
	conversationID := "removable-conversation-" + suffix
	if _, err := st.EnsureSession(ctx, workspace.ID, conversationID, "Preserved conversation", agent.ID, nil, &removableBindingID, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteOwnedRelayNode(ctx, user.ID, removableNodeID); err != nil {
		t.Fatalf("delete offline Node referenced only by a conversation: %v", err)
	}
	remainingBindings, err := st.WorkspaceRuntimeBindings(ctx, workspace.ID)
	if err != nil || len(remainingBindings) != 1 || remainingBindings[0].ID != bindingID {
		t.Fatalf("bindings after removable Node deletion = %+v: %v", remainingBindings, err)
	}
	preservedConversation, err := st.Session(ctx, workspace.ID, conversationID)
	if err != nil || preservedConversation.ExecutionRuntimeID != nil {
		t.Fatalf("conversation after Runtime removal = %+v: %v", preservedConversation, err)
	}

	var mu sync.Mutex
	var submitted relay.Request
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/node-credentials":
			var input struct {
				NodeID string `json:"nodeId"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
			}
			writeJSON(w, http.StatusCreated, map[string]string{"nodeId": input.NodeID, "nodeToken": "relay_node_v1.test-scoped-credential"})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/nodes":
			writeJSON(w, http.StatusOK, []map[string]any{{
				"id": nodeID, "state": "online", "capacity": 2,
				"runtimes": []map[string]any{{"id": physicalRuntimeID, "provider": "codex", "state": "healthy"}},
			}})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/runs":
			var request relay.Request
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			mu.Lock()
			submitted = request
			defer mu.Unlock()
			writeJSON(w, http.StatusAccepted, map[string]any{"id": uuid.NewString(), "status": "running"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer relayServer.Close()

	rawSession := "session-" + suffix
	if err := st.CreateAuthSession(ctx, user.ID, tokenHash(rawSession), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	handler := New(st, relayServer.URL, "", relayServer.URL, "unused", nil, WithAuthentication(time.Hour)).Handler()
	call := func(method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Steer-Workspace", workspace.ID)
		request.AddCookie(&http.Cookie{Name: authCookieName, Value: rawSession})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s %s = %d, want %d: %s", method, path, response.Code, want, response.Body.String())
		}
		return response
	}
	var generatedEnrollment struct {
		NodeToken string    `json:"nodeToken"`
		Token     string    `json:"token"`
		NodeID    string    `json:"nodeId"`
		ExpiresAt time.Time `json:"expiresAt"`
	}
	enrollmentResponse := call(http.MethodPost, "/relay-node-enrollments", "", http.StatusCreated)
	if enrollmentResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("credential response may be cached")
	}
	if err := json.Unmarshal(enrollmentResponse.Body.Bytes(), &generatedEnrollment); err != nil {
		t.Fatal(err)
	}
	if generatedEnrollment.NodeToken != "relay_node_v1.test-scoped-credential" || !strings.HasPrefix(generatedEnrollment.Token, "steer_enr_") || !strings.HasPrefix(generatedEnrollment.NodeID, "node_") || generatedEnrollment.ExpiresAt.Before(time.Now()) {
		t.Fatalf("invalid generated enrollment: %+v", generatedEnrollment)
	}
	claimBody := `{"token":"` + generatedEnrollment.Token + `","nodeId":"` + generatedEnrollment.NodeID + `","name":"Claimed Node","capacity":2}`
	call(http.MethodPost, "/relay-node-enrollments/claim", strings.Replace(claimBody, generatedEnrollment.NodeID, nodeID, 1), http.StatusUnauthorized)
	publicRequest := httptest.NewRequest(http.MethodPost, "/api/v1/relay-node-enrollments/claim", strings.NewReader(claimBody))
	publicRequest.Header.Set("Content-Type", "application/json")
	publicResponse := httptest.NewRecorder()
	handler.ServeHTTP(publicResponse, publicRequest)
	if publicResponse.Code != http.StatusCreated {
		t.Fatalf("public enrollment claim = %d: %s", publicResponse.Code, publicResponse.Body.String())
	}
	var ownedNodes []struct {
		ID       string            `json:"id"`
		Runtimes []json.RawMessage `json:"runtimes"`
	}
	if err := json.Unmarshal(call(http.MethodGet, "/relay-nodes", "", http.StatusOK).Body.Bytes(), &ownedNodes); err != nil {
		t.Fatal(err)
	}
	claimedNodeFound := false
	for _, node := range ownedNodes {
		if node.ID == nodeID {
			t.Fatalf("fully bound Node %q was returned as available", nodeID)
		}
		if node.ID != generatedEnrollment.NodeID {
			continue
		}
		claimedNodeFound = true
		if node.Runtimes == nil || len(node.Runtimes) != 0 {
			t.Fatalf("new offline Node runtimes = %#v, want an empty JSON array", node.Runtimes)
		}
	}
	if !claimedNodeFound {
		t.Fatalf("claimed Node %q is missing from the owner's Node list", generatedEnrollment.NodeID)
	}
	call(http.MethodDelete, "/relay-nodes/"+nodeID, "", http.StatusConflict)
	call(http.MethodDelete, "/relay-nodes/"+generatedEnrollment.NodeID, "", http.StatusNoContent)
	if strings.Contains(call(http.MethodGet, "/relay-nodes", "", http.StatusOK).Body.String(), generatedEnrollment.NodeID) {
		t.Fatalf("removed offline Node %q is still listed", generatedEnrollment.NodeID)
	}
	publicRequest = httptest.NewRequest(http.MethodPost, "/api/v1/relay-node-enrollments/claim", strings.NewReader(claimBody))
	publicRequest.Header.Set("Content-Type", "application/json")
	publicResponse = httptest.NewRecorder()
	handler.ServeHTTP(publicResponse, publicRequest)
	if publicResponse.Code != http.StatusUnauthorized {
		t.Fatalf("reused enrollment claim = %d, want %d: %s", publicResponse.Code, http.StatusUnauthorized, publicResponse.Body.String())
	}

	var bootstrap struct {
		Relay struct {
			Nodes []struct {
				Labels   map[string]string `json:"labels"`
				Runtimes []struct {
					ID string `json:"id"`
				} `json:"runtimes"`
			} `json:"nodes"`
		} `json:"relay"`
	}
	if err := json.Unmarshal(call(http.MethodGet, "/bootstrap", "", http.StatusOK).Body.Bytes(), &bootstrap); err != nil {
		t.Fatal(err)
	}
	if len(bootstrap.Relay.Nodes) != 1 || len(bootstrap.Relay.Nodes[0].Runtimes) != 1 || bootstrap.Relay.Nodes[0].Runtimes[0].ID != bindingID {
		t.Fatalf("bootstrap exposed a physical Runtime instead of its binding: %+v", bootstrap.Relay.Nodes)
	}
	if bootstrap.Relay.Nodes[0].Labels["name"] != "Test Node" {
		t.Fatalf("bootstrap Node name = %q, want %q", bootstrap.Relay.Nodes[0].Labels["name"], "Test Node")
	}
	var updatedAgent store.Agent
	if err := json.Unmarshal(call(http.MethodPut, "/agents/"+agent.ID, `{"name":"Rebound Agent","role":"General execution","instructions":"","runtimeProvider":"codex","runtimeId":"`+bindingID+`","model":null}`, http.StatusOK).Body.Bytes(), &updatedAgent); err != nil {
		t.Fatal(err)
	}
	if updatedAgent.RuntimeID == nil || *updatedAgent.RuntimeID != bindingID {
		t.Fatalf("updated Agent Runtime = %+v, want binding %q", updatedAgent.RuntimeID, bindingID)
	}

	call(http.MethodPost, "/tasks", `{"prompt":"Verify binding","agentId":"`+agent.ID+`"}`, http.StatusAccepted)
	mu.Lock()
	actualRuntimeID := submitted.Runtime.ID
	mu.Unlock()
	if actualRuntimeID != physicalRuntimeID {
		t.Fatalf("Relay received Runtime %q, want physical Runtime %q", actualRuntimeID, physicalRuntimeID)
	}
	call(http.MethodDelete, "/runtime-bindings/"+bindingID, "", http.StatusConflict)
}

package api

import (
	"context"
	"encoding/json"
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

func TestTaskAPIHTTPAndChatCompatibility(t *testing.T) {
	databaseURL := os.Getenv("STEER_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set STEER_TEST_DATABASE_URL for integration tests")
	}
	st, err := store.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	wid := "task-http-" + uuid.NewString()
	otherWorkspaceID := "task-http-other-" + uuid.NewString()
	if err := st.EnsureWorkspace(context.Background(), wid, "Task HTTP test"); err != nil {
		t.Fatal(err)
	}
	if err := st.EnsureWorkspace(context.Background(), otherWorkspaceID, "Other workspace"); err != nil {
		t.Fatal(err)
	}
	agent, err := st.CreateAgent(context.Background(), wid, store.Agent{Name: "API Agent", RuntimeProvider: "test"})
	if err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	relayRequests := []relay.Request{}
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/runs":
			var request relay.Request
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, "invalid", http.StatusBadRequest)
				return
			}
			mu.Lock()
			relayRequests = append(relayRequests, request)
			mu.Unlock()
			writeJSON(w, http.StatusAccepted, map[string]any{"id": uuid.NewString(), "status": "running"})
		case r.URL.Path == "/v1/nodes":
			writeJSON(w, http.StatusOK, []map[string]any{{"id": "test-node", "runtimes": []map[string]any{{"id": "test-node/test", "provider": "test"}}}})
		case strings.HasSuffix(r.URL.Path, "/events") || strings.HasSuffix(r.URL.Path, "/artifacts"):
			writeJSON(w, http.StatusOK, []any{})
		case strings.HasPrefix(r.URL.Path, "/v1/runs/"):
			writeJSON(w, http.StatusOK, map[string]any{"id": strings.TrimPrefix(r.URL.Path, "/v1/runs/"), "status": "succeeded", "result": map[string]string{"summary": "Done"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer relayServer.Close()
	server := New(st, relayServer.URL, "", relayServer.URL, wid, nil)
	handler := server.Handler()
	call := func(method, path, body, idempotencyKey, workspaceID string, want int) map[string]any {
		t.Helper()
		request := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		if idempotencyKey != "" {
			request.Header.Set("Idempotency-Key", idempotencyKey)
		}
		if workspaceID != "" {
			request.Header.Set("X-Steer-Workspace", workspaceID)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s %s = %d, want %d: %s", method, path, response.Code, want, response.Body.String())
		}
		var decoded map[string]any
		_ = json.Unmarshal(response.Body.Bytes(), &decoded)
		return decoded
	}

	key := "request-" + uuid.NewString()
	first := call(http.MethodPost, "/tasks", `{"prompt":"First","agentId":"`+agent.ID+`"}`, key, "", http.StatusAccepted)
	taskID, _ := first["taskId"].(string)
	conversationID, _ := first["conversationId"].(string)
	if taskID == "" || conversationID == "" || first["sessionId"] != conversationID {
		t.Fatalf("task response lost compatibility aliases: %+v", first)
	}
	replayed := call(http.MethodPost, "/tasks", `{"prompt":"First","agentId":"`+agent.ID+`"}`, key, "", http.StatusOK)
	if replayed["taskId"] != taskID {
		t.Fatalf("idempotent retry created another task: %+v", replayed)
	}
	call(http.MethodGet, "/tasks/"+taskID, "", "", "", http.StatusOK)
	continued := call(http.MethodPost, "/conversations/"+conversationID+"/tasks", `{"prompt":"Continue","agentId":"`+agent.ID+`"}`, "request-"+uuid.NewString(), "", http.StatusAccepted)
	if continued["conversationId"] != conversationID {
		t.Fatalf("continuation changed conversation: %+v", continued)
	}
	call(http.MethodGet, "/tasks/"+taskID, "", "", otherWorkspaceID, http.StatusNotFound)

	legacy := call(http.MethodPost, "/chat", `{"prompt":"Legacy","agentId":"`+agent.ID+`"}`, "", "", http.StatusAccepted)
	if len(legacy) != 5 || legacy["taskId"] != nil || legacy["sessionId"] == nil || legacy["runId"] == nil || legacy["userMessage"] == nil || legacy["assistantMessage"] == nil {
		t.Fatalf("legacy /chat response changed: %+v", legacy)
	}

	mu.Lock()
	sent := append([]relay.Request(nil), relayRequests...)
	mu.Unlock()
	if len(sent) != 3 || sent[0].SessionID != conversationID || sent[1].SessionID != conversationID || sent[1].Input.ContinuationPrompt != "Continue" || sent[0].Source.Kind != "steer.task" || sent[2].Source.Kind != "steer.chat" {
		t.Fatalf("Relay conversation continuity changed: %+v", sent)
	}

	// Changing only the model preserves Relay's native session identity and the
	// Agent configuration, while the conversation remembers its override.
	call(http.MethodPost, "/conversations/"+conversationID+"/tasks", `{"prompt":"Switch model","agentId":"`+agent.ID+`","model":"alternate-model"}`, "model-"+uuid.NewString(), "", http.StatusAccepted)
	modelSession, err := st.Session(context.Background(), wid, conversationID)
	if err != nil || modelSession.ModelOverride == nil || *modelSession.ModelOverride != "alternate-model" {
		t.Fatalf("model override was not persisted: %+v %v", modelSession, err)
	}
	call(http.MethodPost, "/conversations/"+conversationID+"/tasks", `{"prompt":"Keep model","agentId":"`+agent.ID+`"}`, "model-"+uuid.NewString(), "", http.StatusAccepted)
	mu.Lock()
	modelTurns := append([]relay.Request(nil), relayRequests[len(relayRequests)-2:]...)
	mu.Unlock()
	for _, turn := range modelTurns {
		if turn.Runtime.Model != "alternate-model" || turn.SessionID != conversationID || turn.AgentID != sent[0].AgentID || turn.Runtime.ID != sent[0].Runtime.ID {
			t.Fatalf("model switch changed native session identity: %+v", turn)
		}
	}
	messages, err := st.Messages(context.Background(), wid, conversationID)
	if err != nil || messages[len(messages)-1].Context.Model != "alternate-model" {
		t.Fatalf("turn did not snapshot model: %+v %v", messages, err)
	}
	call(http.MethodPost, "/conversations/"+conversationID+"/tasks", `{"prompt":"Follow default","agentId":"`+agent.ID+`","model":""}`, "model-"+uuid.NewString(), "", http.StatusAccepted)
	modelSession, err = st.Session(context.Background(), wid, conversationID)
	if err != nil || modelSession.ModelOverride != nil {
		t.Fatalf("restoring default retained override: %+v %v", modelSession, err)
	}
	unchangedAgent, err := st.Agent(context.Background(), wid, agent.ID)
	if err != nil || unchangedAgent.Model != nil {
		t.Fatalf("conversation override changed Agent default: %+v %v", unchangedAgent, err)
	}

	readToken := "steer_sk_test_" + uuid.NewString()
	if _, err := st.CreateWorkspaceAPIKey(context.Background(), store.WorkspaceAPIKey{
		WorkspaceID: wid, Name: "Read only", TokenHash: tokenHash(readToken), TokenPrefix: "steer_sk_test", Scopes: []string{"tasks:read"}, CreatedByUserID: "test-user",
	}); err != nil {
		t.Fatal(err)
	}
	authenticated := New(st, relayServer.URL, "", relayServer.URL, "unused", nil, WithAuthentication(time.Hour)).Handler()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/"+taskID, nil)
	request.Header.Set("Authorization", "Bearer "+readToken)
	response := httptest.NewRecorder()
	authenticated.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("read-scoped API key could not read task: %d %s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodPost, "/api/v1/tasks", strings.NewReader(`{"prompt":"Denied","agentId":"`+agent.ID+`"}`))
	request.Header.Set("Authorization", "Bearer "+readToken)
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	authenticated.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("read-scoped API key submitted a task: %d %s", response.Code, response.Body.String())
	}
}

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

// Exercise the Chat-first HTTP contract with real PostgreSQL and a fake Relay.
func TestConversationWorkflowHTTP(t *testing.T) {
	databaseURL := os.Getenv("STEER_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set STEER_TEST_DATABASE_URL for integration tests")
	}
	st, err := store.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err = st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	wid := "http-test-" + uuid.NewString()
	if err = st.EnsureWorkspace(context.Background(), wid, "HTTP test"); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	requests := []relay.Request{}
	const content = "## Report\n\n| Check | Result |\n| --- | --- |\n| Sources | Verified |"
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/v1/runs":
			var in relay.Request
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				http.Error(w, "invalid", 400)
				return
			}
			mu.Lock()
			requests = append(requests, in)
			mu.Unlock()
			writeJSON(w, 202, map[string]any{"id": uuid.NewString(), "status": "running"})
		case r.URL.Path == "/v1/nodes":
			writeJSON(w, 200, []map[string]any{{"id": "test-node", "runtimes": []map[string]any{{"id": "test-node/test", "provider": "test"}}}})
		case strings.HasSuffix(r.URL.Path, "/events"):
			writeJSON(w, 200, []any{})
		case strings.HasSuffix(r.URL.Path, "/artifacts"):
			id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/runs/"), "/artifacts")
			writeJSON(w, 200, []map[string]any{{"id": "artifact-" + id, "name": "report.md", "type": "report", "content_type": "text/markdown", "size": len(content)}})
		case strings.HasPrefix(r.URL.Path, "/v1/artifacts/"):
			fmt.Fprint(w, content)
		case strings.HasPrefix(r.URL.Path, "/v1/runs/"):
			writeJSON(w, 200, map[string]any{"id": strings.TrimPrefix(r.URL.Path, "/v1/runs/"), "status": "succeeded", "result": map[string]string{"summary": "Done"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer relayServer.Close()
	handler := New(st, relayServer.URL, "", relayServer.URL, wid, nil).Handler()
	call := func(method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s = %d, want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w
	}
	var agent store.Agent
	json.Unmarshal(call("POST", "/agents", `{"name":"Executor","runtimeProvider":"test"}`, 201).Body.Bytes(), &agent)
	var reviewer store.Agent
	json.Unmarshal(call("POST", "/agents", `{"name":"Reviewer","runtimeProvider":"test"}`, 201).Body.Bytes(), &reviewer)
	var project store.Project
	json.Unmarshal(call("POST", "/projects", `{"name":"Remote repository","workspaceKind":"local","workspaceSource":"/srv/repository","runtimeId":"test-node/test"}`, 201).Body.Bytes(), &project)
	var started struct{ SessionID, RunID string }
	json.Unmarshal(call("POST", "/chat", fmt.Sprintf(`{"prompt":"Inspect","agentId":%q,"projectId":%q}`, agent.ID, project.ID), 202).Body.Bytes(), &started)
	call("POST", "/chat", fmt.Sprintf(`{"prompt":"Continue","agentId":%q,"sessionId":%q}`, reviewer.ID, started.SessionID), 202)
	call("GET", "/runs/"+started.RunID, "", 200)
	mu.Lock()
	sent := append([]relay.Request(nil), requests...)
	mu.Unlock()
	if len(sent) != 2 || sent[0].Workspace.Source != "/srv/repository" || sent[1].Workspace.Source != "/srv/repository" || !strings.Contains(sent[0].Input.Prompt, "direct working conversation") {
		t.Fatalf("conversation context not propagated: %+v", sent)
	}
	if sent[1].AgentID != reviewer.ID || sent[1].Runtime.Provider != "test" || sent[1].Runtime.ID != "test-node/test" {
		t.Fatalf("Agent switch not propagated: %+v", sent[1])
	}
	call("PUT", "/projects/"+project.ID, `{"name":"Moved repository","workspaceKind":"local","workspaceSource":"/srv/moved","runtimeId":"test-node/test","executionMode":"in_place"}`, 200)
	call("DELETE", "/projects/"+project.ID, "", 200)
	call("POST", "/chat", fmt.Sprintf(`{"prompt":"After deletion","agentId":%q,"sessionId":%q}`, reviewer.ID, started.SessionID), 202)
	mu.Lock()
	sent = append([]relay.Request(nil), requests...)
	mu.Unlock()
	if len(sent) != 3 || sent[2].Workspace.Source != "/srv/repository" {
		t.Fatalf("existing conversation did not retain its Project snapshot: %+v", sent)
	}
	var bootstrap struct {
		Artifacts []store.Artifact `json:"artifacts"`
		Sessions  []store.Session  `json:"sessions"`
		Projects  []store.Project  `json:"projects"`
	}
	json.Unmarshal(call("GET", "/bootstrap", "", 200).Body.Bytes(), &bootstrap)
	if len(bootstrap.Artifacts) != 1 || len(bootstrap.Sessions) != 1 {
		t.Fatalf("incomplete projection: %+v", bootstrap)
	}
	if len(bootstrap.Projects) != 0 {
		t.Fatalf("deleted Project remains visible: %+v", bootstrap.Projects)
	}
	if bootstrap.Sessions[0].AgentID != reviewer.ID {
		t.Fatalf("session did not retain latest Agent: %+v", bootstrap.Sessions[0])
	}
	artifact := bootstrap.Artifacts[0]
	var preview struct {
		Content string `json:"content"`
	}
	json.Unmarshal(call("GET", "/artifacts/"+artifact.ID+"/content", "", 200).Body.Bytes(), &preview)
	if preview.Content != content {
		t.Fatalf("preview was not file content: %q", preview.Content)
	}
}

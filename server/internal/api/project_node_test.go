package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestProjectMachineSupportsDifferentRuntimeConversations(t *testing.T) {
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
	wid := "project-machine-" + uuid.NewString()
	if err := st.EnsureWorkspace(ctx, wid, "Machine project"); err != nil {
		t.Fatal(err)
	}
	requests := []relay.Request{}
	nodes := []map[string]any{
		{"id": "machine-a", "runtimes": []map[string]any{{"id": "machine-a/trae", "provider": "trae"}, {"id": "machine-a/codex", "provider": "codex"}}},
		{"id": "machine-b", "runtimes": []map[string]any{{"id": "machine-b/codex", "provider": "codex"}}},
	}
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/nodes":
			writeJSON(w, 200, nodes)
		case r.URL.Path == "/v1/runs" && r.Method == http.MethodPost:
			var request relay.Request
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			requests = append(requests, request)
			writeJSON(w, 202, map[string]any{"id": uuid.NewString(), "status": "succeeded"})
		default:
			writeJSON(w, 200, []any{})
		}
	}))
	defer relayServer.Close()
	server := New(st, relayServer.URL, "", relayServer.URL, wid, nil)
	handler := server.Handler()
	call := func(method, path, body string, want int) []byte {
		t.Helper()
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body)))
		if response.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, response.Code, response.Body.String())
		}
		return response.Body.Bytes()
	}
	var project store.Project
	json.Unmarshal(call("POST", "/projects", `{"name":"Project","workspaceKind":"local","workspaceSource":"/projects/example","nodeId":"machine-a"}`, 201), &project)
	if project.NodeID == nil || *project.NodeID != "machine-a" || project.RuntimeID != nil {
		t.Fatalf("project location: %+v", project)
	}
	for _, provider := range []string{"trae", "codex"} {
		agent, err := st.CreateAgent(ctx, wid, store.Agent{Name: provider, RuntimeProvider: provider})
		if err != nil {
			t.Fatal(err)
		}
		_, _, err = server.submitConversationTask(ctx, wid, chatRequest{AgentID: agent.ID, Prompt: "hello", ProjectID: &project.ID}, nil, "test")
		if err != nil {
			t.Fatalf("%s: %v", provider, err)
		}
		got := requests[len(requests)-1]
		if got.Runtime.ID != "machine-a/"+provider || got.Runtime.Provider != provider || got.Workspace.Source != "/projects/example" {
			t.Fatalf("wrong location: %+v", got)
		}
	}
	remote := "machine-b/codex"
	agent, err := st.CreateAgent(ctx, wid, store.Agent{Name: "wrong machine", RuntimeProvider: "codex", RuntimeID: &remote})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = server.submitConversationTask(ctx, wid, chatRequest{AgentID: agent.ID, Prompt: "hello", ProjectID: &project.ID}, nil, "test"); err == nil {
		t.Fatal("Agent on another machine accepted")
	}
	call("POST", "/projects", `{"name":"Invalid","workspaceKind":"local","workspaceSource":"/projects/example","nodeId":"unassigned-machine"}`, 400)
	// Existing clients may send a Runtime ID; it is converted to a machine.
	var legacy store.Project
	json.Unmarshal(call("POST", "/projects", `{"name":"Legacy","workspaceKind":"local","workspaceSource":"/projects/example","runtimeId":"machine-a/trae"}`, 201), &legacy)
	if legacy.NodeID == nil || *legacy.NodeID != "machine-a" || legacy.RuntimeID != nil {
		t.Fatalf("legacy location: %+v", legacy)
	}
	// Switch providers and switch back in the same shared conversation.
	trae, _ := st.CreateAgent(ctx, wid, store.Agent{Name: "trae-session", RuntimeProvider: "trae"})
	codex, _ := st.CreateAgent(ctx, wid, store.Agent{Name: "codex-session", RuntimeProvider: "codex"})
	sessionID := uuid.NewString()
	for index, selected := range []store.Agent{trae, codex, codex, trae} {
		prompt := []string{"Trae writes the initial implementation", "Codex reviews the implementation", "Codex fixes the review findings", "Trae continues after the Codex fixes"}[index]
		if _, _, err = server.submitConversationTask(ctx, wid, chatRequest{AgentID: selected.ID, Prompt: prompt, SessionID: &sessionID, ProjectID: &project.ID}, nil, "test"); err != nil {
			t.Fatalf("turn %d: %v", index, err)
		}
		request := requests[len(requests)-1]
		if request.SessionID != sessionID || request.Runtime.ID != "machine-a/"+selected.RuntimeProvider {
			t.Fatalf("wrong shared session routing: %+v", request)
		}
		if index == 1 || index == 3 {
			if !strings.Contains(request.Input.ContinuationPrompt, "Trae writes the initial implementation") || !strings.Contains(request.Input.ContinuationPrompt, prompt) {
				t.Fatalf("switch lost shared history: %s", request.Input.ContinuationPrompt)
			}
		}
		if index == 2 && request.Input.ContinuationPrompt != prompt {
			t.Fatal("continuous Agent turn must reuse its native context")
		}
		if index == 3 && !strings.Contains(request.Input.ContinuationPrompt, "Codex fixes the review findings") {
			t.Fatal("switching back lost intervening Agent work")
		}
	}
	// A different role using the same Runtime must also receive new shared context.
	otherTrae, _ := st.CreateAgent(ctx, wid, store.Agent{Name: "Trae reviewer", RuntimeProvider: "trae"})
	if _, _, err = server.submitConversationTask(ctx, wid, chatRequest{AgentID: otherTrae.ID, Prompt: "review", SessionID: &sessionID, ProjectID: &project.ID}, nil, "test"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(requests[len(requests)-1].Input.ContinuationPrompt, "Codex fixes the review findings") {
		t.Fatal("same-provider role switch lost history")
	}
	// Other machines remain excluded from an existing conversation.
	before := len(requests)
	if _, _, err = server.submitConversationTask(ctx, wid, chatRequest{AgentID: agent.ID, Prompt: "wrong machine", SessionID: &sessionID, ProjectID: &project.ID}, nil, "test"); err == nil || len(requests) != before {
		t.Fatal("cross-machine switch accepted")
	}
	// Projectless conversations also pin the machine, rather than the provider.
	plainSession := uuid.NewString()
	for _, selected := range []store.Agent{trae, codex, trae} {
		if _, _, err = server.submitConversationTask(ctx, wid, chatRequest{AgentID: selected.ID, Prompt: "plain conversation", SessionID: &plainSession}, nil, "test"); err != nil {
			t.Fatal(err)
		}
		if requests[len(requests)-1].Runtime.ID != "machine-a/"+selected.RuntimeProvider {
			t.Fatal("projectless switch moved machines")
		}
	}
	// Changing the Project machine can move subsequent turns of the same provider.
	nextNode := "machine-b"
	project.NodeID = &nextNode
	if _, err = st.UpdateProject(ctx, wid, project.ID, project); err != nil {
		t.Fatal(err)
	}
	if _, _, err = server.submitConversationTask(ctx, wid, chatRequest{AgentID: codex.ID, Prompt: "hello", ProjectID: &project.ID}, nil, "test"); err != nil {
		t.Fatal(err)
	}
	if requests[len(requests)-1].Runtime.ID != "machine-b/codex" {
		t.Fatal("Project machine update ignored")
	}
}

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestProjectGitStatusInspectsCurrentRuntimeWithoutRun(t *testing.T) {
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
	wid := "workspace-inspection-" + uuid.NewString()
	if err := st.EnsureWorkspace(context.Background(), wid, "Workspace inspection test"); err != nil {
		t.Fatal(err)
	}
	runtimeID := "current-node/trae"
	project, err := st.CreateProject(context.Background(), wid, store.Project{Name: "Local project", WorkspaceKind: "local", WorkspaceSource: "/workspace/project", ExecutionMode: "in_place", RuntimeID: &runtimeID})
	if err != nil {
		t.Fatal(err)
	}

	requestedNode := ""
	requestedWorkspace := relay.WorkspaceSpec{}
	relayMux := http.NewServeMux()
	relayMux.HandleFunc("GET /v1/nodes/{nodeID}/workspace", func(w http.ResponseWriter, r *http.Request) {
		requestedNode = r.PathValue("nodeID")
		if err := json.Unmarshal([]byte(r.URL.Query().Get("workspace")), &requestedWorkspace); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"root": requestedWorkspace.Source, "git": map[string]any{"repository": true, "branch": "main"}})
	})
	relayServer := httptest.NewServer(relayMux)
	defer relayServer.Close()

	server := New(st, relayServer.URL, "", relayServer.URL, wid, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+project.ID+"/git-status", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"branch":"main"`) {
		t.Fatalf("git status = %d %s", response.Code, response.Body.String())
	}
	if requestedNode != "current-node" || requestedWorkspace.Kind != "local" || requestedWorkspace.Source != "/workspace/project" {
		t.Fatalf("inspection target = node %q workspace %+v", requestedNode, requestedWorkspace)
	}
}

func TestProjectGitStatusUsesLatestConversationAgentRuntime(t *testing.T) {
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
	wid := "workspace-inspection-agent-" + uuid.NewString()
	if err := st.EnsureWorkspace(context.Background(), wid, "Workspace inspection agent fallback test"); err != nil {
		t.Fatal(err)
	}
	runtimeID := "agent-node/trae"
	agent, err := st.CreateAgent(context.Background(), wid, store.Agent{Name: "Inspection Agent", RuntimeProvider: "trae", RuntimeID: &runtimeID})
	if err != nil {
		t.Fatal(err)
	}
	project, err := st.CreateProject(context.Background(), wid, store.Project{Name: "Legacy local project", WorkspaceKind: "local", WorkspaceSource: "/workspace/legacy", ExecutionMode: "in_place"})
	if err != nil {
		t.Fatal(err)
	}
	projectID := project.ID
	if _, err := st.EnsureSession(context.Background(), wid, uuid.NewString(), "Inspect", agent.ID, &projectID, &runtimeID, nil, &project); err != nil {
		t.Fatal(err)
	}

	requestedNode := ""
	relayMux := http.NewServeMux()
	relayMux.HandleFunc("GET /v1/nodes/{nodeID}/workspace", func(w http.ResponseWriter, r *http.Request) {
		requestedNode = r.PathValue("nodeID")
		writeJSON(w, http.StatusOK, map[string]any{"git": map[string]any{"repository": true, "branch": "main"}})
	})
	relayServer := httptest.NewServer(relayMux)
	defer relayServer.Close()
	server := New(st, relayServer.URL, "", relayServer.URL, wid, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+project.ID+"/git-status", nil))
	if response.Code != http.StatusOK || requestedNode != "agent-node" {
		t.Fatalf("git status = %d %s, node=%q", response.Code, response.Body.String(), requestedNode)
	}
}

func TestProjectGitStatusRequiresCurrentRuntime(t *testing.T) {
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
	wid := "workspace-inspection-runtime-" + uuid.NewString()
	if err := st.EnsureWorkspace(context.Background(), wid, "Workspace inspection runtime test"); err != nil {
		t.Fatal(err)
	}
	project, err := st.CreateProject(context.Background(), wid, store.Project{Name: "Unbound project", WorkspaceKind: "local", WorkspaceSource: "/workspace/project", ExecutionMode: "in_place"})
	if err != nil {
		t.Fatal(err)
	}
	server := New(st, "http://relay.invalid", "", "http://relay.invalid", wid, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+project.ID+"/git-status", nil))
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"code":"project_workspace_unavailable"`) {
		t.Fatalf("git status = %d %s", response.Code, response.Body.String())
	}
}

func TestRuntimeNodeID(t *testing.T) {
	for input, want := range map[string]string{
		"node-1/trae":       "node-1",
		"node/with/codex":   "node/with",
		"missing-separator": "",
		"":                  "",
	} {
		if got := runtimeNodeID(input); got != want {
			t.Fatalf("runtimeNodeID(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestInspectNodeWorkspaceEscapesWorkspaceQuery(t *testing.T) {
	requested := ""
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = r.URL.Query().Get("workspace")
		writeJSON(w, http.StatusOK, map[string]any{"git": map[string]any{"repository": false}})
	}))
	defer relayServer.Close()
	server := New(nil, relayServer.URL, "token", relayServer.URL, "workspace", nil)
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	response := httptest.NewRecorder()
	server.inspectNodeWorkspace(response, request, "node/id", relay.WorkspaceSpec{Kind: "local", Source: "/tmp/a & b"}, "git-status", "")
	if response.Code != http.StatusOK {
		t.Fatalf("inspection = %d %s", response.Code, response.Body.String())
	}
	var workspace relay.WorkspaceSpec
	if json.Unmarshal([]byte(requested), &workspace) != nil || workspace.Source != "/tmp/a & b" {
		t.Fatalf("workspace query = %q", requested)
	}
	if _, err := url.ParseQuery("workspace=" + url.QueryEscape(requested)); err != nil {
		t.Fatal(err)
	}
}

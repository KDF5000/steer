package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestProjectGitStatusUsesRunOnCurrentRuntimeNode(t *testing.T) {
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
	agent, err := st.CreateAgent(context.Background(), wid, store.Agent{Name: "Inspection Agent", RuntimeProvider: "trae", RuntimeID: &runtimeID})
	if err != nil {
		t.Fatal(err)
	}
	project, err := st.CreateProject(context.Background(), wid, store.Project{Name: "Local project", WorkspaceKind: "local", WorkspaceSource: "/workspace/project", ExecutionMode: "in_place", RuntimeID: &runtimeID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := project.ID
	session, err := st.EnsureSession(context.Background(), wid, uuid.NewString(), "Inspect", agent.ID, &projectID, &runtimeID, nil, &project)
	if err != nil {
		t.Fatal(err)
	}
	currentRunID := "run-current-" + uuid.NewString()
	staleRunID := "run-stale-" + uuid.NewString()
	if _, _, err := st.SaveChatRun(context.Background(), wid, session.ID, agent.ID, "current", currentRunID, "succeeded"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Millisecond)
	if _, _, err := st.SaveChatRun(context.Background(), wid, session.ID, agent.ID, "stale", staleRunID, "succeeded"); err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	inspectedRuns := []string{}
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/runs/" + staleRunID:
			writeJSON(w, http.StatusOK, map[string]any{"id": staleRunID, "runtime": map[string]string{"id": "old-node/trae"}, "attempt": map[string]string{"node_id": "old-node"}})
		case "/v1/runs/" + currentRunID:
			writeJSON(w, http.StatusOK, map[string]any{"id": currentRunID, "runtime": map[string]string{"id": runtimeID}, "attempt": map[string]string{"node_id": "current-node"}})
		case "/v1/runs/" + currentRunID + "/workspace":
			mu.Lock()
			inspectedRuns = append(inspectedRuns, currentRunID)
			mu.Unlock()
			writeJSON(w, http.StatusOK, map[string]any{"root": "/workspace/project", "git": map[string]any{"repository": true, "branch": "main"}})
		case "/v1/runs/" + staleRunID + "/workspace":
			mu.Lock()
			inspectedRuns = append(inspectedRuns, staleRunID)
			mu.Unlock()
			http.Error(w, "stale run must not be inspected", http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer relayServer.Close()

	server := New(st, relayServer.URL, "", relayServer.URL, wid, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+project.ID+"/git-status", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"branch":"main"`) {
		t.Fatalf("git status = %d %s", response.Code, response.Body.String())
	}
	mu.Lock()
	defer mu.Unlock()
	if len(inspectedRuns) != 1 || inspectedRuns[0] != currentRunID {
		t.Fatalf("inspected runs = %v, want only %s", inspectedRuns, currentRunID)
	}
}

func TestProjectGitStatusRejectsRunsFromReplacedNode(t *testing.T) {
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
	wid := "workspace-inspection-replaced-" + uuid.NewString()
	if err := st.EnsureWorkspace(context.Background(), wid, "Replaced Node test"); err != nil {
		t.Fatal(err)
	}
	runtimeID := "replacement-node/trae"
	agent, err := st.CreateAgent(context.Background(), wid, store.Agent{Name: "Inspection Agent", RuntimeProvider: "trae", RuntimeID: &runtimeID})
	if err != nil {
		t.Fatal(err)
	}
	project, err := st.CreateProject(context.Background(), wid, store.Project{Name: "Local project", WorkspaceKind: "local", WorkspaceSource: "/workspace/project", ExecutionMode: "in_place", RuntimeID: &runtimeID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := project.ID
	session, err := st.EnsureSession(context.Background(), wid, uuid.NewString(), "Inspect", agent.ID, &projectID, &runtimeID, nil, &project)
	if err != nil {
		t.Fatal(err)
	}
	oldRunID := "run-old-node-" + uuid.NewString()
	if _, _, err := st.SaveChatRun(context.Background(), wid, session.ID, agent.ID, "old", oldRunID, "succeeded"); err != nil {
		t.Fatal(err)
	}

	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/runs/"+oldRunID {
			writeJSON(w, http.StatusOK, map[string]any{"id": oldRunID, "runtime": map[string]string{"id": "old-node/trae"}, "attempt": map[string]string{"node_id": "old-node"}})
			return
		}
		http.NotFound(w, r)
	}))
	defer relayServer.Close()

	server := New(st, relayServer.URL, "", relayServer.URL, wid, nil)
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

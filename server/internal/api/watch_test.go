package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"
)

func TestWatchFeedScopesAndWorkspaceIsolation(t *testing.T) {
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
	wid := "watch-" + uuid.NewString()
	other := wid + "-other"
	var ids []string
	for _, workspace := range []string{wid, other} {
		if err := st.EnsureWorkspace(ctx, workspace, "Watch test"); err != nil {
			t.Fatal(err)
		}
		agent, err := st.CreateAgent(ctx, workspace, store.Agent{Name: "Builder", RuntimeProvider: "test"})
		if err != nil {
			t.Fatal(err)
		}
		sessionID := uuid.NewString()
		ids = append(ids, sessionID)
		if _, err := st.EnsureSession(ctx, workspace, sessionID, "测试会话", agent.ID, nil, nil, nil, nil); err != nil {
			t.Fatal(err)
		}
		if _, _, _, err := st.SaveTaskRun(ctx, workspace, sessionID, agent.ID, "检查代码", uuid.NewString(), "running", store.Task{Source: "api"}); err != nil {
			t.Fatal(err)
		}
	}
	foreignSession, err := st.Session(ctx, other, ids[1])
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.SaveChatRun(ctx, other, ids[1], foreignSession.AgentID, "another private message", uuid.NewString(), "succeeded"); err != nil {
		t.Fatal(err)
	}
	token := "steer_sk_" + uuid.NewString()
	if _, err := st.CreateWorkspaceAPIKey(ctx, store.WorkspaceAPIKey{WorkspaceID: wid, Name: "Watch read", TokenHash: tokenHash(token), TokenPrefix: "steer_sk_test", Scopes: []string{"tasks:read"}, CreatedByUserID: "test-user"}); err != nil {
		t.Fatal(err)
	}
	handler := New(st, "http://unused.invalid", "", "http://unused.invalid", "unused", nil, WithAuthentication(time.Hour)).Handler()
	call := func(method, path, key string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("X-Steer-Workspace", other)
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, req)
		return out
	}
	list := call(http.MethodGet, "/api/v1/watch/conversations", token)
	if list.Code != 200 {
		t.Fatalf("list: %d %s", list.Code, list.Body.String())
	}
	var items []store.WatchConversation
	if err := json.Unmarshal(list.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != ids[0] || items[0].AgentName != "Builder" || items[0].TaskID == nil || items[0].Status != "running" || items[0].LastUserMessage != "检查代码" || items[0].StartedAt == nil {
		t.Fatalf("wrong projection: %+v", items)
	}
	overviewResponse := call(http.MethodGet, "/api/v1/watch/overview", token)
	if overviewResponse.Code != 200 || overviewResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("overview: %d %s", overviewResponse.Code, overviewResponse.Body.String())
	}
	var overview store.WatchOverview
	if err := json.Unmarshal(overviewResponse.Body.Bytes(), &overview); err != nil {
		t.Fatal(err)
	}
	if overview.TotalTasks != 1 || overview.ActiveTasks != 1 || overview.UserMessages != 1 || overview.AgentMessages != 0 || overview.TokenCount != nil {
		t.Fatalf("wrong overview or workspace leak: %+v", overview)
	}
	for _, query := range []string{"?limit=0", "?limit=101", "?offset=-1", "?limit=invalid"} {
		if response := call(http.MethodGet, "/api/v1/watch/conversations"+query, token); response.Code != 400 {
			t.Fatalf("accepted invalid pagination %s: %d", query, response.Code)
		}
	}
	if response := call(http.MethodGet, "/api/v1/watch/conversations?limit=1&offset=1", token); response.Code != 200 || response.Body.String() != "[]\n" {
		t.Fatalf("pagination not scoped: %d %s", response.Code, response.Body.String())
	}
	own := call(http.MethodGet, "/api/v1/watch/conversations/"+ids[0], token)
	if own.Code != 200 {
		t.Fatalf("own history: %d %s", own.Code, own.Body.String())
	}
	foreign := call(http.MethodGet, "/api/v1/watch/conversations/"+ids[1], token)
	if foreign.Code != 404 {
		t.Fatalf("cross workspace history leaked: %d", foreign.Code)
	}
	denied := call(http.MethodPost, "/api/v1/conversations/"+ids[0]+"/tasks", token)
	if denied.Code != 403 {
		t.Fatalf("read-only key submitted: %d", denied.Code)
	}
	notificationStatus := call(http.MethodGet, "/api/v1/watch/notifications", token)
	if notificationStatus.Code != http.StatusOK {
		t.Fatalf("read key cannot inspect notification availability: %d", notificationStatus.Code)
	}
	registration := call(http.MethodPost, "/api/v1/watch/devices", token)
	if registration.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured notifications misreported as permissions: %d", registration.Code)
	}
	invalid := call(http.MethodGet, "/api/v1/watch/conversations", "steer_sk_invalid")
	if invalid.Code != 401 {
		t.Fatalf("invalid key read feed: %d", invalid.Code)
	}
	if denied := call(http.MethodGet, "/api/v1/watch/projects", "steer_sk_invalid"); denied.Code != 401 {
		t.Fatalf("invalid key read project directory: %d", denied.Code)
	}
	// A project directory must find projects beyond the first 50 sessions,
	// use stable project IDs, and never leak another workspace.
	var projects []store.Project
	for i := 0; i < 2; i++ {
		project, err := st.CreateProject(ctx, wid, store.Project{Name: fmt.Sprintf("项目%d", i), WorkspaceKind: "local", WorkspaceSource: "/workspace/test", ExecutionMode: "in_place"})
		if err != nil {
			t.Fatal(err)
		}
		projects = append(projects, project)
	}
	session, err := st.Session(ctx, wid, ids[0])
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 53; i++ {
		project := projects[0]
		if i == 52 {
			project = projects[1]
		}
		if _, err := st.EnsureSession(ctx, wid, uuid.NewString(), "检索目标", session.AgentID, &project.ID, nil, nil, &project); err != nil {
			t.Fatal(err)
		}
	}
	directory := call(http.MethodGet, "/api/v1/watch/projects", token)
	var groups []store.WatchProject
	if directory.Code != 200 || directory.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("directory: %d %s", directory.Code, directory.Body.String())
	}
	if err := json.Unmarshal(directory.Body.Bytes(), &groups); err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, group := range groups {
		counts[group.ID] = group.Conversations
	}
	if len(groups) != 3 || counts[projects[0].ID] != 52 || counts[projects[1].ID] != 1 || counts["__unassigned__"] != 1 {
		t.Fatalf("wrong directory: %+v", groups)
	}
	for _, check := range []struct {
		query string
		count int
	}{
		{"?projectId=" + projects[0].ID + "&limit=50", 50},
		{"?projectId=" + projects[0].ID + "&limit=50&offset=50", 2},
		{"?projectId=" + projects[1].ID, 1},
		{"?projectId=__unassigned__", 1},
		{"?projectId=foreign-project", 0},
		{"?q=" + url.QueryEscape("检索目标") + "&offset=50", 3},
		{"?q=" + url.QueryEscape("another private message"), 0},
	} {
		response := call(http.MethodGet, "/api/v1/watch/conversations"+check.query, token)
		var page []store.WatchConversation
		if response.Code != 200 {
			t.Fatalf("filtered page: %d %s", response.Code, response.Body.String())
		}
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		if len(page) != check.count {
			t.Fatalf("%s: got %d want %d", check.query, len(page), check.count)
		}
	}
}

package api

import (
	"context"
	"encoding/json"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
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
}

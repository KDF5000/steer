package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestCodebaseWebhookUpdatesMRCacheWithoutStartingReviews(t *testing.T) {
	db := os.Getenv("STEER_TEST_DATABASE_URL")
	if db == "" {
		t.Skip("set STEER_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	st, err := store.Open(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	_, workspace, _, err := st.CreateUser(ctx, uuid.NewString()+"@example.com", "Owner", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	var state atomic.Value
	state.Store("merged")
	var unavailable atomic.Bool
	var requests atomic.Int64
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Query().Get("Action") != "GetMergeRequest" {
			t.Errorf("unexpected upstream action: %s", r.URL.Query().Get("Action"))
		}
		if unavailable.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		fmt.Fprintf(w, `{"ResponseMetadata":{"Action":"GetMergeRequest"},"Result":{"MergeRequest":{"Id":"12","Number":3,"TargetRepoId":"9","Title":"Current title","Description":"Preserved description","Status":%q,"SourceBranchName":"feature","TargetBranchName":"main","CreatedAt":"2026-01-01T00:00:00Z","UpdatedAt":"2026-01-03T00:00:00Z","CreatedBy":{"Username":"author"}}}}`, state.Load().(string))
	}))
	defer remote.Close()
	s := New(st, "http://127.0.0.1:1", "", "", workspace.ID, nil, WithCredentialEncryptionKey("test-webhook-cache-key"))
	secret, err := s.encryptCredential("secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.SaveCodebaseConnection(ctx, store.CodebaseConnection{WorkspaceID: workspace.ID, BaseURL: remote.URL, AppID: "app", EncryptedAppSecret: secret}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.AddCodebaseRepository(ctx, workspace.ID, "9", "org/repo", "repo"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.SaveCodebaseWebhook(ctx, store.CodebaseWebhook{WorkspaceID: workspace.ID, Enabled: true, TokenHash: tokenHash("token"), EncryptedToken: []byte("unused")}); err != nil {
		t.Fatal(err)
	}
	cursor := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)
	if _, err := st.SaveCodebaseRepoSync(ctx, store.CodebaseRepoSync{WorkspaceID: workspace.ID, RepoID: "9", RepoPath: "org/repo", LastMRUpdatedAt: &cursor}); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := st.UpsertCodebaseMergeRequests(ctx, workspace.ID, "9", "org/repo", []store.CodebaseMergeRequest{{ID: 12, IID: 3, Title: "Old title", State: "open"}}); err != nil {
		t.Fatal(err)
	}
	accept := func(action, eventState string) store.CodebaseWebhookEvent {
		t.Helper()
		payload := json.RawMessage(fmt.Sprintf(`{"Action":%q,"Repository":{"Id":"9","Path":"org/repo"},"MergeRequest":{"Number":3,"Status":%q}}`, action, eventState))
		event, _, err := st.AcceptCodebaseWebhook(ctx, workspace.ID, tokenHash("token"), uuid.NewString(), payload)
		if err != nil {
			t.Fatal(err)
		}
		return event
	}
	for _, tc := range []struct{ action, status string }{{"merged", "merged"}, {"closed", "closed"}, {"reopened", "open"}} {
		state.Store(tc.status)
		s.processCodebaseWebhookEvent(ctx, accept(tc.action, tc.status))
		mr, err := st.CodebaseMergeRequest(ctx, workspace.ID, "9", 3)
		if err != nil || mr.State != tc.status || mr.Title != "Current title" || mr.Description != "Preserved description" || mr.Author.Username != "author" || mr.SourceBranch != "feature" || mr.TargetBranch != "main" {
			t.Fatalf("cache not refreshed: %+v error=%v", mr, err)
		}
		_, total, err := st.CodebaseMergeRequests(ctx, workspace.ID, "9", "open", "", 1, 20)
		if err != nil || (tc.status == "open" && total != 1) || (tc.status != "open" && total != 0) {
			t.Fatalf("open filter is stale: count=%d error=%v", total, err)
		}
	}
	// Even with an active review workflow, an old opened event must use the
	// current merged state and must not queue another review.
	agent, err := st.CreateAgent(ctx, workspace.ID, store.Agent{Name: "Reviewer", RuntimeProvider: "mock"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateCodebaseWorkflow(ctx, store.CodebaseWorkflow{ID: uuid.NewString(), WorkspaceID: workspace.ID, Name: "Review", RepoID: "9", RepoPath: "org/repo", AgentID: agent.ID, Enabled: true, TriggerWebhook: true}); err != nil {
		t.Fatal(err)
	}
	state.Store("merged")
	s.processCodebaseWebhookEvent(ctx, accept("opened", "open"))
	runs, err := st.CodebaseRuns(ctx, workspace.ID, "", "", 20)
	if err != nil || len(runs) != 0 {
		t.Fatalf("stale/merged webhook started reviews: %+v %v", runs, err)
	}
	// An unavailable API retains the cached state and releases the event for retry.
	unavailable.Store(true)
	event := accept("merged", "merged")
	s.processCodebaseWebhookEvent(ctx, event)
	pending, err := st.PendingCodebaseWebhookEvents(ctx, workspace.ID, 20)
	if err != nil || len(pending) != 1 || pending[0].ID != event.ID {
		t.Fatalf("failed refresh was not retryable: %+v %v", pending, err)
	}
	unavailable.Store(false)
	s.processCodebaseWebhookEvent(ctx, event)
	pending, err = st.PendingCodebaseWebhookEvents(ctx, workspace.ID, 20)
	if err != nil || len(pending) != 0 {
		t.Fatalf("successful retry stayed pending: %+v %v", pending, err)
	}
	syncRow, err := st.CodebaseRepoSync(ctx, workspace.ID, "9")
	if err != nil || syncRow.LastMRUpdatedAt == nil || !syncRow.LastMRUpdatedAt.Equal(cursor) {
		t.Fatalf("single MR update advanced the sync cursor: %+v %v", syncRow, err)
	}
	// Payloads for unbound repositories must not fetch or cache external data.
	before := requests.Load()
	payload := json.RawMessage(`{"Action":"merged","Repository":{"Id":"999","Path":"other/repo"},"MergeRequest":{"Number":3,"Status":"merged"}}`)
	foreign, _, err := st.AcceptCodebaseWebhook(ctx, workspace.ID, tokenHash("token"), uuid.NewString(), payload)
	if err != nil {
		t.Fatal(err)
	}
	s.processCodebaseWebhookEvent(ctx, foreign)
	if requests.Load() != before {
		t.Fatal("fetched an unbound repository")
	}
}

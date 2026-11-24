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
	"time"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestCodebaseManualReport(t *testing.T) {
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
	if err = st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	makeUser := func(name string) (store.User, store.Workspace) {
		t.Helper()
		u, w, _, err := st.CreateUser(ctx, uuid.NewString()+"@example.com", name, "unused", "")
		if err != nil {
			t.Fatal(err)
		}
		if err = st.CreateAuthSession(ctx, u.ID, tokenHash(u.ID), time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
		return u, w
	}
	owner, workspace := makeUser("Owner")
	guest, guestWorkspace := makeUser("Guest")
	workflow, err := st.CreateCodebaseWorkflow(ctx, store.CodebaseWorkflow{ID: uuid.NewString(), WorkspaceID: workspace.ID, Name: "Manual review", RepoPath: "org/repo", RepoID: "9", ReportEnabled: false, Enabled: false})
	if err != nil {
		t.Fatal(err)
	}
	grant, err := st.CreateResourceShare(ctx, store.ResourceShare{Kind: "workflow", ResourceID: workflow.ID, WorkspaceID: workspace.ID, OwnerUserID: owner.ID, RecipientEmail: guest.Email, Permission: "view", MaxConcurrency: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = st.AcceptResourceShare(ctx, grant.ID, guest); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var creates, updates int
	var comment string
	var fail bool
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Query().Get("Action") {
		case "ListThreads":
			if comment == "" {
				fmt.Fprint(w, `{"ResponseMetadata":{"Action":"ListThreads"},"Result":{"Threads":[]}}`)
			} else {
				fmt.Fprintf(w, `{"ResponseMetadata":{"Action":"ListThreads"},"Result":{"Threads":[{"Comments":[{"Id":"c1","Content":%q}]}]}}`, comment)
			}
		case "CreateComment", "UpdateComment":
			if fail {
				w.WriteHeader(503)
				fmt.Fprint(w, `{"error":"temporary failure"}`)
				return
			}
			var input struct{ Content string }
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
			}
			if !strings.Contains(input.Content, "Checked result") || !strings.Contains(input.Content, workflow.ID) {
				t.Errorf("wrong stored review posted: %s", input.Content)
			}
			comment = input.Content
			if r.URL.Query().Get("Action") == "CreateComment" {
				creates++
			} else {
				updates++
			}
			fmt.Fprintf(w, `{"ResponseMetadata":{"Action":%q},"Result":{"Comment":{"Id":"c1"}}}`, r.URL.Query().Get("Action"))
		default:
			t.Errorf("unexpected upstream action: %s", r.URL.Query().Get("Action"))
			w.WriteHeader(500)
		}
	}))
	defer remote.Close()
	s := New(st, "http://127.0.0.1:1", "", "", workspace.ID, nil, WithAuthentication(time.Hour), WithCredentialEncryptionKey("manual-report-test-encryption-key"))
	secret, err := s.encryptCredential("test-secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = st.SaveCodebaseConnection(ctx, store.CodebaseConnection{WorkspaceID: workspace.ID, BaseURL: remote.URL, AppID: "test-app", EncryptedAppSecret: secret, VerifiedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = st.UpsertCodebaseMergeRequests(ctx, workspace.ID, "9", "org/repo", []store.CodebaseMergeRequest{{ID: 12, IID: 3, ProjectID: 9, Title: "Fix", State: "open", WebURL: "https://example.com/mr/3"}}); err != nil {
		t.Fatal(err)
	}
	handler := s.Handler()
	makeRun := func(status, summary string) store.CodebaseRun {
		t.Helper()
		run, err := st.CreateCodebaseRun(ctx, store.CodebaseRun{ID: uuid.NewString(), WorkspaceID: workspace.ID, WorkflowID: workflow.ID, RepoID: "9", RepoPath: "org/repo", MRIID: 3, MRTitle: "Fix", MRURL: "https://example.com/mr/3", Trigger: "manual", Status: status, Summary: summary, ReportStatus: "skipped"})
		if err != nil {
			t.Fatal(err)
		}
		return run
	}
	call := func(user store.User, wid, id string) (int, store.CodebaseRun) {
		r := httptest.NewRequest("POST", "/api/v1/codebase/runs/"+id+"/report", strings.NewReader(`{"summary":"untrusted client content"}`))
		r.AddCookie(&http.Cookie{Name: authCookieName, Value: user.ID})
		r.Header.Set("X-Steer-Workspace", wid)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		var run store.CodebaseRun
		_ = json.Unmarshal(w.Body.Bytes(), &run)
		return w.Code, run
	}
	run := makeRun("succeeded", "Checked result: no critical issues.")
	// The grant permits viewing but no writeback, including forged owner scope.
	if code, _ := call(guest, guestWorkspace.ID, run.ID); code != 404 {
		t.Fatalf("shared recipient write: %d", code)
	}
	if code, _ := call(guest, workspace.ID, run.ID); code != 403 {
		t.Fatalf("forged owner scope: %d", code)
	}
	// A skipped run can be explicitly published even with the workflow disabled.
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, result := call(owner, workspace.ID, run.ID)
			if code != 200 || (result.ReportStatus != "sent" && result.ReportStatus != "sending") {
				t.Errorf("concurrent publish: %d %+v", code, result)
			}
		}()
	}
	wg.Wait()
	reported, err := st.CodebaseRun(ctx, workspace.ID, run.ID)
	if err != nil || reported.ReportStatus != "sent" || reported.ReportURL != run.MRURL {
		t.Fatalf("not reported: %+v %v", reported, err)
	}
	if code, result := call(owner, workspace.ID, run.ID); code != 200 || result.ReportStatus != "sent" {
		t.Fatalf("repeat publish: %d %+v", code, result)
	}
	mu.Lock()
	if creates != 1 || updates != 0 {
		t.Errorf("duplicate reports: %d/%d", creates, updates)
	}
	mu.Unlock()
	for _, state := range []string{"pending", "running", "failed", "skipped"} {
		invalid := makeRun(state, "Checked result")
		if code, _ := call(owner, workspace.ID, invalid.ID); code != 400 {
			t.Fatalf("invalid %s: %d", state, code)
		}
	}
	empty := makeRun("succeeded", "  ")
	if code, _ := call(owner, workspace.ID, empty.ID); code != 400 {
		t.Fatalf("empty review: %d", code)
	}
	// Failed manual reports retain their errors and require explicit retry.
	second := makeRun("succeeded", "Checked result: second review.")
	mu.Lock()
	fail = true
	mu.Unlock()
	if code, result := call(owner, workspace.ID, second.ID); code != 200 || result.ReportStatus != "failed" || result.ReportError == "" {
		t.Fatalf("failed report: %d %+v", code, result)
	}
	auto, err := st.CodebaseRunsNeedingReport(ctx, 200)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range auto {
		if item.ID == second.ID {
			t.Fatal("manual failure was scheduled for automatic retry")
		}
	}
	stale := second
	stale.ReportStatus = "failed"
	afterSkip, err := s.reportCodebaseRun(ctx, workspace.ID, stale)
	if err != nil || afterSkip.ReportStatus != "failed" || afterSkip.ReportError == "" {
		t.Fatalf("automatic skip replaced manual outcome: %+v %v", afterSkip, err)
	}
	mu.Lock()
	fail = false
	mu.Unlock()
	if code, result := call(owner, workspace.ID, second.ID); code != 200 || result.ReportStatus != "sent" || result.ReportError != "" {
		t.Fatalf("retry failed: %d %+v", code, result)
	}
	mu.Lock()
	if creates != 1 || updates != 1 {
		t.Errorf("existing MR comment was not updated: %d/%d", creates, updates)
	}
	mu.Unlock()
	persisted, err := st.CodebaseWorkflow(ctx, workspace.ID, workflow.ID)
	if err != nil || persisted.ReportEnabled || persisted.Enabled {
		t.Fatalf("manual action mutated workflow: %+v %v", persisted, err)
	}
	// An automatic claimant can neither take nor skip a manual claim.
	third := makeRun("succeeded", "Checked result: third review.")
	claimed, err := st.ClaimManualCodebaseRunReport(ctx, workspace.ID, third.ID)
	if err != nil || !claimed {
		t.Fatalf("claim failed: %v", err)
	}
	if claimed, err := st.ClaimCodebaseRunReport(ctx, workspace.ID, third.ID); err != nil || claimed {
		t.Fatalf("automatic duplicate claim: %v %v", claimed, err)
	}
	if skipped, err := st.SkipAutomaticCodebaseRunReport(ctx, workspace.ID, third.ID, ""); err != nil || skipped.ReportStatus != "sending" {
		t.Fatalf("skip erased manual claim: %+v %v", skipped, err)
	}
	// Cancellation after claiming must not interrupt a requested external write.
	cancelledRun := makeRun("succeeded", "Checked result: cancelled browser.")
	cancelledCtx, cancel := context.WithCancel(ctx)
	cancelRemote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { cancel(); remote.Config.Handler.ServeHTTP(w, r) }))
	defer cancelRemote.Close()
	if _, err = st.SaveCodebaseConnection(ctx, store.CodebaseConnection{WorkspaceID: workspace.ID, BaseURL: cancelRemote.URL, AppID: "test-app", EncryptedAppSecret: secret, VerifiedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/api/v1/codebase/runs/"+cancelledRun.ID+"/report", nil).WithContext(cancelledCtx)
	request.AddCookie(&http.Cookie{Name: authCookieName, Value: owner.ID})
	request.Header.Set("X-Steer-Workspace", workspace.ID)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	cancelledResult, err := st.CodebaseRun(ctx, workspace.ID, cancelledRun.ID)
	if err != nil || cancelledResult.ReportStatus != "sent" {
		t.Fatalf("browser cancellation stranded writeback: %+v %v %s", cancelledResult, err, recorder.Body.String())
	}
}

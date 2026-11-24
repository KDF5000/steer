package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestCodebaseRunPaginationScopesAndFilters(t *testing.T) {
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
		u, w, _, err := st.CreateUser(ctx, name+"-"+uuid.NewString()+"@example.com", name, "unused", "")
		if err != nil {
			t.Fatal(err)
		}
		if err = st.CreateAuthSession(ctx, u.ID, tokenHash(u.ID), time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
		return u, w
	}
	owner, ow := makeUser("page-owner")
	guest, gw := makeUser("page-guest")
	stranger, sw := makeUser("page-stranger")
	alternate, err := st.CreateWorkspace(ctx, guest.ID, "Alternate")
	if err != nil {
		t.Fatal(err)
	}
	ownerAlternate, err := st.CreateWorkspace(ctx, owner.ID, "Owner alternate")
	if err != nil {
		t.Fatal(err)
	}
	makeFlow := func(wid, name, repo string) store.CodebaseWorkflow {
		t.Helper()
		wf, err := st.CreateCodebaseWorkflow(ctx, store.CodebaseWorkflow{ID: uuid.NewString(), WorkspaceID: wid, Name: name, RepoID: repo, RepoPath: "team/" + repo, Enabled: true})
		if err != nil {
			t.Fatal(err)
		}
		return wf
	}
	shared := makeFlow(ow.ID, "Shared", "shared-repo")
	private := makeFlow(ow.ID, "Private", "shared-repo")
	pending := makeFlow(ow.ID, "Pending", "pending-repo")
	own := makeFlow(gw.ID, "Guest own", "own-repo")
	alternateFlow := makeFlow(alternate.ID, "Guest alternate", "alternate-repo")
	ownerAlternateFlow := makeFlow(ownerAlternate.ID, "Owner alternate", "alternate-owner-repo")
	makeRun := func(flow store.CodebaseWorkflow, index int, status string) store.CodebaseRun {
		t.Helper()
		run, err := st.CreateCodebaseRun(ctx, store.CodebaseRun{ID: uuid.NewString(), WorkspaceID: flow.WorkspaceID, WorkflowID: flow.ID, RepoID: flow.RepoID, RepoPath: flow.RepoPath, MRIID: index + 1, MRTitle: fmt.Sprintf("%s-%03d", flow.Name, index), Trigger: "manual", Status: status, Model: "private-model", ReasoningEffort: "private-effort", TaskID: "private-task-id", Summary: "Review summary"})
		if err != nil {
			t.Fatal(err)
		}
		return run
	}
	oldest := makeRun(shared, 0, "failed")
	for i := 1; i <= 500; i++ {
		makeRun(shared, i, "succeeded")
	}
	for i := 0; i < 6; i++ {
		makeRun(own, i, "succeeded")
	}
	for i := 0; i < 3; i++ {
		makeRun(private, i, "running")
	}
	makeRun(pending, 0, "failed")
	makeRun(alternateFlow, 0, "failed")
	makeRun(ownerAlternateFlow, 0, "succeeded")
	grant, err := st.CreateResourceShare(ctx, store.ResourceShare{Kind: "workflow", ResourceID: shared.ID, WorkspaceID: ow.ID, OwnerUserID: owner.ID, RecipientEmail: guest.Email, Permission: "view", MaxConcurrency: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = st.AcceptResourceShare(ctx, grant.ID, guest); err != nil {
		t.Fatal(err)
	}
	if _, err = st.CreateResourceShare(ctx, store.ResourceShare{Kind: "workflow", ResourceID: pending.ID, WorkspaceID: ow.ID, OwnerUserID: owner.ID, RecipientEmail: guest.Email, Permission: "view", MaxConcurrency: 1}); err != nil {
		t.Fatal(err)
	}
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("History reads must not call Relay for shared runs: %s", r.URL.Path)
		writeJSON(w, 500, map[string]string{"error": "unexpected remote call"})
	}))
	defer remote.Close()
	handler := New(st, remote.URL, "", remote.URL, ow.ID, nil, WithAuthentication(time.Hour)).Handler()
	type response struct {
		Items    []store.CodebaseRun `json:"items"`
		Total    int                 `json:"total"`
		Page     int                 `json:"page"`
		PageSize int                 `json:"pageSize"`
		NextPage *int                `json:"nextPage"`
	}
	call := func(user store.User, wid, query string, status int) response {
		t.Helper()
		r := httptest.NewRequest("GET", "/api/v1/codebase/runs?"+query, nil)
		r.AddCookie(&http.Cookie{Name: authCookieName, Value: user.ID})
		r.Header.Set("X-Steer-Workspace", wid)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s: %d want %d: %s", query, w.Code, status, w.Body.String())
		}
		var out response
		if status == 200 {
			if err = json.Unmarshal(w.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
		}
		return out
	}
	first := call(guest, gw.ID, "page=1&pageSize=25&includeShared=true", 200)
	if first.Total != 507 || len(first.Items) != 25 || first.NextPage == nil || *first.NextPage != 2 {
		t.Fatalf("Invalid combined first page: %+v", first)
	}
	seen := map[string]bool{}
	var previous *store.CodebaseRun
	for page := 1; page <= 21; page++ {
		result := call(guest, gw.ID, fmt.Sprintf("page=%d&pageSize=25&includeShared=true", page), 200)
		if result.Total != 507 {
			t.Fatalf("Unexpected total: %d", result.Total)
		}
		for _, run := range result.Items {
			if seen[run.ID] {
				t.Fatalf("Duplicate across pages: %s", run.ID)
			}
			seen[run.ID] = true
			if previous != nil && (run.CreatedAt.After(previous.CreatedAt) || (run.CreatedAt.Equal(previous.CreatedAt) && run.ID > previous.ID)) {
				t.Fatal("Global order is unstable")
			}
			copy := run
			previous = &copy
			if run.WorkflowID == "share:"+grant.ID {
				if run.WorkspaceID != "" || run.TaskID != "" || run.Model != "" || run.ReasoningEffort != "" {
					t.Fatalf("Shared execution details leaked: %+v", run)
				}
			} else if run.WorkspaceID != gw.ID || run.WorkflowID != own.ID {
				t.Fatalf("Private/pending/other workspace run leaked: %+v", run)
			}
		}
		if page == 21 && (len(result.Items) != 7 || result.NextPage != nil) {
			t.Fatalf("Invalid last page: %+v", result)
		}
	}
	if len(seen) != 507 || !seen[oldest.ID] {
		t.Fatal("History past the old 500-run cap is missing")
	}
	filtered := call(guest, gw.ID, "page=1&pageSize=25&includeShared=true&status=failed", 200)
	if filtered.Total != 1 || len(filtered.Items) != 1 || filtered.Items[0].ID != oldest.ID {
		t.Fatalf("Filtering must cover all history: %+v", filtered)
	}
	shareOnly := call(guest, gw.ID, "page=1&pageSize=10&includeShared=true&workflowId=share:"+grant.ID+"&sync=true", 200)
	if shareOnly.Total != 501 || len(shareOnly.Items) != 10 {
		t.Fatalf("Shared workflow filter is wrong: %+v", shareOnly)
	}
	repoOnly := call(guest, gw.ID, "page=1&pageSize=10&includeShared=true&repoId=share-repo:team/shared-repo", 200)
	if repoOnly.Total != 501 {
		t.Fatalf("Shared repository filter is wrong: %+v", repoOnly)
	}
	ownOnly := call(guest, gw.ID, "page=1&pageSize=10&includeShared=true&workflowId="+own.ID, 200)
	if ownOnly.Total != 6 {
		t.Fatal("Own flow must not include shared runs")
	}
	if got := call(guest, gw.ID, "page=1&pageSize=10", 200); got.Total != 6 {
		t.Fatal("Shared runs require includeShared")
	}
	if got := call(guest, alternate.ID, "page=1&includeShared=true", 200); got.Total != 502 {
		t.Fatalf("Account grants must remain visible in another own workspace: %d", got.Total)
	}
	if got := call(owner, ownerAlternate.ID, "page=1&includeShared=true", 200); got.Total != 1 {
		t.Fatal("Owner history escaped selected workspace")
	}
	if got := call(stranger, sw.ID, "page=1&includeShared=true", 200); got.Total != 0 {
		t.Fatal("Stranger can see shared history")
	}
	call(guest, ow.ID, "page=1&includeShared=true", 403)
	for _, query := range []string{"page=0", "page=-1", "page=bad", "page=1&pageSize=101", "page=1&pageSize=0", "page=1&status=bad", "page=1&workflowId=share:", "page=1&repoId=share-repo:"} {
		call(guest, gw.ID, query, 400)
	}
	if got := call(guest, gw.ID, "page=999&includeShared=true", 200); got.Page != 21 || len(got.Items) != 7 {
		t.Fatal("Out-of-range page was not clamped")
	}
	if err = st.RevokeResourceShare(ctx, grant.ID, owner); err != nil {
		t.Fatal(err)
	}
	if got := call(guest, gw.ID, "page=21&includeShared=true", 200); got.Page != 1 || got.Total != 6 || len(got.Items) != 6 {
		t.Fatal("Revocation did not remove shared runs or correct page")
	}
	if got := call(guest, gw.ID, "page=1&includeShared=true&workflowId=share:"+grant.ID, 200); got.Total != 0 {
		t.Fatal("Revoked flow remains readable")
	}
}

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestCodebaseWorkflowsAndRuns(t *testing.T) {
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
	owner, workspace, _, err := st.CreateUser(ctx, uuid.NewString()+"@example.com", "Owner", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	guest, other, _, err := st.CreateUser(ctx, uuid.NewString()+"@example.com", "Other", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, user := range []store.User{owner, guest} {
		if err = st.CreateAuthSession(ctx, user.ID, tokenHash(user.ID), time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	listCalls := 0
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Code-App-ID") != "test-app" || r.Header.Get("X-Code-App-Secret") != "connection-secret" {
			w.WriteHeader(401)
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"","Error":{"Code":"Unauthorized","Message":"nope"}}}`)
			return
		}
		switch r.URL.Query().Get("Action") {
		case "GetApp":
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"GetApp","RequestId":"x"},"Result":{"App":{"Id":"app1","Name":"test-app"}}}`)
		case "GetRepository":
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"GetRepository","RequestId":"x"},"Result":{"Repository":{"Id":"9","Path":"org/repo","Name":"repo"}}}`)
		case "ListRepoMergeRequests":
			listCalls++
			// The first sync sees one MR. Later syncs add a newer MR at the top of
			// the UpdatedAt-desc list so the incremental cursor can be verified.
			if listCalls == 1 {
				fmt.Fprint(w, `{"ResponseMetadata":{"Action":"ListRepoMergeRequests","RequestId":"x"},"Result":{"MergeRequests":[{"Id":"12","Number":3,"TargetRepoId":"9","Title":"Real MR","Description":"Body text","Status":"open","URL":"https://code.example/org/repo/merge_requests/3","CreatedAt":"2025-12-31T10:00:00Z","UpdatedAt":"2026-01-01T10:00:00Z"}],"PageNumber":1,"PageSize":100,"TotalCount":1}}`)
			} else {
				fmt.Fprint(w, `{"ResponseMetadata":{"Action":"ListRepoMergeRequests","RequestId":"x"},"Result":{"MergeRequests":[{"Id":"13","Number":4,"TargetRepoId":"9","Title":"New MR","Status":"open","URL":"https://code.example/org/repo/merge_requests/4","CreatedAt":"2026-01-02T09:00:00Z","UpdatedAt":"2026-01-02T10:00:00Z"},{"Id":"12","Number":3,"TargetRepoId":"9","Title":"Real MR","Description":"Body text","Status":"open","URL":"https://code.example/org/repo/merge_requests/3","CreatedAt":"2025-12-31T10:00:00Z","UpdatedAt":"2026-01-01T10:00:00Z"}],"PageNumber":1,"PageSize":100,"TotalCount":2}}`)
			}
		default:
			t.Errorf("unexpected upstream action: %s", r.URL.Query().Get("Action"))
			w.WriteHeader(404)
		}
	}))
	defer remote.Close()
	s := New(st, "http://127.0.0.1:1", "", "", workspace.ID, nil, WithAuthentication(time.Hour), WithCredentialEncryptionKey("test-only-codebase-encryption-key"))
	handler := s.Handler()
	call := func(user, wid, method, path, body string, status int) string {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1/codebase/"+path, strings.NewReader(body))
		if user != "" {
			r.AddCookie(&http.Cookie{Name: authCookieName, Value: user})
		}
		r.Header.Set("X-Steer-Workspace", wid)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, status, w.Body.String())
		}
		return w.Body.String()
	}
	mustAgent := func(name string) store.Agent {
		t.Helper()
		a, err := st.CreateAgent(ctx, workspace.ID, store.Agent{
			Name:            name,
			Role:            "reviewer",
			RuntimeProvider: "codex",
		})
		if err != nil {
			t.Fatal(err)
		}
		return a
	}
	agent := mustAgent("Reviewer")

	// Workflows require a configured Codebase connection first.
	call(owner.ID, workspace.ID, "GET", "workflows", "", 200)
	call(owner.ID, workspace.ID, "PUT", "connection", `{"baseUrl":"`+remote.URL+`","appId":"test-app","appSecret":"connection-secret"}`, 200)

	wfInput := func(name, repoPath, agentID string) string {
		body, _ := json.Marshal(map[string]string{"name": name, "repoPath": repoPath, "agentId": agentID, "reviewInstruction": "focus on errors"})
		return string(body)
	}

	// Validation before any workflow exists.
	call(owner.ID, workspace.ID, "POST", "workflows", wfInput("", "org/repo", agent.ID), 400)
	call(owner.ID, workspace.ID, "POST", "workflows", wfInput("CI review", "org/repo", "missing-agent"), 400)
	call(owner.ID, workspace.ID, "POST", "workflows", wfInput("CI review", "../escape", agent.ID), 400)
	call(guest.ID, workspace.ID, "GET", "workflows", "", 403)
	call(guest.ID, workspace.ID, "POST", "workflows", wfInput("X", "org/repo", agent.ID), 403)
	if strings.TrimSpace(call(guest.ID, other.ID, "GET", "workflows", "", 200)) != `{"items":[]}` {
		t.Fatal("cross-workspace leak in workflow list")
	}

	created := call(owner.ID, workspace.ID, "POST", "workflows", wfInput("CI review", "org/repo", agent.ID), 200)
	var workflow store.CodebaseWorkflow
	if err := json.Unmarshal([]byte(created), &workflow); err != nil {
		t.Fatal(err)
	}
	if workflow.ID == "" || workflow.RepoID != "9" || workflow.RepoPath != "org/repo" || workflow.RepoName != "repo" || workflow.AgentID != agent.ID || !workflow.Enabled || !workflow.TriggerWebhook || !workflow.ReportEnabled {
		t.Fatalf("unexpected workflow: %s", created)
	}
	if listed := call(owner.ID, workspace.ID, "GET", "workflows", "", 200); !strings.Contains(listed, workflow.ID) {
		t.Fatalf("workflow not listed: %s", listed)
	}
	// Creating a workflow registers the repository so it can be synced from the
	// repository list before any merge request exists.
	if repos := call(owner.ID, workspace.ID, "GET", "repositories", "", 200); !strings.Contains(repos, `"repoId":"9"`) || !strings.Contains(repos, `"openCount":0`) {
		t.Fatalf("repository not registered with the workflow: %s", repos)
	}

	// Update without changing the repo path must not require a live Codebase call
	// and must preserve the verified repository fields.
	updated := call(owner.ID, workspace.ID, "PUT", "workflows/"+workflow.ID, `{"name":"CI review v2","repoPath":"org/repo","agentId":"`+agent.ID+`","reviewInstruction":"","triggerWebhook":false,"reportEnabled":false,"enabled":false}`, 200)
	var updatedWF store.CodebaseWorkflow
	if err := json.Unmarshal([]byte(updated), &updatedWF); err != nil {
		t.Fatal(err)
	}
	if updatedWF.Name != "CI review v2" || updatedWF.RepoID != "9" || updatedWF.RepoPath != "org/repo" || updatedWF.TriggerWebhook || updatedWF.Enabled || updatedWF.ReportEnabled {
		t.Fatalf("unexpected update: %s", updated)
	}
	call(owner.ID, workspace.ID, "PUT", "workflows/"+workflow.ID, `{"name":"CI review","repoPath":"org/repo","agentId":"`+agent.ID+`"}`, 200)

	// An omitted report setting preserves the user's choice; it can be re-enabled.
	persisted, err := st.CodebaseWorkflow(ctx, workspace.ID, workflow.ID)
	if err != nil || persisted.ReportEnabled {
		t.Fatalf("omitted reportEnabled changed saved setting: %+v %v", persisted, err)
	}
	call(owner.ID, workspace.ID, "PUT", "workflows/"+workflow.ID, `{"name":"CI review","repoPath":"org/repo","agentId":"`+agent.ID+`","reportEnabled":true}`, 200)
	persisted, err = st.CodebaseWorkflow(ctx, workspace.ID, workflow.ID)
	if err != nil || !persisted.ReportEnabled {
		t.Fatalf("could not enable reporting: %+v %v", persisted, err)
	}

	// Merge requests belong to the repository, not to an individual workflow.
	// Sync persists them; later syncs only walk back to the stored cursor.
	firstSync := call(owner.ID, workspace.ID, "POST", "merge-requests/sync", `{"repoId":"9"}`, 200)
	var syncResult codebaseSyncResult
	if err := json.Unmarshal([]byte(firstSync), &syncResult); err != nil {
		t.Fatal(err)
	}
	if syncResult.Created != 1 || syncResult.Unchanged != 0 || syncResult.OpenCount != 1 || syncResult.TotalCount != 1 {
		t.Fatalf("unexpected first sync: %s", firstSync)
	}
	repos := call(owner.ID, workspace.ID, "GET", "repositories", "", 200)
	if !strings.Contains(repos, `"repoId":"9"`) || !strings.Contains(repos, `"openCount":1`) {
		t.Fatalf("repository not listed after sync: %s", repos)
	}
	list := call(owner.ID, workspace.ID, "GET", "merge-requests?repoId=9&page=1", "", 200)
	if !strings.Contains(list, "Real MR") || !strings.Contains(list, `"description":"Body text"`) || !strings.Contains(list, `"syncedAt"`) {
		t.Fatalf("persisted MRs not returned: %s", list)
	}
	if filtered := call(owner.ID, workspace.ID, "GET", "merge-requests?repoId=9&state=merged", "", 200); strings.Contains(filtered, "Real MR") {
		t.Fatalf("state filter did not apply: %s", filtered)
	}
	call(owner.ID, workspace.ID, "GET", "merge-requests", "", 400)
	call(guest.ID, workspace.ID, "GET", "repositories", "", 403)
	call(guest.ID, workspace.ID, "POST", "merge-requests/sync", `{"repoId":"9"}`, 403)

	secondSync := call(owner.ID, workspace.ID, "POST", "merge-requests/sync", `{"repoId":"9"}`, 200)
	if err := json.Unmarshal([]byte(secondSync), &syncResult); err != nil {
		t.Fatal(err)
	}
	if syncResult.Created != 1 || syncResult.Unchanged != 1 {
		t.Fatalf("incremental sync did not add the newer MR: %s", secondSync)
	}
	thirdSync := call(owner.ID, workspace.ID, "POST", "merge-requests/sync", `{"repoId":"9"}`, 200)
	if err := json.Unmarshal([]byte(thirdSync), &syncResult); err != nil {
		t.Fatal(err)
	}
	if syncResult.Created != 0 || syncResult.Updated != 0 || syncResult.Unchanged != 1 {
		t.Fatalf("incremental sync re-ingested known MRs: %s", thirdSync)
	}

	// Runs: seed two workflows with runs directly to verify filtering, then
	// exercise the create-run endpoint (which fails to submit without Relay and
	// records a failed run).
	otherAgent := mustAgent("Docs Reviewer")
	second := call(owner.ID, workspace.ID, "POST", "workflows", wfInput("Docs review", "org/repo", otherAgent.ID), 200)
	var secondWF store.CodebaseWorkflow
	if err := json.Unmarshal([]byte(second), &secondWF); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	seedRun := func(wfID string, iid int) store.CodebaseRun {
		run, err := st.CreateCodebaseRun(ctx, store.CodebaseRun{
			ID:          uuid.NewString(),
			WorkspaceID: workspace.ID,
			WorkflowID:  wfID,
			RepoPath:    "org/repo",
			RepoID:      "9",
			MRIID:       iid,
			MRTitle:     fmt.Sprintf("MR %d", iid),
			Trigger:     "manual",
			Status:      "succeeded",
			StartedAt:   &now,
			FinishedAt:  &now,
		})
		if err != nil {
			t.Fatal(err)
		}
		return run
	}
	runA := seedRun(workflow.ID, 1)
	runB := seedRun(secondWF.ID, 2)
	all := call(owner.ID, workspace.ID, "GET", "runs", "", 200)
	if !strings.Contains(all, runA.ID) || !strings.Contains(all, runB.ID) {
		t.Fatalf("runs not listed: %s", all)
	}
	filtered := call(owner.ID, workspace.ID, "GET", "runs?workflowId="+workflow.ID, "", 200)
	if !strings.Contains(filtered, runA.ID) || strings.Contains(filtered, runB.ID) {
		t.Fatalf("runs filter failed: %s", filtered)
	}
	if strings.TrimSpace(call(guest.ID, other.ID, "GET", "runs", "", 200)) != `{"items":[]}` {
		t.Fatal("cross-workspace leak in run list")
	}
	call(guest.ID, workspace.ID, "GET", "runs", "", 403)

	createdRun := call(owner.ID, workspace.ID, "POST", "workflows/"+workflow.ID+"/runs", `{"mrIid":3}`, 200)
	var run store.CodebaseRun
	if err := json.Unmarshal([]byte(createdRun), &run); err != nil {
		t.Fatal(err)
	}
	if run.ID == "" || run.WorkflowID != workflow.ID || run.RepoPath != "org/repo" || run.MRIID != 3 || run.MRTitle != "Real MR" || run.Trigger != "manual" {
		t.Fatalf("unexpected run: %s", createdRun)
	}
	// Without a Relay runtime the task cannot be submitted, so the run is
	// recorded as failed with a captured error.
	if run.Status != "failed" || run.Error == "" {
		t.Fatalf("expected failed run without Relay, got: %s", createdRun)
	}
	call(owner.ID, workspace.ID, "POST", "workflows/"+workflow.ID+"/runs", `{"mrIid":0}`, 400)
	call(owner.ID, workspace.ID, "POST", "workflows/"+workflow.ID+"/runs", `{"mrIid":999}`, 400)
	call(owner.ID, workspace.ID, "POST", "workflows/missing/runs", `{"mrIid":3}`, 404)

	// A single run can be synced on demand; it stays terminal and does not error.
	call(owner.ID, workspace.ID, "POST", "runs/"+runA.ID+"/sync", "", 200)

	// Repositories are managed independently of workflows: deleting a workflow
	// keeps the repository and its synced merge requests.
	call(owner.ID, workspace.ID, "DELETE", "workflows/"+workflow.ID, "", 204)
	if listed := call(owner.ID, workspace.ID, "GET", "workflows", "", 200); strings.Contains(listed, workflow.ID) {
		t.Fatalf("deleted workflow still listed: %s", listed)
	}
	call(owner.ID, workspace.ID, "DELETE", "workflows/"+secondWF.ID, "", 204)
	if repos := call(owner.ID, workspace.ID, "GET", "repositories", "", 200); !strings.Contains(repos, `"repoId":"9"`) {
		t.Fatalf("repository disappeared after its workflows were deleted: %s", repos)
	}
	if list := call(owner.ID, workspace.ID, "GET", "merge-requests?repoId=9", "", 200); !strings.Contains(list, "Real MR") {
		t.Fatalf("merge requests were removed with the workflows: %s", list)
	}

	// Repository management: add, validate, and delete. A repository cannot be
	// deleted while a workflow still reviews it.
	call(owner.ID, workspace.ID, "POST", "repositories", `{"repoPath":"../escape"}`, 400)
	call(guest.ID, workspace.ID, "POST", "repositories", `{"repoPath":"org/repo"}`, 403)
	added := call(owner.ID, workspace.ID, "POST", "repositories", `{"repoPath":"org/repo"}`, 200)
	if !strings.Contains(added, `"repoId":"9"`) || !strings.Contains(added, `"repoPath":"org/repo"`) {
		t.Fatalf("repository was not added: %s", added)
	}
	call(owner.ID, workspace.ID, "POST", "repositories", `{"repoPath":"org/repo"}`, 200)
	blocking := call(owner.ID, workspace.ID, "POST", "workflows", wfInput("Blocking review", "org/repo", agent.ID), 200)
	var blockingWF store.CodebaseWorkflow
	if err := json.Unmarshal([]byte(blocking), &blockingWF); err != nil {
		t.Fatal(err)
	}
	call(owner.ID, workspace.ID, "DELETE", "repositories/9", "", 409)
	call(owner.ID, workspace.ID, "DELETE", "workflows/"+blockingWF.ID, "", 204)
	call(owner.ID, workspace.ID, "DELETE", "repositories/9", "", 204)
	if repos := call(owner.ID, workspace.ID, "GET", "repositories", "", 200); strings.Contains(repos, `"repoId":"9"`) {
		t.Fatalf("deleted repository still listed: %s", repos)
	}
	if list := call(owner.ID, workspace.ID, "GET", "merge-requests?repoId=9", "", 200); strings.Contains(list, "Real MR") {
		t.Fatalf("merge requests survived repository deletion: %s", list)
	}
	call(owner.ID, workspace.ID, "DELETE", "repositories/9", "", 404)
}

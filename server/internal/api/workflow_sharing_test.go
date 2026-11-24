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

func TestWorkflowSharingAccessBoundaries(t *testing.T) {
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
	user := func(name string) (store.User, store.Workspace) {
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
	owner, ow := user("Owner")
	guest, gw := user("Guest")
	stranger, sw := user("Stranger")
	agent, err := st.CreateAgent(ctx, ow.ID, store.Agent{Name: "Reviewer", RuntimeProvider: "codex", Instructions: "private-agent-instructions"})
	if err != nil {
		t.Fatal(err)
	}
	workflow := func(wid, name, repo string) store.CodebaseWorkflow {
		t.Helper()
		wf, err := st.CreateCodebaseWorkflow(ctx, store.CodebaseWorkflow{ID: uuid.NewString(), WorkspaceID: wid, Name: name, RepoID: repo, RepoPath: "team/" + repo, AgentID: agent.ID, ReviewInstruction: "private-workflow-instructions", SkillIDs: []string{"private-skill"}, Model: "private-model", Enabled: true})
		if err != nil {
			t.Fatal(err)
		}
		return wf
	}
	wf := workflow(ow.ID, "Shared review", "repo-a")
	sibling := workflow(ow.ID, "Private sibling", "repo-a")
	other := workflow(ow.ID, "Other repository", "repo-b")
	foreign := workflow(sw.ID, "Foreign review", "repo-c")
	run := func(flow store.CodebaseWorkflow, title string) (store.CodebaseRun, string) {
		t.Helper()
		sid := uuid.NewString()
		_, err := st.EnsureSession(ctx, flow.WorkspaceID, sid, title, agent.ID, nil, nil, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		runID := uuid.NewString()
		_, _, err = st.SaveChatRun(ctx, flow.WorkspaceID, sid, agent.ID, "Review this MR", runID, "succeeded")
		if err != nil {
			t.Fatal(err)
		}
		item, err := st.CreateCodebaseRun(ctx, store.CodebaseRun{ID: uuid.NewString(), WorkspaceID: flow.WorkspaceID, WorkflowID: flow.ID, RepoID: flow.RepoID, RepoPath: flow.RepoPath, MRIID: 7, MRTitle: title, Trigger: "manual", Status: "succeeded", Summary: "Report: " + title, ConversationID: sid})
		if err != nil {
			t.Fatal(err)
		}
		return item, runID
	}
	first, firstRun := run(wf, "shared-report")
	private, _ := run(sibling, "private-sibling-report")
	otherRun, _ := run(other, "other-repository-report")
	for _, repo := range []string{"repo-a", "repo-b"} {
		_, _, _, err = st.UpsertCodebaseMergeRequests(ctx, ow.ID, repo, "team/"+repo, []store.CodebaseMergeRequest{{ID: 7, IID: 7, ProjectID: 7, Title: repo + "-MR", State: "opened", Labels: []string{}}})
		if err != nil {
			t.Fatal(err)
		}
	}
	remoteCalls := 0
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { remoteCalls++; writeJSON(w, 200, []any{}) }))
	defer remote.Close()
	handler := New(st, remote.URL, "", remote.URL, ow.ID, nil, WithAuthentication(time.Hour)).Handler()
	call := func(u store.User, wid, method, path, body string, want int) string {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		if u.ID != "" {
			r.AddCookie(&http.Cookie{Name: authCookieName, Value: u.ID})
		}
		r.Header.Set("X-Steer-Workspace", wid)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w.Body.String()
	}
	invite := func(permission string) string {
		return fmt.Sprintf(`{"email":%q,"permission":%q}`, guest.Email, permission)
	}
	for _, email := range []string{"", "not-an-email", "Colleague <" + guest.Email + ">"} {
		body := fmt.Sprintf(`{"email":%q,"permission":"view"}`, email)
		response := call(owner, ow.ID, "POST", "/resource-shares/workflow/"+wf.ID, body, 400)
		if !strings.Contains(response, "Enter a valid email address") {
			t.Fatal("Invalid email should have a format-specific error: " + response)
		}
	}
	selfBody := fmt.Sprintf(`{"email":%q,"permission":"view"}`, "  "+strings.ToUpper(owner.Email)+"  ")
	if response := call(owner, ow.ID, "POST", "/resource-shares/workflow/"+wf.ID, selfBody, 400); !strings.Contains(response, "You already own this resource") {
		t.Fatal("Self invitation should have an ownership-specific error: " + response)
	}
	unknownEmail := "colleague+review." + uuid.NewString() + "@example.com"
	unknownBody := fmt.Sprintf(`{"email":%q,"permission":"view"}`, "  "+strings.ToUpper(unknownEmail)+"  ")
	var unknownShare store.ResourceShare
	if err := json.Unmarshal([]byte(call(owner, ow.ID, "POST", "/resource-shares/workflow/"+wf.ID, unknownBody, 201)), &unknownShare); err != nil || unknownShare.RecipientEmail != unknownEmail || unknownShare.Status != "pending" {
		t.Fatalf("Unregistered, mixed-case email with spaces should be accepted: %+v, %v", unknownShare, err)
	}
	call(owner, ow.ID, "POST", "/resource-shares/workflow/"+wf.ID, invite("execute"), 400)
	call(owner, ow.ID, "POST", "/resource-shares/workflow/"+foreign.ID, invite("view"), 404)
	var grant store.ResourceShare
	if err = json.Unmarshal([]byte(call(owner, ow.ID, "POST", "/resource-shares/workflow/"+wf.ID, invite("view"), 201)), &grant); err != nil {
		t.Fatal(err)
	}
	sharedPath := "/workflow-shares/" + grant.ID
	gateway := "/collaboration-access/" + grant.ID
	call(store.User{}, gw.ID, "GET", sharedPath, "", 401)
	call(guest, gw.ID, "GET", sharedPath, "", 404)
	call(stranger, sw.ID, "POST", "/resource-shares/"+grant.ID+"/accept", "", 404)
	call(guest, gw.ID, "POST", "/resource-shares/"+grant.ID+"/accept", "", 200)
	call(stranger, sw.ID, "GET", sharedPath, "", 404)
	call(guest, ow.ID, "GET", sharedPath, "", 403)
	call(owner, ow.ID, "PUT", "/resource-shares/"+grant.ID, `{"permission":"execute"}`, 400)
	details := call(guest, gw.ID, "GET", sharedPath, "", 200)
	for _, secret := range []string{"private-workflow-instructions", "private-model", "private-skill", "reviewInstruction", "agentId", "workspaceId"} {
		if strings.Contains(details, secret) {
			t.Fatalf("Shared metadata exposes %s: %s", secret, details)
		}
	}
	results := call(guest, gw.ID, "GET", sharedPath+"/runs?workflowId="+sibling.ID+"&repoId=repo-b&sync=true", "", 200)
	if !strings.Contains(results, first.Summary) || strings.Contains(results, private.Summary) || strings.Contains(results, otherRun.Summary) {
		t.Fatal("Runs escaped workflow scope: " + results)
	}
	mrPage := call(guest, gw.ID, "GET", sharedPath+"/merge-requests?repoId=repo-b&state=all", "", 200)
	if !strings.Contains(mrPage, "repo-a-MR") || strings.Contains(mrPage, "repo-b-MR") {
		t.Fatal("MR repository scope bypassed: " + mrPage)
	}
	if !strings.Contains(mrPage, first.Summary) || strings.Contains(mrPage, private.Summary) {
		t.Fatal("Latest MR results escaped workflow scope: " + mrPage)
	}
	for i := 0; i < 101; i++ {
		_, err := st.CreateCodebaseRun(ctx, store.CodebaseRun{ID: uuid.NewString(), WorkspaceID: ow.ID, WorkflowID: wf.ID, RepoID: wf.RepoID, RepoPath: wf.RepoPath, MRIID: 8, MRTitle: "recent-run", Trigger: "manual", Status: "succeeded"})
		if err != nil {
			t.Fatal(err)
		}
	}
	if !strings.Contains(call(guest, gw.ID, "GET", sharedPath+"/merge-requests?state=all", "", 200), first.Summary) {
		t.Fatal("Older MR result lost outside recent run list")
	}
	call(guest, gw.ID, "GET", gateway+"/sessions/"+first.ConversationID, "", 200)
	call(guest, gw.ID, "GET", gateway+"/sessions/"+private.ConversationID, "", 404)
	call(guest, gw.ID, "GET", gateway+"/sessions/"+otherRun.ConversationID, "", 404)
	for _, path := range []string{"bootstrap", "codebase/connection", "codebase/workflows", "sessions"} {
		call(guest, gw.ID, "GET", gateway+"/"+path, "", 404)
	}
	for _, path := range []string{"conversations/" + first.ConversationID + "/tasks", "runs/" + firstRun + "/cancel", "codebase/workflows/" + wf.ID + "/runs"} {
		call(guest, gw.ID, "POST", gateway+"/"+path, `{}`, 403)
	}
	call(guest, gw.ID, "POST", sharedPath+"/runs", `{}`, 405)
	next, _ := run(wf, "future-report")
	if !strings.Contains(call(guest, gw.ID, "GET", sharedPath+"/runs", "", 200), next.Summary) {
		t.Fatal("Future results missing")
	}
	call(guest, gw.ID, "GET", gateway+"/sessions/"+next.ConversationID, "", 200)
	if remoteCalls != 0 {
		t.Fatalf("Read-only workflow requests called remote service %d times", remoteCalls)
	}
	call(owner, ow.ID, "DELETE", "/resource-shares/"+grant.ID, "", 204)
	call(guest, gw.ID, "GET", sharedPath, "", 404)
	call(guest, gw.ID, "GET", sharedPath+"/runs", "", 404)
	call(guest, gw.ID, "GET", gateway+"/sessions/"+first.ConversationID, "", 404)
	call(owner, ow.ID, "POST", "/resource-shares/workflow/"+wf.ID, invite("view"), 201)
	call(guest, gw.ID, "GET", sharedPath, "", 404)
	call(guest, gw.ID, "POST", "/resource-shares/"+grant.ID+"/accept", "", 200)
	call(guest, gw.ID, "DELETE", "/resource-shares/"+grant.ID, "", 204)
	call(guest, gw.ID, "GET", sharedPath, "", 404)
	call(owner, ow.ID, "POST", "/resource-shares/workflow/"+wf.ID, invite("view"), 201)
	call(guest, gw.ID, "POST", "/resource-shares/"+grant.ID+"/accept", "", 200)
	if err = st.DeleteCodebaseWorkflow(ctx, ow.ID, wf.ID); err != nil {
		t.Fatal(err)
	}
	call(guest, gw.ID, "GET", sharedPath, "", 404)
	call(guest, gw.ID, "GET", gateway+"/sessions/"+first.ConversationID, "", 404)
	if strings.Contains(call(guest, gw.ID, "GET", "/resource-shares", "", 200), grant.ID) {
		t.Fatal("Deleted flow invitation remains visible")
	}
}

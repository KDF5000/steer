package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
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

func TestCodebaseWebhookPayloadParsing(t *testing.T) {
	payload := json.RawMessage(`{
		"object_kind": "merge_request",
		"project": {"id": 9, "path_with_namespace": "org/repo"},
		"object_attributes": {"iid": 3, "title": "Fix login", "url": "https://code.example/org/repo/merge_requests/3", "action": "update", "state": "opened"}
	}`)
	review, ok := parseCodebaseMergeRequestWebhook(payload)
	if !ok {
		t.Fatal("expected merge request update to start a review")
	}
	if review.MRIID != 3 || review.RepoID != "9" || review.RepoPath != "org/repo" || review.MRTitle != "Fix login" {
		t.Fatalf("unexpected review: %+v", review)
	}
	for _, skipped := range []string{
		`{"object_kind":"push","project":{"id":9},"object_attributes":{"iid":3}}`,
		`{"object_kind":"merge_request","project":{"id":9},"object_attributes":{"iid":3,"action":"merge","state":"merged"}}`,
		`{"object_kind":"merge_request","project":{"id":9},"object_attributes":{"iid":3,"action":"approved","state":"opened"}}`,
		`{"object_kind":"merge_request","project":{"id":9},"object_attributes":{"action":"update"}}`,
	} {
		if _, ok := parseCodebaseMergeRequestWebhook(json.RawMessage(skipped)); ok {
			t.Fatalf("payload should not start a review: %s", skipped)
		}
	}
	// A nested merge_request object (Codebase style) is accepted too.
	nested := json.RawMessage(`{"event_type":"merge_request","repository":{"id":"9","path":"org/repo"},"merge_request":{"number":4,"title":"Docs","url":"https://code.example/org/repo/merge_requests/4","state":"open"}}`)
	if review, ok := parseCodebaseMergeRequestWebhook(nested); !ok || review.MRIID != 4 || review.RepoID != "9" {
		t.Fatalf("nested payload not parsed: %+v %v", review, ok)
	}
}

func TestAgentBuddyIdentifierParsing(t *testing.T) {
	cases := map[string]string{
		"skills:github.com/mattpocock/skills/review":                                     "skills:github.com/mattpocock/skills/review",
		"https://skills.bytedance.net/skills/skills:github.com/mattpocock/skills/review": "skills:github.com/mattpocock/skills/review",
		"https://skills.byted.org/package/skills%3Agithub.com%2Forg%2Fskills%2Freview":   "skills:github.com/org/skills/review",
		"https://skills.byted.org/api/v2/package/skills:github.com/org/skills/review":    "skills:github.com/org/skills/review",
	}
	for input, want := range cases {
		if got := agentBuddyIdentifier(input); got != want {
			t.Fatalf("agentBuddyIdentifier(%q) = %q, want %q", input, got, want)
		}
	}
	if !isAgentBuddyInput("skills:github.com/org/skills/review") || !isAgentBuddyInput("https://skills.bytedance.net/skills/x") {
		t.Fatal("AgentBuddy inputs not recognized")
	}
	if isAgentBuddyInput("https://github.com/org/repo/blob/main/SKILL.md") {
		t.Fatal("GitHub URL must not be treated as AgentBuddy")
	}
}

func TestCodebaseReviewWebhookAndReport(t *testing.T) {
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
	if err = st.CreateAuthSession(ctx, owner.ID, tokenHash(owner.ID), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	var createdComments, updatedComments []map[string]any
	existingComment := ""
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch r.URL.Query().Get("Action") {
		case "GetApp":
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"GetApp"},"Result":{"App":{"Id":"app1","Name":"test-app"}}}`)
		case "GetRepository":
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"GetRepository"},"Result":{"Repository":{"Id":"9","Path":"org/repo","Name":"repo"}}}`)
		case "ListThreads":
			mu.Lock()
			defer mu.Unlock()
			if existingComment == "" {
				fmt.Fprint(w, `{"ResponseMetadata":{"Action":"ListThreads"},"Result":{"Threads":[]}}`)
				return
			}
			fmt.Fprintf(w, `{"ResponseMetadata":{"Action":"ListThreads"},"Result":{"Threads":[{"Comments":[{"Id":"c1","Content":%q}]}]}}`, existingComment)
		case "CreateComment":
			var input map[string]any
			_ = json.Unmarshal(body, &input)
			mu.Lock()
			createdComments = append(createdComments, input)
			mu.Unlock()
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"CreateComment"},"Result":{"Comment":{"Id":"new1"}}}`)
		case "UpdateComment":
			var input map[string]any
			_ = json.Unmarshal(body, &input)
			mu.Lock()
			updatedComments = append(updatedComments, input)
			mu.Unlock()
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"UpdateComment"},"Result":{"Comment":{"Id":"c1"}}}`)
		default:
			t.Errorf("unexpected upstream action: %s", r.URL.Query().Get("Action"))
			w.WriteHeader(404)
		}
	}))
	defer remote.Close()

	s := New(st, "http://127.0.0.1:1", "", "", workspace.ID, nil, WithAuthentication(time.Hour), WithCredentialEncryptionKey("test-only-codebase-encryption-key"))
	handler := s.Handler()
	secret, err := s.encryptCredential("connection-secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = st.SaveCodebaseConnection(ctx, store.CodebaseConnection{
		WorkspaceID:        workspace.ID,
		BaseURL:            remote.URL,
		AppID:              "test-app",
		EncryptedAppSecret: secret,
		VerifiedAt:         time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	skill, err := st.CreateSkill(ctx, workspace.ID, store.Skill{
		Name:        "Review guide",
		Description: "How to review",
		Content:     "# Review\nCheck error handling.",
		SourceKind:  "manual",
	})
	if err != nil {
		t.Fatal(err)
	}
	agent, err := st.CreateAgent(ctx, workspace.ID, store.Agent{Name: "Reviewer", Role: "reviewer", RuntimeProvider: "codex"})
	if err != nil {
		t.Fatal(err)
	}

	call := func(method, path, body string, status int) string {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1/codebase/"+path, strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: authCookieName, Value: owner.ID})
		r.Header.Set("X-Steer-Workspace", workspace.ID)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, status, w.Body.String())
		}
		return w.Body.String()
	}

	// Workflow-level model, effort, and Skills are persisted.
	workflowBody, _ := json.Marshal(map[string]any{
		"name":              "Strict review",
		"repoPath":          "org/repo",
		"agentId":           agent.ID,
		"reviewInstruction": "Check error handling.",
		"model":             "gpt-6-sol",
		"reasoningEffort":   "high",
		"skillIds":          []string{skill.ID, skill.ID},
	})
	var workflow store.CodebaseWorkflow
	if err = json.Unmarshal([]byte(call("POST", "workflows", string(workflowBody), 200)), &workflow); err != nil {
		t.Fatal(err)
	}
	if workflow.Model != "gpt-6-sol" || workflow.ReasoningEffort != "high" || len(workflow.SkillIDs) != 1 || workflow.SkillIDs[0] != skill.ID {
		t.Fatalf("review settings not persisted: %+v", workflow)
	}
	// Unknown Skills and invalid effort values are rejected.
	badSkill, _ := json.Marshal(map[string]any{"name": "Bad", "repoPath": "org/repo", "agentId": agent.ID, "skillIds": []string{"missing"}})
	call("POST", "workflows", string(badSkill), 400)
	badEffort, _ := json.Marshal(map[string]any{"name": "Bad", "repoPath": "org/repo", "agentId": agent.ID, "reasoningEffort": "extreme"})
	call("POST", "workflows", string(badEffort), 400)

	// A merge request update webhook starts a review run for the workflow.
	if _, _, _, err = st.UpsertCodebaseMergeRequests(ctx, workspace.ID, "9", "org/repo", []store.CodebaseMergeRequest{{
		ID: 12, IID: 3, ProjectID: 9, Title: "Fix login", State: "open",
		WebURL: "https://code.example/org/repo/merge_requests/3",
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err = st.SaveCodebaseWebhook(ctx, store.CodebaseWebhook{
		WorkspaceID: workspace.ID, Enabled: true, TokenHash: tokenHash("t"), EncryptedToken: []byte("x"),
	}); err != nil {
		t.Fatal(err)
	}
	payload := json.RawMessage(`{"object_kind":"merge_request","project":{"id":9,"path_with_namespace":"org/repo"},"object_attributes":{"iid":3,"title":"Fix login","url":"https://code.example/org/repo/merge_requests/3","action":"update","state":"opened"}}`)
	event, duplicate, err := st.AcceptCodebaseWebhook(ctx, workspace.ID, tokenHash("t"), "payload-1", payload)
	if err != nil || duplicate {
		t.Fatalf("accept webhook: %v duplicate=%v", err, duplicate)
	}
	s.processCodebaseWebhookEvent(ctx, event)
	runs, err := st.CodebaseRuns(ctx, workspace.ID, workflow.ID, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].Trigger != "webhook" || runs[0].MRIID != 3 {
		t.Fatalf("webhook did not start a review run: %+v", runs)
	}
	// The event is marked handled and not retried.
	if pending, err := st.PendingCodebaseWebhookEvents(ctx, workspace.ID, 10); err != nil || len(pending) != 0 {
		t.Fatalf("webhook event still pending: %v %v", pending, err)
	}

	// A finished review is published as a merge request comment.
	now := time.Now().UTC()
	finished, err := st.CreateCodebaseRun(ctx, store.CodebaseRun{
		ID: uuid.NewString(), WorkspaceID: workspace.ID, WorkflowID: workflow.ID,
		RepoPath: "org/repo", RepoID: "9", MRIID: 3, MRTitle: "Fix login",
		MRURL: "https://code.example/org/repo/merge_requests/3", Trigger: "manual",
		Status: "succeeded", Summary: "Looks good overall.", StartedAt: &now, FinishedAt: &now,
	})
	if err != nil {
		t.Fatal(err)
	}
	reported, err := s.reportCodebaseRun(ctx, workspace.ID, finished)
	if err != nil {
		t.Fatal(err)
	}
	if reported.ReportStatus != "sent" {
		t.Fatalf("report not sent: %+v", reported)
	}
	mu.Lock()
	if len(createdComments) != 1 {
		mu.Unlock()
		t.Fatalf("expected one created comment, got %d", len(createdComments))
	}
	created := createdComments[0]
	mu.Unlock()
	if created["CommentableId"] != "12" || created["CommentableType"] != "merge_request" || created["RepoId"] != "9" {
		t.Fatalf("unexpected comment target: %+v", created)
	}
	content, _ := created["Content"].(string)
	if !strings.Contains(content, fmt.Sprintf("<!-- steer-review:%s -->", workflow.ID)) || !strings.Contains(content, "Looks good overall.") || !strings.Contains(content, "### Strict review") {
		t.Fatalf("comment content missing review: %s", content)
	}
	// Reporting is idempotent: a claimed run is not posted twice.
	if _, err = s.reportCodebaseRun(ctx, workspace.ID, reported); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	if len(createdComments) != 1 {
		mu.Unlock()
		t.Fatalf("review was posted twice: %d", len(createdComments))
	}
	mu.Unlock()

	// Re-reviewing an updated MR updates the existing Steer comment in place.
	mu.Lock()
	existingComment = fmt.Sprintf("<!-- steer-review:%s --> previous review", workflow.ID)
	mu.Unlock()
	second, err := st.CreateCodebaseRun(ctx, store.CodebaseRun{
		ID: uuid.NewString(), WorkspaceID: workspace.ID, WorkflowID: workflow.ID,
		RepoPath: "org/repo", RepoID: "9", MRIID: 3, MRTitle: "Fix login",
		MRURL: "https://code.example/org/repo/merge_requests/3", Trigger: "webhook",
		Status: "succeeded", Summary: "Updated review.", StartedAt: &now, FinishedAt: &now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.reportCodebaseRun(ctx, workspace.ID, second); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(updatedComments) != 1 || updatedComments[0]["Id"] != "c1" {
		t.Fatalf("expected the existing comment to be updated: %+v", updatedComments)
	}
	if !strings.Contains(updatedComments[0]["Content"].(string), "Updated review.") {
		t.Fatalf("updated comment missing new summary: %+v", updatedComments[0])
	}
}

// Disabling writeback must work even without Codebase credentials: neither
// comment reads nor publishing is needed, including for failed report retries.
func TestCodebaseReportDisabled(t *testing.T) {
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
	_, workspace, _, err := st.CreateUser(ctx, uuid.NewString()+"@example.com", "Owner", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	agent, err := st.CreateAgent(ctx, workspace.ID, store.Agent{Name: "Reviewer", RuntimeProvider: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	workflow, err := st.CreateCodebaseWorkflow(ctx, store.CodebaseWorkflow{
		ID: uuid.NewString(), WorkspaceID: workspace.ID, Name: "No writeback", RepoPath: "org/repo", RepoID: "9", AgentID: agent.ID, Enabled: true, ReportEnabled: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	s := New(st, "http://127.0.0.1:1", "", "", workspace.ID, nil)
	for _, status := range []string{"", "failed"} {
		run, err := st.CreateCodebaseRun(ctx, store.CodebaseRun{
			ID: uuid.NewString(), WorkspaceID: workspace.ID, WorkflowID: workflow.ID,
			RepoPath: "org/repo", RepoID: "9", MRIID: 3, Trigger: "manual",
			Status: "succeeded", Summary: "Review completed.", ReportStatus: status, ReportError: "old failure",
		})
		if err != nil {
			t.Fatal(err)
		}
		reported, err := s.reportCodebaseRun(ctx, workspace.ID, run)
		if err != nil || reported.ReportStatus != "skipped" || reported.ReportError != "" || reported.Summary != run.Summary {
			t.Fatalf("disabled report was not skipped: %+v %v", reported, err)
		}
		// Re-enabling the workflow cannot retroactively publish a skipped run.
		workflow.ReportEnabled = true
		if _, err = st.UpdateCodebaseWorkflow(ctx, workflow); err != nil {
			t.Fatal(err)
		}
		if again, err := s.reportCodebaseRun(ctx, workspace.ID, reported); err != nil || again.ReportStatus != "skipped" {
			t.Fatalf("skipped run was retried: %+v %v", again, err)
		}
		workflow.ReportEnabled = false
		if _, err = st.UpdateCodebaseWorkflow(ctx, workflow); err != nil {
			t.Fatal(err)
		}
	}
	// Both manual and webhook task submission snapshot disabled writeback.
	for _, trigger := range []string{"manual", "webhook"} {
		run, err := s.startCodebaseRun(ctx, workspace.ID, workflow, store.CodebaseRun{MRIID: 3, Trigger: trigger, Status: "pending"}, "")
		if err != nil || run.ReportStatus != "skipped" {
			t.Fatalf("%s run did not preserve disabled writeback: %+v %v", trigger, run, err)
		}
	}
}

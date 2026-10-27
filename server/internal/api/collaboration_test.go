package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAccountScopedSharing(t *testing.T) {
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
	suffix := uuid.NewString()
	owner, ow, _, err := st.CreateUser(ctx, "owner-"+suffix+"@example.com", "Owner", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	guest, gw, _, err := st.CreateUser(ctx, "guest-"+suffix+"@example.com", "Guest", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	stranger, sw, _, err := st.CreateUser(ctx, "stranger-"+suffix+"@example.com", "Stranger", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []store.User{owner, guest, stranger} {
		if err := st.CreateAuthSession(ctx, u.ID, tokenHash(u.ID), time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	nodeID := "share-node-" + suffix
	physical := nodeID + "/codex"
	_, err = st.CreateRelayNodeEnrollment(ctx, owner.ID, suffix, nodeID, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	_, err = st.EnrollRelayNode(ctx, suffix, nodeID, "Review machine", 2, "online", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err = st.SyncRelayNode(ctx, nodeID, "Review machine", 2, "online", time.Now(), []store.RelayNodeRuntime{{ID: physical, Provider: "codex", State: "healthy"}}); err != nil {
		t.Fatal(err)
	}
	if err = st.BindRelayNodeRuntimes(ctx, ow.ID, owner.ID, nodeID, []string{physical}); err != nil {
		t.Fatal(err)
	}
	bindings, err := st.WorkspaceRuntimeBindings(ctx, ow.ID)
	if err != nil {
		t.Fatal(err)
	}
	rid := bindings[0].ID
	model := "test-model"
	agent, err := st.CreateAgent(ctx, ow.ID, store.Agent{Model: &model, Role: "Review role", Name: "Reviewer", RuntimeProvider: "codex", RuntimeID: &rid, Instructions: "review instructions"})
	if err != nil {
		t.Fatal(err)
	}
	project, err := st.CreateProject(ctx, ow.ID, store.Project{Name: "Authorized code", WorkspaceKind: "git", WorkspaceSource: "https://example.com/authorized.git", ExecutionMode: "session_worktree", NodeID: &nodeID})
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	requests := []relay.Request{}
	runs := map[string]relay.Run{}
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/nodes":
			writeJSON(w, 200, []map[string]any{{"id": nodeID, "state": "online", "capacity": 2, "last_seen": time.Now(), "runtimes": []map[string]any{{"id": physical, "provider": "codex", "state": "healthy"}}}})
		case r.Method == "POST" && r.URL.Path == "/v1/runs":
			var req relay.Request
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Error(err)
			}
			run := relay.Run{ID: uuid.NewString(), Status: relay.RunRunning}
			mu.Lock()
			requests = append(requests, req)
			runs[run.ID] = run
			mu.Unlock()
			writeJSON(w, 202, run)
		case strings.HasPrefix(r.URL.Path, "/v1/runs/") && len(strings.Split(strings.Trim(r.URL.Path, "/"), "/")) == 3:
			mu.Lock()
			run := runs[strings.TrimPrefix(r.URL.Path, "/v1/runs/")]
			mu.Unlock()
			writeJSON(w, 200, run)
		default:
			writeJSON(w, 200, []any{})
		}
	}))
	defer remote.Close()
	server := New(st, remote.URL, "", remote.URL, ow.ID, nil, WithAuthentication(time.Hour))
	handler := server.Handler()
	call := func(u store.User, wid, method, path, body string, want int) []byte {
		t.Helper()
		req := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		req.AddCookie(&http.Cookie{Name: authCookieName, Value: u.ID})
		req.Header.Set("X-Steer-Workspace", wid)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Fatalf("%s %s: %d want %d: %s", method, path, rec.Code, want, rec.Body.String())
		}
		return rec.Body.Bytes()
	}
	ownerCtx := context.WithValue(ctx, userContextKey, owner)
	first, _, err := server.submitConversationTask(ownerCtx, ow.ID, chatRequest{AgentID: agent.ID, ProjectID: &project.ID, Prompt: "owner private background"}, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	complete := func(result submittedTask) {
		t.Helper()
		mu.Lock()
		run := runs[result.Run.ID]
		run.Status = relay.RunSucceeded
		runs[run.ID] = run
		mu.Unlock()
		if err := st.UpdateRun(ctx, result.Task.WorkspaceID, run.ID, "succeeded", "done", nil, 0); err != nil {
			t.Fatal(err)
		}
	}
	complete(first)
	hidden, _, err := server.submitConversationTask(ownerCtx, ow.ID, chatRequest{AgentID: agent.ID, ProjectID: &project.ID, Prompt: "hidden conversation"}, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	complete(hidden)
	var grant store.ResourceShare
	json.Unmarshal(call(owner, ow.ID, "POST", "/resource-shares/session/"+first.Task.ConversationID, fmt.Sprintf(`{"email":%q,"permission":"view"}`, guest.Email), 201), &grant)
	if grant.ProjectID == nil || *grant.ProjectID != project.ID || grant.OwnerUserID != owner.ID {
		t.Fatalf("incorrect project grouping metadata: %+v", grant)
	}
	scope := "/collaboration-access/" + grant.ID
	target := scope + "/sessions/" + first.Task.ConversationID
	call(guest, gw.ID, "GET", target, "", 404)
	call(stranger, sw.ID, "POST", "/resource-shares/"+grant.ID+"/accept", "", 404)
	call(guest, gw.ID, "POST", "/resource-shares/"+grant.ID+"/accept", "", 200)
	call(guest, ow.ID, "GET", "/bootstrap", "", 403)
	call(guest, gw.ID, "GET", "/sessions/"+first.Task.ConversationID, "", 404)
	call(guest, gw.ID, "GET", target, "", 200)
	call(guest, gw.ID, "GET", scope+"/sessions/"+hidden.Task.ConversationID, "", 404)
	call(guest, gw.ID, "GET", scope+"/runs/"+hidden.Run.ID, "", 404)
	call(guest, gw.ID, "GET", scope+"/bootstrap", "", 404)
	taskBody := fmt.Sprintf(`{"agentId":%q,"prompt":"shared follow up"}`, agent.ID)
	taskPath := scope + "/conversations/" + first.Task.ConversationID + "/tasks"
	call(guest, gw.ID, "POST", taskPath, taskBody, 403)
	call(owner, ow.ID, "PUT", "/resource-shares/"+grant.ID, `{"permission":"execute"}`, 200)
	var response struct {
		Task store.Task
		User store.Message `json:"userMessage"`
	}
	json.Unmarshal(call(guest, gw.ID, "POST", taskPath, taskBody, 202), &response)
	if response.User.Context == nil || response.User.Context.UserID != guest.ID {
		t.Fatal("lost shared task author")
	}
	call(guest, gw.ID, "POST", taskPath, taskBody, 409)
	call(stranger, sw.ID, "GET", scope+"/runs/"+response.Task.RelayRunID, "", 404)
	call(owner, ow.ID, "DELETE", "/resource-shares/"+grant.ID, "", 204)
	call(guest, gw.ID, "GET", target, "", 404)
	var capability store.ResourceShare
	json.Unmarshal(call(owner, ow.ID, "POST", "/resource-shares/agent/"+agent.ID, fmt.Sprintf(`{"email":%q,"permission":"execute","projectId":%q}`, guest.Email, project.ID), 201), &capability)
	if capability.RuntimeLabel != "Review machine / codex" || capability.Model != model || capability.AgentRole != "Review role" {
		t.Fatalf("wrong capability location: %+v", capability)
	}
	call(guest, gw.ID, "POST", "/resource-shares/"+capability.ID+"/conversations", "", 404)
	var beforeAcceptance struct {
		Projects []store.Project `json:"projects"`
	}
	json.Unmarshal(call(guest, gw.ID, "GET", "/bootstrap", "", 200), &beforeAcceptance)
	if len(beforeAcceptance.Projects) != 0 {
		t.Fatal("pending Agent invitation imported a project")
	}
	call(guest, gw.ID, "POST", "/resource-shares/"+capability.ID+"/accept", "", 200)
	var accepted struct {
		Projects []store.Project `json:"projects"`
		Sessions []store.Session `json:"sessions"`
		Agents   []store.Agent   `json:"agents"`
	}
	json.Unmarshal(call(guest, gw.ID, "GET", "/bootstrap", "", 200), &accepted)
	if len(accepted.Projects) != 1 || value(accepted.Projects[0].SharedAgentGrantID) != capability.ID || len(accepted.Sessions) != 0 || len(accepted.Agents) != 1 || !accepted.Agents[0].Shared {
		t.Fatalf("acceptance must expose the project and Agent without any conversation: %+v", accepted)
	}
	if accepted.Projects[0].ID == project.ID || accepted.Projects[0].WorkspaceID != gw.ID {
		t.Fatal("import transferred the owner's actual project")
	}
	call(guest, gw.ID, "POST", "/resource-shares/"+capability.ID+"/accept", "", 200)
	imported, err := st.Projects(ctx, gw.ID)
	if err != nil || len(imported) != 1 || imported[0].ID != accepted.Projects[0].ID {
		t.Fatalf("repeated acceptance duplicated a project: %+v %v", imported, err)
	}
	var strangerBootstrap struct {
		Projects []store.Project `json:"projects"`
	}
	json.Unmarshal(call(stranger, sw.ID, "GET", "/bootstrap", "", 200), &strangerBootstrap)
	if len(strangerBootstrap.Projects) != 0 {
		t.Fatal("imported project leaked to another account")
	}
	var child store.Session
	json.Unmarshal(call(guest, gw.ID, "POST", "/resource-shares/"+capability.ID+"/conversations", "", 201), &child)
	if child.WorkspaceID != gw.ID || child.SharedAgentGrantID == nil || child.AgentID != agent.ID {
		t.Fatalf("wrong private session: %+v", child)
	}
	var repeated store.Session
	json.Unmarshal(call(guest, gw.ID, "POST", "/resource-shares/"+capability.ID+"/conversations", "", 201), &repeated)
	if repeated.ID != child.ID {
		t.Fatalf("re-entering an unused capability created another draft: %s != %s", repeated.ID, child.ID)
	}
	var draftWG sync.WaitGroup
	draftErrors := make(chan error, 6)
	for range 6 {
		draftWG.Add(1)
		go func() {
			defer draftWG.Done()
			draft, err := st.CreateSharedAgentSession(ctx, gw.ID, capability, agent, project, rid)
			if err != nil {
				draftErrors <- err
			} else if draft.ID != child.ID {
				draftErrors <- fmt.Errorf("concurrent creation produced another draft: %s", draft.ID)
			}
		}()
	}
	draftWG.Wait()
	close(draftErrors)
	for err := range draftErrors {
		t.Fatal(err)
	}
	call(owner, ow.ID, "GET", "/sessions/"+child.ID, "", 404)
	call(stranger, sw.ID, "GET", "/sessions/"+child.ID, "", 404)
	call(guest, gw.ID, "POST", "/conversations/"+child.ID+"/tasks", taskBody, 202)
	titled, err := st.Session(ctx, gw.ID, child.ID)
	if err != nil || titled.Title != "shared follow up" {
		t.Fatalf("shared conversation did not adopt its first task title: %+v, %v", titled, err)
	}
	mu.Lock()
	last := requests[len(requests)-1]
	mu.Unlock()
	if last.TenantID != gw.ID || last.Runtime.ID != physical || last.Workspace.ReuseKey == "" || last.Workspace.ReuseKey == "steer/"+ow.ID+"/"+first.Task.ConversationID || strings.Contains(last.Input.Prompt, "owner private background") || last.Workspace.Source != project.WorkspaceSource {
		t.Fatalf("capability context/routing: %+v", last)
	}
	if bindings, err := st.WorkspaceRuntimeBindings(ctx, gw.ID); err != nil || len(bindings) != 0 {
		t.Fatal("transferred Runtime binding")
	}
	preserved, err := st.EnsureSession(ctx, gw.ID, child.ID, "later follow-up", agent.ID, child.ProjectID, child.ExecutionRuntimeID, child.WorkspaceKey, nil)
	if err != nil || preserved.Title != "shared follow up" {
		t.Fatalf("follow-up overwrote the conversation title: %+v, %v", preserved, err)
	}
	var child2 store.Session
	json.Unmarshal(call(guest, gw.ID, "POST", "/resource-shares/"+capability.ID+"/conversations", "", 201), &child2)
	if child2.ID == child.ID || value(child2.ProjectID) != value(child.ProjectID) {
		t.Fatal("a used shared conversation should get a new session in the same private project")
	}
	call(guest, gw.ID, "POST", "/conversations/"+child2.ID+"/tasks", taskBody, 409)
	call(guest, gw.ID, "POST", "/conversations/"+child.ID+"/tasks", `{"agentId":"other","prompt":"escape"}`, 403)
	call(guest, gw.ID, "POST", "/conversations/"+child.ID+"/tasks", fmt.Sprintf(`{"agentId":%q,"projectId":%q,"prompt":"escape"}`, agent.ID, project.ID), 403)
	// Finishing remotely without a browser must release the concurrency allowance.
	mu.Lock()
	for id, run := range runs {
		run.Status = relay.RunSucceeded
		runs[id] = run
	}
	mu.Unlock()
	call(guest, gw.ID, "POST", "/conversations/"+child2.ID+"/tasks", taskBody, 202)
	local, err := st.CreateProject(ctx, ow.ID, store.Project{Name: "Local authorized", WorkspaceKind: "local", WorkspaceSource: "/workspace/authorized", ExecutionMode: "in_place", NodeID: &nodeID})
	if err != nil {
		t.Fatal(err)
	}
	call(owner, ow.ID, "POST", "/resource-shares/agent/"+agent.ID, fmt.Sprintf(`{"email":%q,"permission":"execute","projectId":%q}`, guest.Email, local.ID), 201)
	call(guest, gw.ID, "POST", "/conversations/"+child.ID+"/tasks", taskBody, 409)
	mu.Lock()
	for id, run := range runs {
		run.Status = relay.RunSucceeded
		runs[id] = run
	}
	mu.Unlock()
	var localSession store.Session
	json.Unmarshal(call(guest, gw.ID, "POST", "/resource-shares/"+capability.ID+"/conversations", "", 201), &localSession)
	call(guest, gw.ID, "POST", "/conversations/"+localSession.ID+"/tasks", taskBody, 202)
	mu.Lock()
	last = requests[len(requests)-1]
	mu.Unlock()
	if last.Workspace.Kind != "local" || last.Workspace.Source != local.WorkspaceSource || last.Runtime.ID != physical {
		t.Fatalf("wrong local capability routing: %+v", last)
	}
	call(owner, ow.ID, "DELETE", "/resource-shares/"+capability.ID, "", 204)
	call(guest, gw.ID, "POST", "/conversations/"+child.ID+"/tasks", taskBody, 403)
	call(guest, gw.ID, "POST", "/resource-shares/"+capability.ID+"/conversations", "", 404)
	var revokedHistory struct {
		Session  store.Session   `json:"session"`
		Messages []store.Message `json:"messages"`
	}
	json.Unmarshal(call(guest, gw.ID, "GET", "/sessions/"+child.ID, "", 200), &revokedHistory)
	if value(revokedHistory.Session.SharedAgentAccess) != "revoked" || len(revokedHistory.Messages) == 0 {
		t.Fatalf("revocation must retain history with revoked access metadata: %+v", revokedHistory)
	}
	revokedProject, err := st.Project(ctx, gw.ID, value(child.ProjectID))
	if err != nil || value(revokedProject.SharedAgentAccess) != "revoked" {
		t.Fatalf("missing revoked project state: %+v %v", revokedProject, err)
	}
	mu.Lock()
	activeAfterRevocation := 0
	for _, run := range runs {
		if run.Status == relay.RunRunning {
			activeAfterRevocation++
		}
	}
	mu.Unlock()
	if activeAfterRevocation == 0 {
		t.Fatal("revocation interrupted an existing run")
	}

	// A previously accepted invitation had no project until its first use.
	legacyAgent, err := st.CreateAgent(ctx, ow.ID, store.Agent{Name: "Legacy Reviewer", RuntimeProvider: "codex", RuntimeID: &rid})
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := st.CreateResourceShare(ctx, store.ResourceShare{Kind: "agent", ResourceID: legacyAgent.ID, WorkspaceID: ow.ID, OwnerUserID: owner.ID, RecipientEmail: guest.Email, Permission: "execute", ProjectID: &project.ID, MaxConcurrency: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = st.AcceptResourceShare(ctx, legacy.ID, guest); err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(call(guest, gw.ID, "GET", "/bootstrap", "", 200), &accepted)
	var legacyProject *store.Project
	for i := range accepted.Projects {
		if slices.Contains(accepted.Projects[i].SharedAgentGrantIDs, legacy.ID) {
			legacyProject = &accepted.Projects[i]
		}
	}
	if legacyProject == nil {
		t.Fatal("previously accepted Agent did not receive a project")
	}
	legacyProjectID := legacyProject.ID
	for _, session := range accepted.Sessions {
		if value(session.SharedAgentGrantID) == legacy.ID {
			t.Fatal("backfill created an empty conversation")
		}
	}
	// Several authorized Agents for the same source share one recipient project.
	writer, err := st.CreateAgent(ctx, ow.ID, store.Agent{Name: "Writer", RuntimeProvider: "codex", RuntimeID: &rid, Instructions: "writer instructions"})
	if err != nil {
		t.Fatal(err)
	}
	var writerGrant store.ResourceShare
	json.Unmarshal(call(owner, ow.ID, "POST", "/resource-shares/agent/"+writer.ID, fmt.Sprintf(`{"email":%q,"permission":"execute","projectId":%q}`, guest.Email, project.ID), 201), &writerGrant)
	call(guest, gw.ID, "POST", "/resource-shares/"+writerGrant.ID+"/accept", "", 200)
	json.Unmarshal(call(guest, gw.ID, "GET", "/bootstrap", "", 200), &accepted)
	var combined store.Project
	count := 0
	for _, p := range accepted.Projects {
		if value(p.SharedSourceProjectID) == project.ID {
			combined = p
			count++
		}
	}
	if count != 1 || combined.Name != project.Name || !slices.Contains(combined.SharedAgentGrantIDs, writerGrant.ID) || !slices.Contains(combined.SharedAgentGrantIDs, legacy.ID) {
		t.Fatalf("same source did not consolidate: %+v", accepted.Projects)
	}
	call(guest, gw.ID, "PUT", "/projects/"+combined.ID, `{"name":"changed"}`, 403)
	if _, err = st.UpdateProject(ctx, gw.ID, combined.ID, store.Project{Name: "changed"}); err == nil {
		t.Fatal("store allowed shared project edits")
	}
	personal, err := st.CreateProject(ctx, gw.ID, store.Project{Name: project.Name, WorkspaceKind: "git", WorkspaceSource: "https://example.com/personal.git", ExecutionMode: "session_worktree"})
	if err != nil || personal.ID == combined.ID {
		t.Fatalf("same named personal project collided with shared project: %v", err)
	}
	var multiSession store.Session
	json.Unmarshal(call(guest, gw.ID, "POST", "/resource-shares/"+legacy.ID+"/conversations", "", 201), &multiSession)
	if value(multiSession.ProjectID) != combined.ID {
		t.Fatal("Agent created another project entry")
	}
	call(guest, gw.ID, "POST", "/conversations/"+multiSession.ID+"/tasks", fmt.Sprintf(`{"agentId":%q,"prompt":"initial shared work"}`, legacyAgent.ID), 202)
	finishRuns := func() {
		mu.Lock()
		defer mu.Unlock()
		for id, run := range runs {
			run.Status = relay.RunSucceeded
			runs[id] = run
		}
	}
	finishRuns()
	call(guest, gw.ID, "POST", "/conversations/"+multiSession.ID+"/tasks", fmt.Sprintf(`{"agentId":%q,"prompt":"continue with Writer"}`, writer.ID), 202)
	switched, err := st.Session(ctx, gw.ID, multiSession.ID)
	if err != nil || switched.AgentID != writer.ID || value(switched.SharedAgentGrantID) != writerGrant.ID || value(switched.ProjectID) != combined.ID {
		t.Fatalf("switch lost project/grant identity: %+v %v", switched, err)
	}
	if busy, err := st.ShareHasActiveTask(ctx, writerGrant.ID); err != nil || !busy {
		t.Fatal("switched task was not charged to its selected Agent grant", err)
	}
	if busy, err := st.ShareHasActiveTask(ctx, legacy.ID); err != nil || busy {
		t.Fatal("old Agent grant retained switched task capacity", err)
	}
	mu.Lock()
	switchedRequest := requests[len(requests)-1]
	mu.Unlock()
	if switchedRequest.SessionID != multiSession.ID || !strings.Contains(switchedRequest.Input.Prompt, "initial shared work") || switchedRequest.Workspace.ReuseKey != value(multiSession.WorkspaceKey) {
		t.Fatalf("switch lost shared context/worktree: %+v", switchedRequest)
	}
	// A same-named project and an authorized Agent from another source are distinct.
	otherSource, err := st.CreateProject(ctx, ow.ID, store.Project{Name: "Other source", WorkspaceKind: "git", WorkspaceSource: "https://example.com/other.git", ExecutionMode: "session_worktree"})
	if err != nil {
		t.Fatal(err)
	}
	outsider, err := st.CreateAgent(ctx, ow.ID, store.Agent{Name: "Other project Agent", RuntimeProvider: "codex", RuntimeID: &rid})
	if err != nil {
		t.Fatal(err)
	}
	var outsideGrant store.ResourceShare
	json.Unmarshal(call(owner, ow.ID, "POST", "/resource-shares/agent/"+outsider.ID, fmt.Sprintf(`{"email":%q,"permission":"execute","projectId":%q}`, guest.Email, otherSource.ID), 201), &outsideGrant)
	call(guest, gw.ID, "POST", "/resource-shares/"+outsideGrant.ID+"/accept", "", 200)
	call(guest, gw.ID, "POST", "/conversations/"+multiSession.ID+"/tasks", fmt.Sprintf(`{"agentId":%q,"prompt":"escape project"}`, outsider.ID), 403)
	var strangerGrant store.ResourceShare
	json.Unmarshal(call(owner, ow.ID, "POST", "/resource-shares/agent/"+writer.ID, fmt.Sprintf(`{"email":%q,"permission":"execute","projectId":%q}`, stranger.Email, project.ID), 201), &strangerGrant)
	call(stranger, sw.ID, "POST", "/resource-shares/"+strangerGrant.ID+"/accept", "", 200)
	combined, err = st.Project(ctx, gw.ID, combined.ID)
	if err != nil || slices.Contains(combined.SharedAgentGrantIDs, strangerGrant.ID) {
		t.Fatal("project exposed another recipient's Agent grant")
	}
	finishRuns()
	call(owner, ow.ID, "DELETE", "/resource-shares/"+legacy.ID, "", 204)
	combined, _ = st.Project(ctx, gw.ID, combined.ID)
	if value(combined.SharedAgentAccess) != "accepted" {
		t.Fatal("revoking one Agent disabled the whole shared project")
	}
	call(guest, gw.ID, "POST", "/conversations/"+multiSession.ID+"/tasks", fmt.Sprintf(`{"agentId":%q,"prompt":"Writer still authorized"}`, writer.ID), 202)
	call(owner, ow.ID, "DELETE", "/resource-shares/"+writerGrant.ID, "", 204)
	combined, _ = st.Project(ctx, gw.ID, combined.ID)
	if value(combined.SharedAgentAccess) != "revoked" {
		t.Fatal("all revoked Agents left the shared project executable")
	}
	call(guest, gw.ID, "POST", "/conversations/"+multiSession.ID+"/tasks", fmt.Sprintf(`{"agentId":%q,"prompt":"revoked"}`, writer.ID), 403)
	if _, err = st.DeleteProject(ctx, gw.ID, legacyProjectID); err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(call(guest, gw.ID, "GET", "/bootstrap", "", 200), &accepted)
	for _, p := range accepted.Projects {
		if slices.Contains(p.SharedAgentGrantIDs, legacy.ID) {
			t.Fatal("bootstrap restored a deliberately deleted project")
		}
	}

	call(guest, gw.ID, "GET", "/sessions/"+child.ID, "", 200)
}

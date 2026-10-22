package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestDelegatedTaskIsolationAndHandoff(t *testing.T) {
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
	wid := "delegate-" + uuid.NewString()
	if err := st.EnsureWorkspace(ctx, wid, "Delegation"); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var requests []relay.Request
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/nodes":
			writeJSON(w, 200, []map[string]any{
				{"id": "machine-a", "runtimes": []map[string]any{{"id": "machine-a/trae", "provider": "trae"}, {"id": "machine-a/codex", "provider": "codex"}}},
				{"id": "machine-b", "runtimes": []map[string]any{{"id": "machine-b/codex", "provider": "codex"}}},
			})
		case r.URL.Path == "/v1/runs" && r.Method == http.MethodPost:
			var request relay.Request
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			mu.Lock()
			requests = append(requests, request)
			mu.Unlock()
			writeJSON(w, 202, map[string]any{"id": uuid.NewString(), "status": "running"})
		default:
			writeJSON(w, 200, []any{})
		}
	}))
	defer relayServer.Close()
	server := New(st, relayServer.URL, "", relayServer.URL, wid, nil)
	a, err := st.CreateAgent(ctx, wid, store.Agent{Name: "Primary", RuntimeProvider: "trae", Instructions: "primary profile"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := st.CreateAgent(ctx, wid, store.Agent{Name: "Delegate", RuntimeProvider: "codex", Instructions: "delegate profile"})
	if err != nil {
		t.Fatal(err)
	}
	foreignRuntime := "machine-b/codex"
	foreign, err := st.CreateAgent(ctx, wid, store.Agent{Name: "Elsewhere", RuntimeProvider: "codex", RuntimeID: &foreignRuntime})
	if err != nil {
		t.Fatal(err)
	}
	otherWid := "delegate-other-" + uuid.NewString()
	if err := st.EnsureWorkspace(ctx, otherWid, "Other"); err != nil {
		t.Fatal(err)
	}
	outsider, err := st.CreateAgent(ctx, otherWid, store.Agent{Name: "Other workspace", RuntimeProvider: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	lastRequest := func() relay.Request { mu.Lock(); defer mu.Unlock(); return requests[len(requests)-1] }
	count := func() int { mu.Lock(); defer mu.Unlock(); return len(requests) }
	finish := func(task submittedTask, text string) {
		t.Helper()
		if err := st.UpdateRun(ctx, wid, task.Run.ID, "succeeded", text, nil, 1); err != nil {
			t.Fatal(err)
		}
	}
	for _, kind := range []string{"local", "git"} {
		t.Run(kind, func(t *testing.T) {
			node := "machine-a"
			source := "/work/project"
			if kind == "git" {
				source = "https://example.com/repository.git"
			}
			project, err := st.CreateProject(ctx, wid, store.Project{Name: kind, WorkspaceKind: kind, WorkspaceSource: source, NodeID: &node, ExecutionMode: "session_worktree"})
			if err != nil {
				t.Fatal(err)
			}
			first, _, err := server.submitConversationTask(ctx, wid, chatRequest{AgentID: a.ID, ProjectID: &project.ID, Prompt: "private main conversation background"}, nil, "test")
			if err != nil {
				t.Fatal(err)
			}
			finish(first, "selected reference result")
			sid := first.Task.ConversationID
			parentRequest := lastRequest()
			delegated, _, err := server.submitConversationTask(ctx, wid, chatRequest{AgentID: a.ID, TargetAgentID: b.ID, SessionID: &sid, Prompt: "inspect this result", IdempotencyKey: uuid.NewString()}, nil, "test")
			if err != nil {
				t.Fatal(err)
			}
			request := lastRequest()
			delegatedSessionID := request.SessionID
			if request.SessionID == sid || request.AgentID != b.ID || request.Runtime.ID != "machine-a/codex" {
				t.Fatalf("delegation routing: %+v", request)
			}
			if request.Workspace != parentRequest.Workspace {
				t.Fatalf("delegate changed working directory/worktree: %+v vs %+v", request.Workspace, parentRequest.Workspace)
			}
			if strings.Contains(request.Input.Prompt, "private main conversation background") || !strings.Contains(request.Input.Prompt, "selected reference result") || !strings.Contains(request.Input.Prompt, "inspect this result") {
				t.Fatalf("incorrect delegated context: %s", request.Input.Prompt)
			}
			if len(request.Instructions.Agent) == 0 || request.Instructions.Agent[0].Content != "delegate profile" {
				t.Fatal("wrong Agent instructions")
			}
			session, err := st.Session(ctx, wid, sid)
			if err != nil {
				t.Fatal(err)
			}
			if session.AgentID != a.ID || value(session.ExecutionRuntimeID) != "machine-a/trae" {
				t.Fatalf("delegation replaced primary: %+v", session)
			}
			message, err := st.Message(ctx, wid, delegated.Assistant.ID)
			if err != nil {
				t.Fatal(err)
			}
			if message.Context == nil || !message.Context.Delegated || message.Context.AgentID != b.ID || message.Context.Reference == nil || message.Context.Reference.MessageID != first.Assistant.ID {
				t.Fatalf("attribution/reference not persisted: %+v", message)
			}
			if delegated.DelegationSession == nil || delegated.Task.ConversationID == sid || value(delegated.Task.ParentConversationID) != sid {
				t.Fatal("delegation did not create a child conversation")
			}
			child, err := st.Session(ctx, wid, delegated.Task.ConversationID)
			if err != nil {
				t.Fatal(err)
			}
			if child.AgentID != b.ID || value(child.ParentConversationID) != sid || child.WorkspaceKey != nil && value(child.WorkspaceKey) != value(session.WorkspaceKey) {
				t.Fatalf("child snapshot: %+v", child)
			}
			// Parent can start and complete another task while delegation is running.
			parallel, _, err := server.submitConversationTask(ctx, wid, chatRequest{AgentID: a.ID, SessionID: &sid, Prompt: "parallel write"}, nil, "test")
			if err != nil {
				t.Fatalf("parent blocked by delegation: %v", err)
			}
			if _, _, err := server.submitConversationTask(ctx, wid, chatRequest{AgentID: b.ID, SessionID: &child.ID, Prompt: "second child task"}, nil, "test"); err == nil {
				t.Fatal("child admitted two active tasks")
			}
			finish(delegated, "delegate result to hand back")
			finish(parallel, "primary task that started before delegation completed")
			parentMessages, err := st.Messages(ctx, wid, sid)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, m := range parentMessages {
				if m.ID == delegated.Assistant.ID && m.Content == "delegate result to hand back" {
					found = true
				}
			}
			if !found {
				t.Fatal("completed child result did not return to parent")
			}
			// Idempotent replay retains the same isolated run and immutable reference.
			replayIn := chatRequest{AgentID: a.ID, TargetAgentID: b.ID, SessionID: &sid, Prompt: "again", IdempotencyKey: value(delegated.Task.IdempotencyKey)}
			before := count()
			replay, reused, err := server.submitConversationTask(ctx, wid, replayIn, nil, "test")
			if err != nil || !reused || replay.Run.ID != delegated.Run.ID || count() != before {
				t.Fatalf("duplicate delegation: %v", err)
			}
			handoff, _, err := server.submitConversationTask(ctx, wid, chatRequest{AgentID: a.ID, SessionID: &sid, Prompt: "continue", ReferencedMessageID: delegated.Assistant.ID}, nil, "test")
			if err != nil {
				t.Fatal(err)
			}
			request = lastRequest()
			if request.SessionID != sid || !strings.Contains(request.Input.ContinuationPrompt, "delegate result to hand back") || !strings.Contains(request.Input.ContinuationPrompt, "private main conversation background") {
				t.Fatalf("primary missed delegated work: %+v", request)
			}
			finish(handoff, "main continued")
			ordinary, _, err := server.submitConversationTask(ctx, wid, chatRequest{AgentID: a.ID, SessionID: &sid, Prompt: "ordinary"}, nil, "test")
			if err != nil {
				t.Fatal(err)
			}
			if lastRequest().Input.ContinuationPrompt != "ordinary" {
				t.Fatal("continuous primary unnecessarily replayed shared context")
			}
			finish(ordinary, "ordinary done")
			for _, invalid := range []chatRequest{
				{AgentID: a.ID, TargetAgentID: foreign.ID, SessionID: &sid, Prompt: "wrong machine"},
				{AgentID: a.ID, TargetAgentID: outsider.ID, SessionID: &sid, Prompt: "wrong workspace"},
				{AgentID: a.ID, TargetAgentID: b.ID, SessionID: &sid, Prompt: "invalid quote", ReferencedMessageID: first.User.ID},
				{AgentID: a.ID, TargetAgentID: b.ID, SessionID: &sid, Prompt: "foreign quote", ReferencedMessageID: uuid.NewString()},
			} {
				before := count()
				if _, _, err := server.submitConversationTask(ctx, wid, invalid, nil, "test"); err == nil || count() != before {
					t.Fatal("invalid delegation accepted")
				}
			}
			noQuote, _, err := server.submitConversationTask(ctx, wid, chatRequest{AgentID: a.ID, TargetAgentID: b.ID, SessionID: &sid, Prompt: "independent task", ReferenceMode: "none"}, nil, "test")
			if err != nil {
				t.Fatal(err)
			}
			if noQuote.Assistant.Context.Reference != nil || strings.Contains(lastRequest().Input.Prompt, "ordinary done") || lastRequest().SessionID == delegatedSessionID {
				t.Fatal("suppressed quote or independent context ignored")
			}
			finish(noQuote, "independent done")
			childNext, _, err := server.submitConversationTask(ctx, wid, chatRequest{AgentID: b.ID, SessionID: &child.ID, Prompt: "follow up in the delegated conversation"}, nil, "test")
			if err != nil {
				t.Fatal(err)
			}
			if lastRequest().SessionID != child.ID || lastRequest().Workspace != parentRequest.Workspace {
				t.Fatal("child follow-up lost native session or parent worktree")
			}
			finish(childNext, "child followup done")

		})
	}
}

func TestResolveDelegationReference(t *testing.T) {
	messages := []store.Message{{ID: "user", Role: "user", Status: "complete", Content: "request"}, {ID: "done", Role: "agent", Status: "succeeded", Content: "answer"}, {ID: "running", Role: "agent", Status: "running", Content: "partial"}}
	reference, err := resolveMessageReference(messages, "", "", true)
	if err != nil || reference == nil || reference.MessageID != "done" {
		t.Fatalf("latest complete: %+v %v", reference, err)
	}
	for _, id := range []string{"user", "running", "other-conversation"} {
		if _, err := resolveMessageReference(messages, id, "explicit", true); err == nil {
			t.Fatalf("invalid quote %s", id)
		}
	}
	reference, err = resolveMessageReference(messages, "", "none", true)
	if err != nil || reference != nil {
		t.Fatal("removed quote restored")
	}
	if _, err := resolveMessageReference(messages, "done", "none", true); err == nil {
		t.Fatal("contradictory reference accepted")
	}
}

func TestDelegationHandoffSurvivesFailedPrimaryTurn(t *testing.T) {
	delegated := store.Message{ID: "delegated-message", Role: "agent", Status: "succeeded", Content: "delegated result", Context: &store.MessageContext{AgentID: "b", Delegated: true}}
	failedPrimary := store.Message{Role: "agent", Status: "failed", Context: &store.MessageContext{AgentID: "a"}}
	if !hasOtherAgentWork([]store.Message{delegated, failedPrimary}, "a") {
		t.Fatal("failed primary attempt consumed delegated context")
	}
	completedPrimary := store.Message{Role: "agent", Status: "succeeded", Content: "continued", Context: &store.MessageContext{AgentID: "a", SeenDelegationIDs: []string{"delegated-message"}}}
	if hasOtherAgentWork([]store.Message{delegated, failedPrimary, completedPrimary}, "a") {
		t.Fatal("completed primary turn kept replaying delegated context")
	}
	transcript := conversationPrompt([]store.Message{{Role: "user", Status: "complete", Content: "check this", Context: &store.MessageContext{AgentName: "Helper", Delegated: true, Reference: &store.MessageReference{AgentName: "Primary", Content: "selected older reply"}}}, delegated}, "continue")
	if !strings.Contains(transcript, "selected older reply") || !strings.Contains(transcript, "User (to Helper)") || !strings.Contains(transcript, "delegated result") {
		t.Fatalf("shared transcript lost reference or target: %s", transcript)
	}
}

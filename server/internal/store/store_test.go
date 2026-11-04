package store

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestUsersWorkspacesAndRuntimeIsolation(t *testing.T) {
	s, legacyWorkspaceID := testStore(t)
	ctx := context.Background()
	suffix := uuid.NewString()
	first, firstWorkspace, _, err := s.CreateUser(ctx, "first-"+suffix+"@example.test", "First", "hash", legacyWorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	second, secondWorkspace, _, err := s.CreateUser(ctx, "second-"+suffix+"@example.test", "Second", "hash", legacyWorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if firstWorkspace.ID == secondWorkspace.ID {
		t.Fatal("users received the same workspace")
	}
	if _, err := s.WorkspaceForUser(ctx, second.ID, firstWorkspace.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second user accessed first workspace: %v", err)
	}
	agent, err := s.CreateAgent(ctx, firstWorkspace.ID, Agent{Name: "Private", RuntimeProvider: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Agent(ctx, secondWorkspace.ID, agent.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("agent crossed workspace boundary: %v", err)
	}
	enrollment, err := s.CreateRelayNodeEnrollment(ctx, first.ID, "enrollment-"+suffix, "node-"+suffix, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.EnrollRelayNode(ctx, enrollment.TokenHash, "wrong-"+suffix, "Wrong Node", 2, "online", time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("enrollment accepted a different Node ID: %v", err)
	}
	node, err := s.EnrollRelayNode(ctx, enrollment.TokenHash, "node-"+suffix, "Shared machine", 2, "online", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.EnrollRelayNode(ctx, enrollment.TokenHash, "node-"+suffix, "Replay", 2, "online", time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("one-time enrollment token was reused: %v", err)
	}
	expired, err := s.CreateRelayNodeEnrollment(ctx, first.ID, "expired-"+suffix, "expired-"+suffix, time.Now().Add(-time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.EnrollRelayNode(ctx, expired.TokenHash, "expired-"+suffix, "Expired", 2, "online", time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired enrollment token was accepted: %v", err)
	}
	ownedNodes, err := s.RelayNodesForOwner(ctx, first.ID)
	if err != nil || len(ownedNodes) != 1 || ownedNodes[0].ID != node.ID {
		t.Fatalf("owner nodes = %+v: %v", ownedNodes, err)
	}
	otherNodes, err := s.RelayNodesForOwner(ctx, second.ID)
	if err != nil || len(otherNodes) != 0 {
		t.Fatalf("second user saw first user's Node: %+v, %v", otherNodes, err)
	}
	physicalRuntimeID := node.ID + "/codex"
	if err := s.SyncRelayNode(ctx, node.ID, node.Name, node.Capacity, "online", time.Now(), []RelayNodeRuntime{{ID: physicalRuntimeID, NodeID: node.ID, Provider: "codex", State: "healthy"}}); err != nil {
		t.Fatal(err)
	}
	sharedWorkspace, err := s.CreateWorkspace(ctx, first.ID, "Shared target")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.BindRelayNodeRuntimes(ctx, firstWorkspace.ID, first.ID, node.ID, []string{physicalRuntimeID}); err != nil {
		t.Fatal(err)
	}
	if err := s.BindRelayNodeRuntimes(ctx, secondWorkspace.ID, second.ID, node.ID, []string{physicalRuntimeID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second user bound first user's Node: %v", err)
	}
	// The test user owns both workspaces. Sharing the same physical Runtime
	// creates independent logical Runtime identities for each workspace.
	if err := s.BindRelayNodeRuntimes(ctx, sharedWorkspace.ID, first.ID, node.ID, []string{physicalRuntimeID}); err != nil {
		t.Fatal(err)
	}
	firstBindings, err := s.WorkspaceRuntimeBindings(ctx, firstWorkspace.ID)
	if err != nil || len(firstBindings) != 1 {
		t.Fatalf("first workspace bindings = %+v: %v", firstBindings, err)
	}
	secondBindings, err := s.WorkspaceRuntimeBindings(ctx, sharedWorkspace.ID)
	if err != nil || len(secondBindings) != 1 {
		t.Fatalf("second workspace bindings = %+v: %v", secondBindings, err)
	}
	if firstBindings[0].ID == secondBindings[0].ID {
		t.Fatal("workspaces received the same logical Runtime identity")
	}
	_, firstRuntime, err := s.ResolveRuntimeBinding(ctx, firstWorkspace.ID, firstBindings[0].ID)
	if err != nil || firstRuntime.ID != physicalRuntimeID {
		t.Fatalf("first binding resolved to %+v: %v", firstRuntime, err)
	}
	_, secondRuntime, err := s.ResolveRuntimeBinding(ctx, sharedWorkspace.ID, secondBindings[0].ID)
	if err != nil || secondRuntime.ID != physicalRuntimeID {
		t.Fatalf("second binding resolved to %+v: %v", secondRuntime, err)
	}
	if err := s.DisconnectRuntimeBinding(ctx, firstWorkspace.ID, firstBindings[0].ID); err != nil {
		t.Fatalf("disconnect first workspace binding: %v", err)
	}
	if _, _, err := s.ResolveRuntimeBinding(ctx, firstWorkspace.ID, firstBindings[0].ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("disconnected binding still resolved: %v", err)
	}
	if _, runtime, err := s.ResolveRuntimeBinding(ctx, sharedWorkspace.ID, secondBindings[0].ID); err != nil || runtime.ID != physicalRuntimeID {
		t.Fatalf("disconnect affected the other workspace: %+v, %v", runtime, err)
	}
	inUseBindingID := secondBindings[0].ID
	if _, err := s.CreateAgent(ctx, sharedWorkspace.ID, Agent{Name: "Pinned", RuntimeProvider: "codex", RuntimeID: &inUseBindingID}); err != nil {
		t.Fatal(err)
	}
	if err := s.DisconnectRuntimeBinding(ctx, sharedWorkspace.ID, inUseBindingID); !errors.Is(err, ErrRuntimeBindingInUse) {
		t.Fatalf("disconnected an in-use binding: %v", err)
	}
	if err := s.CreateAuthSession(ctx, first.ID, "token-"+suffix, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	resolved, err := s.UserBySession(ctx, "token-"+suffix)
	if err != nil || resolved.ID != first.ID {
		t.Fatalf("session resolved %+v: %v", resolved, err)
	}
}

func testStore(t *testing.T) (*Store, string) {
	t.Helper()
	url := os.Getenv("STEER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set STEER_TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	wid := "test-" + uuid.NewString()
	if err := s.EnsureWorkspace(ctx, wid, "Test workspace"); err != nil {
		t.Fatal(err)
	}
	return s, wid
}

func TestConversationRunAndArtifact(t *testing.T) {
	s, wid := testStore(t)
	ctx := context.Background()
	agent, err := s.CreateAgent(ctx, wid, Agent{Name: "Builder", RuntimeProvider: "test"})
	if err != nil {
		t.Fatal(err)
	}
	runtimeID := "node/test"
	project, err := s.CreateProject(ctx, wid, Project{Name: "Repository", WorkspaceKind: "local", WorkspaceSource: "/srv/repository", ExecutionMode: "in_place", RuntimeID: &runtimeID})
	if err != nil {
		t.Fatal(err)
	}
	sessionID, runID := uuid.NewString(), uuid.NewString()
	workspaceKey := "steer/" + wid + "/" + sessionID
	if _, err := s.EnsureSession(ctx, wid, sessionID, "Inspect repository", agent.ID, &project.ID, &runtimeID, &workspaceKey, &project); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SaveChatRun(ctx, wid, sessionID, agent.ID, "Inspect repository", runID, "running"); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateRun(ctx, wid, runID, "succeeded", "Inspection complete", nil, 4); err != nil {
		t.Fatal(err)
	}
	link, err := s.RunLink(ctx, wid, runID)
	if err != nil || link.SessionID == nil || *link.SessionID != sessionID {
		t.Fatalf("invalid run link: %+v, %v", link, err)
	}
	if err := s.UpsertArtifact(ctx, wid, link, uuid.NewString(), "report.md", "report", "/content", "text/markdown", 100); err != nil {
		t.Fatal(err)
	}
	artifacts, err := s.Artifacts(ctx, wid)
	if err != nil || len(artifacts) != 1 || artifacts[0].State != "ready" {
		t.Fatalf("invalid artifacts: %+v, %v", artifacts, err)
	}
	session, err := s.Session(ctx, wid, sessionID)
	if err != nil || session.ProjectID == nil || *session.ProjectID != project.ID {
		t.Fatalf("project was not retained: %+v, %v", session, err)
	}
	snapshot := json.RawMessage(`{"version":1,"scope":"conversation","title":"Inspect repository","messages":[]}`)
	shareHash := "lookup-" + uuid.NewString()
	if err := s.CreateSharedConversation(ctx, SharedConversation{WorkspaceID: wid, SessionID: sessionID, TokenHash: shareHash, Snapshot: snapshot}); err != nil {
		t.Fatal(err)
	}
	shared, err := s.SharedConversationByToken(ctx, shareHash)
	if err != nil || string(shared.Snapshot) != string(snapshot) || shared.SessionID != sessionID {
		t.Fatalf("invalid share: %+v, %v", shared, err)
	}
}

func TestTaskAndWorkspaceAPIKeyLifecycle(t *testing.T) {
	s, wid := testStore(t)
	ctx := context.Background()
	agent, err := s.CreateAgent(ctx, wid, Agent{Name: "Task Agent", RuntimeProvider: "test"})
	if err != nil {
		t.Fatal(err)
	}
	sessionID, runID := uuid.NewString(), uuid.NewString()
	if _, err := s.EnsureSession(ctx, wid, sessionID, "API task", agent.ID, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	idempotencyKey := "request-" + uuid.NewString()
	user, assistant, task, err := s.SaveTaskRun(ctx, wid, sessionID, agent.ID, "Continue", runID, "running", Task{
		ID: uuid.NewString(), Source: "api", IdempotencyKey: &idempotencyKey, Metadata: json.RawMessage(`{"source":"test"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if task.ConversationID != sessionID || task.RelayRunID != runID || task.UserMessageID != user.ID || task.AssistantMessageID != assistant.ID {
		t.Fatalf("task was not linked to conversation messages: %+v", task)
	}
	resolved, err := s.TaskByIdempotencyKey(ctx, wid, idempotencyKey)
	if err != nil || resolved.ID != task.ID {
		t.Fatalf("idempotency lookup returned %+v: %v", resolved, err)
	}
	if err := s.UpdateRun(ctx, wid, runID, "succeeded", "Complete", nil, 3); err != nil {
		t.Fatal(err)
	}
	resolved, err = s.Task(ctx, wid, task.ID)
	if err != nil || resolved.Status != "succeeded" || resolved.Result == nil || *resolved.Result != "Complete" || resolved.CompletedAt == nil {
		t.Fatalf("task completion was not projected: %+v: %v", resolved, err)
	}

	ownerID := "owner-" + uuid.NewString()
	key, err := s.CreateWorkspaceAPIKey(ctx, WorkspaceAPIKey{
		WorkspaceID: wid, Name: "Automation", TokenHash: "hash-" + uuid.NewString(), TokenPrefix: "steer_sk_example", Scopes: []string{"tasks:read"}, CreatedByUserID: ownerID,
	})
	if err != nil {
		t.Fatal(err)
	}
	resolvedKey, err := s.WorkspaceAPIKeyByToken(ctx, key.TokenHash)
	if err != nil || resolvedKey.ID != key.ID || resolvedKey.LastUsedAt == nil {
		t.Fatalf("API key lookup returned %+v: %v", resolvedKey, err)
	}
	if _, err := s.RevokeWorkspaceAPIKey(ctx, wid, key.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.WorkspaceAPIKeyByToken(ctx, key.TokenHash); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked API key still resolved: %v", err)
	}
}

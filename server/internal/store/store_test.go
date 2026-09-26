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
	if err := s.AssignRuntime(ctx, firstWorkspace.ID, "node/runtime"); err != nil {
		t.Fatal(err)
	}
	if err := s.AssignRuntime(ctx, secondWorkspace.ID, "node/runtime"); !errors.Is(err, ErrConflict) {
		t.Fatalf("runtime was assigned to two workspaces: %v", err)
	}
	if err := s.AssignRuntime(ctx, secondWorkspace.ID, "node/claimed"); err != nil {
		t.Fatal(err)
	}
	if err := s.AssignRuntimes(ctx, firstWorkspace.ID, []string{"node/new", "node/claimed"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("batch claim should conflict: %v", err)
	}
	if assigned, err := s.RuntimeAssigned(ctx, firstWorkspace.ID, "node/new"); err != nil || assigned {
		t.Fatalf("failed batch claim was not atomic: assigned=%t err=%v", assigned, err)
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

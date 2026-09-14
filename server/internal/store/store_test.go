package store

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
)

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
}

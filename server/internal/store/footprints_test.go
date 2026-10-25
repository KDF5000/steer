package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestFootprintReportScopeAndTimestamp(t *testing.T) {
	s, wid := testStore(t)
	ctx := context.Background()
	agent, err := s.CreateAgent(ctx, wid, Agent{Name: "Builder", RuntimeProvider: "test"})
	if err != nil {
		t.Fatal(err)
	}
	project, err := s.CreateProject(ctx, wid, Project{Name: "Steer", WorkspaceKind: "local", WorkspaceSource: "/srv/steer", ExecutionMode: "in_place"})
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	sessionID := uuid.NewString()
	if _, err := s.pool.Exec(ctx, `INSERT INTO chat_sessions(id,workspace_id,title,agent_id,project_id) VALUES($1,$2,'Scope test',$3,$4)`, sessionID, wid, agent.ID, project.ID); err != nil {
		t.Fatal(err)
	}
	// User messages stay on their send date after projection updates/retries.
	// Agent replies belong to the date they were persisted.
	for _, m := range []struct {
		role, content    string
		created, updated time.Time
	}{
		{"user", "Sent in range", from.Add(time.Hour), to.Add(time.Hour)},
		{"agent", "Completed in range", from.Add(-time.Hour), from.Add(2 * time.Hour)},
		{"user", "Sent before range", from.Add(-time.Hour), from.Add(3 * time.Hour)},
		{"agent", "At exclusive end", to, to},
	} {
		if _, err := s.pool.Exec(ctx, `INSERT INTO messages(id,workspace_id,session_id,role,content,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'complete',$6,$7)`, uuid.NewString(), wid, sessionID, m.role, m.content, m.created, m.updated); err != nil {
			t.Fatal(err)
		}
	}
	items, err := s.FootprintReportActivities(ctx, wid, from, to, project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ProjectName != "Steer" || items[0].MessageCount != 2 {
		t.Fatalf("unexpected inputs: %+v", items)
	}
	if items[0].Messages[0].Content != "Sent in range" || items[0].Messages[1].Content != "Completed in range" {
		t.Fatalf("wrong message scope: %+v", items[0].Messages)
	}
	sessions, err := s.FootprintSessions(ctx, wid, from, to, project.ID, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0].UserMessages != 1 || sessions[0].AgentMessages != 1 {
		t.Fatalf("overview/report disagree: %+v", sessions)
	}
	for _, scope := range []struct{ workspace, project string }{{wid, uuid.NewString()}, {uuid.NewString(), project.ID}} {
		items, err := s.FootprintReportActivities(ctx, scope.workspace, from, to, scope.project)
		if err != nil || len(items) != 0 {
			t.Fatalf("scope leaked: %+v %v", items, err)
		}
	}
	legacy, err := s.AgentActivities(ctx, wid, from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(legacy) != 1 || legacy[0].Messages[1].Content != "Sent before range" {
		t.Fatalf("legacy work log changed: %+v", legacy)
	}
}

func TestFootprintReportSaveAndRunAcknowledgementAreAtomic(t *testing.T) {
	s, wid := testStore(t)
	ctx := context.Background()
	from := time.Now().UTC()
	item := FootprintReport{Title: "Weekly review", Content: "Reviewed work.", From: from, To: from.Add(time.Hour)}
	if _, err := s.SaveFootprintReportFromRun(ctx, wid, item, "unknown-run"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("invalid run accepted: %v", err)
	}
	reports, err := s.FootprintReports(ctx, wid)
	if err != nil || len(reports) != 0 {
		t.Fatalf("failed save persisted: %+v %v", reports, err)
	}
	runID := uuid.NewString()
	if _, err := s.pool.Exec(ctx, `INSERT INTO run_links(relay_run_id,workspace_id,purpose,agent_id,status) VALUES($1,$2,'footprint_report','system','succeeded')`, runID, wid); err != nil {
		t.Fatal(err)
	}
	saved, err := s.SaveFootprintReportFromRun(ctx, wid, item, runID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID == "" || saved.SourceSessionIDs == nil {
		t.Fatalf("invalid saved report: %+v", saved)
	}
	var acknowledged bool
	if err := s.pool.QueryRow(ctx, `SELECT acknowledged_at IS NOT NULL FROM run_links WHERE relay_run_id=$1`, runID).Scan(&acknowledged); err != nil || !acknowledged {
		t.Fatalf("run not acknowledged: %v", err)
	}
	saved.Title = "Edited"
	edited, err := s.SaveFootprintReport(ctx, wid, saved)
	if err != nil || edited.Title != "Edited" {
		t.Fatalf("edit failed: %+v %v", edited, err)
	}
	if _, err := s.SaveFootprintReport(ctx, "other-workspace", saved); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-workspace overwrite: %v", err)
	}
}

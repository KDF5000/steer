package store

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/KDF5000/relay"
	"github.com/google/uuid"
)

func TestRunUsageDeduplicationScopeAndCompletionDate(t *testing.T) {
	s, wid := testStore(t)
	ctx := context.Background()
	agent, err := s.CreateAgent(ctx, wid, Agent{Name: "Builder", RuntimeProvider: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	project, err := s.CreateProject(ctx, wid, Project{Name: "Steer", WorkspaceKind: "local", WorkspaceSource: "/srv/steer", ExecutionMode: "in_place"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := s.EnsureSession(ctx, wid, uuid.NewString(), "Parent", agent.ID, &project.ID, nil, nil, &project)
	if err != nil {
		t.Fatal(err)
	}
	child, err := s.EnsureSession(ctx, wid, uuid.NewString(), "Delegation", agent.ID, &project.ID, nil, nil, &project)
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 10, 25, 16, 0, 0, 0, time.UTC)
	completed := from.Add(2 * time.Hour)
	to := from.Add(24 * time.Hour)
	num := func(n int64) *int64 { return &n }
	makeRun := func(id, sessionID, status string) relay.Run {
		if _, _, err := s.SaveChatRun(ctx, wid, sessionID, agent.ID, "work", id, status); err != nil {
			t.Fatal(err)
		}
		return relay.Run{ID: id, Status: relay.RunStatus(status), CompletedAt: &completed, Attempt: relay.Attempt{Number: 1}, Runtime: relay.RuntimeRequirement{Provider: "codex", ID: "node/codex", Model: "model"}}
	}
	snap := func(run, attempt string, sequence int, tokens int64, status string) relay.Event {
		raw, _ := json.Marshal(TokenUsage{InputTokens: num(tokens), OutputTokens: num(20), TotalTokens: num(tokens + 20), CacheReadTokens: num(tokens / 2), Status: status, Source: "codex"})
		return relay.Event{RunID: run, AttemptID: attempt, Sequence: sequence, Type: "usage.updated", Data: raw}
	}
	run := makeRun(uuid.NewString(), child.ID, "succeeded")
	events := []relay.Event{snap(run.ID, "a", 1, 100, "partial"), snap(run.ID, "a", 2, 200, "complete")}
	for range 2 {
		if err := s.SaveRunUsage(ctx, wid, run, events); err != nil {
			t.Fatal(err)
		}
	}
	// A parent mirror must not add another execution's worth of usage.
	if _, err := s.pool.Exec(ctx, `INSERT INTO messages(id,workspace_id,session_id,role,content,status,relay_run_id) VALUES($1,$2,$3,'agent','Delegation returned','succeeded',$4)`, uuid.NewString(), wid, session.ID, run.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveRunUsage(ctx, wid, run, events[:1]); err != nil {
		t.Fatal(err)
	}
	unknown := makeRun(uuid.NewString(), session.ID, "failed")
	if err := s.SaveRunUsage(ctx, wid, unknown, nil); err != nil {
		t.Fatal(err)
	}
	partial := makeRun(uuid.NewString(), session.ID, "cancelled")
	partial.Attempt.Number = 2
	partialEvents := []relay.Event{snap(partial.ID, "a", 1, 50, "complete"), snap(partial.ID, "b", 2, 30, "partial")}
	if err := s.SaveRunUsage(ctx, wid, partial, partialEvents); err != nil {
		t.Fatal(err)
	}
	// System/report-generation usage is recorded but excluded from chat totals.
	systemID := uuid.NewString()
	if err := s.SaveSystemRun(ctx, wid, agent.ID, "footprint_report", systemID, "succeeded"); err != nil {
		t.Fatal(err)
	}
	system := run
	system.ID = systemID
	if err := s.SaveRunUsage(ctx, wid, system, []relay.Event{snap(systemID, "a", 1, 9000, "complete")}); err != nil {
		t.Fatal(err)
	}
	totals, sessions, days, err := s.FootprintUsage(ctx, wid, from, to, project.ID, "Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	if totals.TokenCount == nil || *totals.TokenCount != 340 || totals.TokenCoverage != 1 || totals.PartialRuns != 1 || totals.TotalRuns != 3 {
		t.Fatalf("wrong usage %+v", totals)
	}
	if len(sessions) != 2 || len(days) != 1 || days[0].Day != "2026-10-26" {
		t.Fatalf("wrong attribution sessions=%+v days=%+v", sessions, days)
	}
	for _, u := range sessions {
		if u.SessionID == child.ID && *u.TokenCount != 220 {
			t.Fatal("child run duplicated")
		}
	}
	for _, scope := range []struct{ workspace, project string }{{wid, uuid.NewString()}, {uuid.NewString(), project.ID}} {
		total, _, _, err := s.FootprintUsage(ctx, scope.workspace, from, to, scope.project, "UTC")
		if err != nil || total.TokenCount != nil || total.TotalRuns != 0 {
			t.Fatalf("scope leaked %+v %v", total, err)
		}
	}
	total, _, _, err := s.FootprintUsage(ctx, wid, completed, to, project.ID, "UTC")
	if err != nil || total.TotalRuns != 3 {
		t.Fatal("inclusive start lost")
	}
	total, _, _, err = s.FootprintUsage(ctx, wid, from, completed, project.ID, "UTC")
	if err != nil || total.TotalRuns != 0 {
		t.Fatal("exclusive end included")
	}
	var provider, runtimeID, model string
	if err := s.pool.QueryRow(ctx, `SELECT provider,runtime_id,model FROM run_usage WHERE relay_run_id=$1`, run.ID).Scan(&provider, &runtimeID, &model); err != nil || provider != "codex" || runtimeID != "node/codex" || model != "model" {
		t.Fatalf("lost execution identity: %v", err)
	}
}
func TestTokenUsageValidation(t *testing.T) {
	for _, raw := range []string{`{"status":"complete"}`, `{"input_tokens":-1,"status":"partial"}`, `{"input_tokens":100,"output_tokens":20,"total_tokens":999,"status":"complete"}`, `{"input_tokens":100,"output_tokens":20,"total_tokens":120,"cache_read_tokens":101,"status":"complete"}`} {
		var u TokenUsage
		if err := json.Unmarshal([]byte(raw), &u); err == nil && u.Valid() {
			t.Fatalf("accepted malformed usage %s", raw)
		}
	}
}

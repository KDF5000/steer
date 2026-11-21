package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type CodebaseWorkflow struct {
	ID                string `json:"id"`
	WorkspaceID       string `json:"workspaceId"`
	Name              string `json:"name"`
	RepoPath          string `json:"repoPath"`
	RepoID            string `json:"repoId"`
	RepoName          string `json:"repoName"`
	AgentID           string `json:"agentId"`
	ReviewInstruction string `json:"reviewInstruction"`
	// Model and ReasoningEffort pin how the reviewer runs. Empty values follow
	// the Agent or Runtime defaults.
	Model           string   `json:"model"`
	ReasoningEffort string   `json:"reasoningEffort"`
	SkillIDs        []string `json:"skillIds"`
	// TriggerWebhook starts a review when Codebase sends a merge request event.
	ReportEnabled  bool      `json:"reportEnabled"`
	TriggerWebhook bool      `json:"triggerWebhook"`
	Enabled        bool      `json:"enabled"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type CodebaseRun struct {
	ID              string `json:"id"`
	WorkspaceID     string `json:"workspaceId"`
	WorkflowID      string `json:"workflowId"`
	RepoPath        string `json:"repoPath"`
	RepoID          string `json:"repoId"`
	MRIID           int    `json:"mrIid"`
	MRTitle         string `json:"mrTitle"`
	MRURL           string `json:"mrUrl"`
	Trigger         string `json:"trigger"`
	Status          string `json:"status"`
	Summary         string `json:"summary"`
	Error           string `json:"error"`
	TaskID          string `json:"taskId"`
	ConversationID  string `json:"conversationId"`
	Model           string `json:"model"`
	ReasoningEffort string `json:"reasoningEffort"`
	// ReportStatus tracks writing the summary back to the Codebase merge
	// request: "" (not attempted), "sending", "sent", "failed", "skipped".
	ReportStatus string     `json:"reportStatus"`
	ReportError  string     `json:"reportError"`
	ReportURL    string     `json:"reportUrl"`
	StartedAt    *time.Time `json:"startedAt"`
	FinishedAt   *time.Time `json:"finishedAt"`
	CreatedAt    time.Time  `json:"createdAt"`
}

const codebaseWorkflowColumns = `id,workspace_id,name,repo_path,repo_id,repo_name,agent_id,review_instruction,model,reasoning_effort,skill_ids,trigger_webhook,report_enabled,enabled,created_at,updated_at`

func scanCodebaseWorkflow(row pgx.Row) (CodebaseWorkflow, error) {
	var item CodebaseWorkflow
	err := row.Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.RepoPath, &item.RepoID, &item.RepoName, &item.AgentID, &item.ReviewInstruction, &item.Model, &item.ReasoningEffort, &item.SkillIDs, &item.TriggerWebhook, &item.ReportEnabled, &item.Enabled, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (s *Store) CodebaseWorkflows(ctx context.Context, wid string) ([]CodebaseWorkflow, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+codebaseWorkflowColumns+` FROM codebase_workflows WHERE workspace_id=$1 ORDER BY created_at`, wid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []CodebaseWorkflow{}
	for rows.Next() {
		item, err := scanCodebaseWorkflow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) CodebaseWorkflow(ctx context.Context, wid, id string) (CodebaseWorkflow, error) {
	return scanCodebaseWorkflow(s.pool.QueryRow(ctx, `SELECT `+codebaseWorkflowColumns+` FROM codebase_workflows WHERE workspace_id=$1 AND id=$2`, wid, id))
}

func (s *Store) CreateCodebaseWorkflow(ctx context.Context, item CodebaseWorkflow) (CodebaseWorkflow, error) {
	if item.SkillIDs == nil {
		item.SkillIDs = []string{}
	}
	return scanCodebaseWorkflow(s.pool.QueryRow(ctx, `INSERT INTO codebase_workflows(id,workspace_id,name,repo_path,repo_id,repo_name,agent_id,review_instruction,model,reasoning_effort,skill_ids,trigger_webhook,report_enabled,enabled)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING `+codebaseWorkflowColumns, item.ID, item.WorkspaceID, item.Name, item.RepoPath, item.RepoID, item.RepoName, item.AgentID, item.ReviewInstruction, item.Model, item.ReasoningEffort, item.SkillIDs, item.TriggerWebhook, item.ReportEnabled, item.Enabled))
}

func (s *Store) UpdateCodebaseWorkflow(ctx context.Context, item CodebaseWorkflow) (CodebaseWorkflow, error) {
	if item.SkillIDs == nil {
		item.SkillIDs = []string{}
	}
	return scanCodebaseWorkflow(s.pool.QueryRow(ctx, `UPDATE codebase_workflows SET name=$3,repo_path=$4,repo_id=$5,repo_name=$6,agent_id=$7,review_instruction=$8,model=$9,reasoning_effort=$10,skill_ids=$11,trigger_webhook=$12,report_enabled=$13,enabled=$14,updated_at=now()
WHERE workspace_id=$1 AND id=$2 RETURNING `+codebaseWorkflowColumns, item.WorkspaceID, item.ID, item.Name, item.RepoPath, item.RepoID, item.RepoName, item.AgentID, item.ReviewInstruction, item.Model, item.ReasoningEffort, item.SkillIDs, item.TriggerWebhook, item.ReportEnabled, item.Enabled))
}

func (s *Store) DeleteCodebaseWorkflow(ctx context.Context, wid, id string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Repositories and their synced merge requests are managed independently,
	// so deleting a workflow never removes repository data.
	tag, err := tx.Exec(ctx, `DELETE FROM codebase_workflows WHERE workspace_id=$1 AND id=$2`, wid, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return tx.Commit(ctx)
}

const codebaseRunColumns = `id,workspace_id,workflow_id,repo_path,repo_id,mr_iid,mr_title,mr_url,trigger,status,summary,error,task_id,conversation_id,model,reasoning_effort,report_status,report_error,report_url,started_at,finished_at,created_at`

func scanCodebaseRun(row pgx.Row) (CodebaseRun, error) {
	var item CodebaseRun
	err := row.Scan(&item.ID, &item.WorkspaceID, &item.WorkflowID, &item.RepoPath, &item.RepoID, &item.MRIID, &item.MRTitle, &item.MRURL, &item.Trigger, &item.Status, &item.Summary, &item.Error, &item.TaskID, &item.ConversationID, &item.Model, &item.ReasoningEffort, &item.ReportStatus, &item.ReportError, &item.ReportURL, &item.StartedAt, &item.FinishedAt, &item.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (s *Store) CreateCodebaseRun(ctx context.Context, item CodebaseRun) (CodebaseRun, error) {
	return scanCodebaseRun(s.pool.QueryRow(ctx, `INSERT INTO codebase_runs(id,workspace_id,workflow_id,repo_path,repo_id,mr_iid,mr_title,mr_url,trigger,status,summary,error,task_id,conversation_id,model,reasoning_effort,report_status,report_error,report_url,started_at,finished_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING `+codebaseRunColumns, item.ID, item.WorkspaceID, item.WorkflowID, item.RepoPath, item.RepoID, item.MRIID, item.MRTitle, item.MRURL, item.Trigger, item.Status, item.Summary, item.Error, item.TaskID, item.ConversationID, item.Model, item.ReasoningEffort, item.ReportStatus, item.ReportError, item.ReportURL, item.StartedAt, item.FinishedAt))
}

// CodebaseRuns lists runs for a workspace, optionally filtered by workflow or
// repository. limit is clamped to [1, 500]; passing 0 uses the default of 100.
func (s *Store) CodebaseRuns(ctx context.Context, wid, workflowID, repoID string, limit int) ([]CodebaseRun, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if workflowID != "" {
		rows, err := s.pool.Query(ctx, `SELECT `+codebaseRunColumns+` FROM codebase_runs WHERE workspace_id=$1 AND workflow_id=$2 ORDER BY created_at DESC LIMIT $3`, wid, workflowID, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanCodebaseRuns(rows)
	}
	if repoID != "" {
		rows, err := s.pool.Query(ctx, `SELECT `+codebaseRunColumns+` FROM codebase_runs WHERE workspace_id=$1 AND repo_id=$2 ORDER BY created_at DESC LIMIT $3`, wid, repoID, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanCodebaseRuns(rows)
	}
	rows, err := s.pool.Query(ctx, `SELECT `+codebaseRunColumns+` FROM codebase_runs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT $2`, wid, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCodebaseRuns(rows)
}

func scanCodebaseRuns(rows pgx.Rows) ([]CodebaseRun, error) {
	items := []CodebaseRun{}
	for rows.Next() {
		item, err := scanCodebaseRun(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) CodebaseRun(ctx context.Context, wid, id string) (CodebaseRun, error) {
	return scanCodebaseRun(s.pool.QueryRow(ctx, `SELECT `+codebaseRunColumns+` FROM codebase_runs WHERE workspace_id=$1 AND id=$2`, wid, id))
}

// UpdateCodebaseRun records task linkage and terminal status for a run.
func (s *Store) UpdateCodebaseRun(ctx context.Context, wid, id, status, summary, runErr, taskID, conversationID string, started, finished *time.Time) (CodebaseRun, error) {
	return scanCodebaseRun(s.pool.QueryRow(ctx, `UPDATE codebase_runs
SET status=COALESCE(NULLIF($3,''),status), summary=COALESCE(NULLIF($4,''),summary), error=COALESCE(NULLIF($5,''),error),
    task_id=COALESCE(NULLIF($6,''),task_id), conversation_id=COALESCE(NULLIF($7,''),conversation_id),
    started_at=COALESCE($8,started_at), finished_at=COALESCE($9,finished_at)
WHERE workspace_id=$1 AND id=$2 RETURNING `+codebaseRunColumns, wid, id, status, summary, runErr, taskID, conversationID, started, finished))
}

// ClaimCodebaseRunReport reserves the writeback for a successful run. It is a
// compare-and-set so parallel sync calls cannot post the same review twice.
func (s *Store) ClaimCodebaseRunReport(ctx context.Context, wid, id string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE codebase_runs SET report_status='sending', report_error='', report_attempts=report_attempts+1
WHERE workspace_id=$1 AND id=$2 AND status='succeeded' AND report_status IN ('','failed')`, wid, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) UpdateCodebaseRunReport(ctx context.Context, wid, id, status, reportErr, reportURL string) (CodebaseRun, error) {
	return scanCodebaseRun(s.pool.QueryRow(ctx, `UPDATE codebase_runs
SET report_status=$3, report_error=$4, report_url=COALESCE(NULLIF($5,''),report_url)
WHERE workspace_id=$1 AND id=$2 RETURNING `+codebaseRunColumns, wid, id, status, reportErr, reportURL))
}

// CodebaseRunForMergeRequest returns the latest run of a workflow for an MR.
// Webhook deliveries that repeat an already-started review reuse that run
// instead of queueing a second Agent task for the same MR revision.
func (s *Store) CodebaseRunForMergeRequest(ctx context.Context, wid, workflowID string, mrIID int) (CodebaseRun, error) {
	return scanCodebaseRun(s.pool.QueryRow(ctx, `SELECT `+codebaseRunColumns+` FROM codebase_runs
WHERE workspace_id=$1 AND workflow_id=$2 AND mr_iid=$3 AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1`, wid, workflowID, mrIID))
}

// ActiveCodebaseRuns lists runs that still need Relay polling. The background
// worker uses it so reviews finish and report even when no browser is open.
func (s *Store) ActiveCodebaseRuns(ctx context.Context, limit int) ([]CodebaseRun, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `SELECT `+codebaseRunColumns+` FROM codebase_runs
WHERE status IN ('pending','running') AND task_id<>'' ORDER BY created_at LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCodebaseRuns(rows)
}

// CodebaseRunsNeedingReport lists successful runs whose summary was never
// written back (or the writeback failed), for retry by the worker. The attempt
// budget keeps a permanently failing writeback from retrying on every tick; a
// manual sync can still retry once the configuration is fixed.
func (s *Store) CodebaseRunsNeedingReport(ctx context.Context, limit int) ([]CodebaseRun, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `SELECT `+codebaseRunColumns+` FROM codebase_runs
WHERE status='succeeded' AND report_status IN ('','failed') AND report_attempts < 5 ORDER BY finished_at DESC NULLS LAST LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCodebaseRuns(rows)
}

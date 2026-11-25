package store

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
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
	ReportEnabled      bool      `json:"reportEnabled"`
	TriggerWebhook     bool      `json:"triggerWebhook"`
	SkipDraft          bool      `json:"skipDraft"`
	AutoLabelEnabled   bool      `json:"autoLabelEnabled"`
	AutoApproveEnabled bool      `json:"autoApproveEnabled"`
	RequireCIGreen     bool      `json:"requireCiGreen"`
	Enabled            bool      `json:"enabled"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type CodebaseRun struct {
	ID              string          `json:"id"`
	WorkspaceID     string          `json:"workspaceId"`
	WorkflowID      string          `json:"workflowId"`
	RepoPath        string          `json:"repoPath"`
	RepoID          string          `json:"repoId"`
	MRIID           int             `json:"mrIid"`
	MRTitle         string          `json:"mrTitle"`
	MRURL           string          `json:"mrUrl"`
	HeadSHA         string          `json:"headSha"`
	Round           int             `json:"round"`
	Trigger         string          `json:"trigger"`
	Status          string          `json:"status"`
	Summary         string          `json:"summary"`
	ReviewJSON      json.RawMessage `json:"reviewJson,omitempty"`
	RiskLevel       string          `json:"riskLevel"`
	RiskFloor       string          `json:"riskFloor"`
	ReviewTrack     string          `json:"reviewTrack"`
	Disposition     string          `json:"disposition"`
	MergePolicy     string          `json:"mergePolicy"`
	Error           string          `json:"error"`
	TaskID          string          `json:"taskId"`
	ConversationID  string          `json:"conversationId"`
	Model           string          `json:"model"`
	ReasoningEffort string          `json:"reasoningEffort"`
	// ReportStatus tracks writing the summary back to the Codebase merge
	// request: "" (not attempted), "sending", "sent", "failed", "skipped".
	ReportStatus      string     `json:"reportStatus"`
	ReportError       string     `json:"reportError"`
	ReportURL         string     `json:"reportUrl"`
	AutoApproveStatus string     `json:"autoApproveStatus"`
	AutoApproveError  string     `json:"autoApproveError"`
	MergedHeadSHA     string     `json:"mergedHeadSha"`
	MRMergedAt        *time.Time `json:"mrMergedAt"`
	StartedAt         *time.Time `json:"startedAt"`
	FinishedAt        *time.Time `json:"finishedAt"`
	CreatedAt         time.Time  `json:"createdAt"`
}

// CodebaseRunReviewMeta holds structured fields extracted from review.json.
type CodebaseRunReviewMeta struct {
	HeadSHA     string
	ReviewJSON  json.RawMessage
	RiskLevel   string
	RiskFloor   string
	ReviewTrack string
	Disposition string
	MergePolicy string
}

const codebaseWorkflowColumns = `id,workspace_id,name,repo_path,repo_id,repo_name,agent_id,review_instruction,model,reasoning_effort,skill_ids,trigger_webhook,report_enabled,skip_draft,auto_label_enabled,auto_approve_enabled,require_ci_green,enabled,created_at,updated_at`

func scanCodebaseWorkflow(row pgx.Row) (CodebaseWorkflow, error) {
	var item CodebaseWorkflow
	err := row.Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.RepoPath, &item.RepoID, &item.RepoName, &item.AgentID, &item.ReviewInstruction, &item.Model, &item.ReasoningEffort, &item.SkillIDs, &item.TriggerWebhook, &item.ReportEnabled, &item.SkipDraft, &item.AutoLabelEnabled, &item.AutoApproveEnabled, &item.RequireCIGreen, &item.Enabled, &item.CreatedAt, &item.UpdatedAt)
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
	return scanCodebaseWorkflow(s.pool.QueryRow(ctx, `INSERT INTO codebase_workflows(id,workspace_id,name,repo_path,repo_id,repo_name,agent_id,review_instruction,model,reasoning_effort,skill_ids,trigger_webhook,report_enabled,skip_draft,auto_label_enabled,auto_approve_enabled,require_ci_green,enabled)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING `+codebaseWorkflowColumns, item.ID, item.WorkspaceID, item.Name, item.RepoPath, item.RepoID, item.RepoName, item.AgentID, item.ReviewInstruction, item.Model, item.ReasoningEffort, item.SkillIDs, item.TriggerWebhook, item.ReportEnabled, item.SkipDraft, item.AutoLabelEnabled, item.AutoApproveEnabled, item.RequireCIGreen, item.Enabled))
}

func (s *Store) UpdateCodebaseWorkflow(ctx context.Context, item CodebaseWorkflow) (CodebaseWorkflow, error) {
	if item.SkillIDs == nil {
		item.SkillIDs = []string{}
	}
	return scanCodebaseWorkflow(s.pool.QueryRow(ctx, `UPDATE codebase_workflows SET name=$3,repo_path=$4,repo_id=$5,repo_name=$6,agent_id=$7,review_instruction=$8,model=$9,reasoning_effort=$10,skill_ids=$11,trigger_webhook=$12,report_enabled=$13,skip_draft=$14,auto_label_enabled=$15,auto_approve_enabled=$16,require_ci_green=$17,enabled=$18,updated_at=now()
WHERE workspace_id=$1 AND id=$2 RETURNING `+codebaseWorkflowColumns, item.WorkspaceID, item.ID, item.Name, item.RepoPath, item.RepoID, item.RepoName, item.AgentID, item.ReviewInstruction, item.Model, item.ReasoningEffort, item.SkillIDs, item.TriggerWebhook, item.ReportEnabled, item.SkipDraft, item.AutoLabelEnabled, item.AutoApproveEnabled, item.RequireCIGreen, item.Enabled))
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

const codebaseRunColumns = `id,workspace_id,workflow_id,repo_path,repo_id,mr_iid,mr_title,mr_url,head_sha,round,trigger,status,summary,review_json,risk_level,risk_floor,review_track,disposition,merge_policy,error,task_id,conversation_id,model,reasoning_effort,report_status,report_error,report_url,auto_approve_status,auto_approve_error,merged_head_sha,mr_merged_at,started_at,finished_at,created_at`

func scanCodebaseRun(row pgx.Row) (CodebaseRun, error) {
	var item CodebaseRun
	var reviewJSON []byte
	err := row.Scan(&item.ID, &item.WorkspaceID, &item.WorkflowID, &item.RepoPath, &item.RepoID, &item.MRIID, &item.MRTitle, &item.MRURL, &item.HeadSHA, &item.Round, &item.Trigger, &item.Status, &item.Summary, &reviewJSON, &item.RiskLevel, &item.RiskFloor, &item.ReviewTrack, &item.Disposition, &item.MergePolicy, &item.Error, &item.TaskID, &item.ConversationID, &item.Model, &item.ReasoningEffort, &item.ReportStatus, &item.ReportError, &item.ReportURL, &item.AutoApproveStatus, &item.AutoApproveError, &item.MergedHeadSHA, &item.MRMergedAt, &item.StartedAt, &item.FinishedAt, &item.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrNotFound
	}
	if len(reviewJSON) > 0 {
		item.ReviewJSON = json.RawMessage(reviewJSON)
	}
	return item, err
}

func (s *Store) CreateCodebaseRun(ctx context.Context, item CodebaseRun) (CodebaseRun, error) {
	if item.Round < 1 {
		item.Round = 1
	}
	var reviewJSON any
	if len(item.ReviewJSON) > 0 {
		reviewJSON = []byte(item.ReviewJSON)
	}
	return scanCodebaseRun(s.pool.QueryRow(ctx, `INSERT INTO codebase_runs(id,workspace_id,workflow_id,repo_path,repo_id,mr_iid,mr_title,mr_url,head_sha,round,trigger,status,summary,review_json,risk_level,risk_floor,review_track,disposition,merge_policy,error,task_id,conversation_id,model,reasoning_effort,report_status,report_error,report_url,auto_approve_status,auto_approve_error,merged_head_sha,mr_merged_at,started_at,finished_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33) RETURNING `+codebaseRunColumns, item.ID, item.WorkspaceID, item.WorkflowID, item.RepoPath, item.RepoID, item.MRIID, item.MRTitle, item.MRURL, item.HeadSHA, item.Round, item.Trigger, item.Status, item.Summary, reviewJSON, item.RiskLevel, item.RiskFloor, item.ReviewTrack, item.Disposition, item.MergePolicy, item.Error, item.TaskID, item.ConversationID, item.Model, item.ReasoningEffort, item.ReportStatus, item.ReportError, item.ReportURL, item.AutoApproveStatus, item.AutoApproveError, item.MergedHeadSHA, item.MRMergedAt, item.StartedAt, item.FinishedAt))
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
WHERE workspace_id=$1 AND id=$2 AND status='succeeded' AND report_status IN ('','failed') AND NOT report_manual`, wid, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// Manual reports may publish skipped results without enabling workflow-wide
// writeback. They are excluded from automatic retry and skip transitions.
func (s *Store) ClaimManualCodebaseRunReport(ctx context.Context, wid, id string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE codebase_runs SET report_status='sending', report_error='', report_attempts=report_attempts+1, report_manual=true
WHERE workspace_id=$1 AND id=$2 AND status='succeeded' AND report_status IN ('','failed','skipped') AND btrim(summary)<>''`, wid, id)
	return tag.RowsAffected() > 0, err
}

// A stale automatic worker must not replace a manually claimed or sent result
// with "skipped", even when the workflow's automatic writeback is disabled.
func (s *Store) SkipAutomaticCodebaseRunReport(ctx context.Context, wid, id, reason string) (CodebaseRun, error) {
	run, err := scanCodebaseRun(s.pool.QueryRow(ctx, `UPDATE codebase_runs SET report_status='skipped', report_error=$3
WHERE workspace_id=$1 AND id=$2 AND NOT report_manual AND report_status IN ('','failed') RETURNING `+codebaseRunColumns, wid, id, reason))
	if err == ErrNotFound {
		return s.CodebaseRun(ctx, wid, id)
	}
	return run, err
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
WHERE status='succeeded' AND report_status IN ('','failed') AND NOT report_manual AND report_attempts < 5 ORDER BY finished_at DESC NULLS LAST LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCodebaseRuns(rows)
}

// ReserveWebhookCodebaseRun atomically deduplicates and inserts a webhook-triggered
// run inside a single PostgreSQL transaction protected by a per-(workspace,
// workflow, mr_iid) transaction advisory lock. This prevents concurrent webhook
// deliveries (across goroutines or server replicas) from starting duplicate
// reviews for the same MR revision.
//
// Returns:
//   - created=false when this exact headSHA is already pending/running/succeeded
//     (or when headSHA is empty and an active run already exists).
//   - superseded!=nil when an in-flight run for an older headSHA was marked
//     skipped so the caller can best-effort cancel its Relay task.
func (s *Store) ReserveWebhookCodebaseRun(ctx context.Context, item CodebaseRun) (run CodebaseRun, created bool, superseded *CodebaseRun, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return run, false, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	lockKey := item.WorkspaceID + ":" + item.WorkflowID + ":" + strconv.Itoa(item.MRIID)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		return run, false, nil, err
	}

	if item.HeadSHA != "" {
		var exists bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(
SELECT 1 FROM codebase_runs
WHERE workspace_id=$1 AND workflow_id=$2 AND mr_iid=$3 AND head_sha=$4 AND status IN ('pending','running','succeeded')
)`, item.WorkspaceID, item.WorkflowID, item.MRIID, item.HeadSHA).Scan(&exists)
		if err != nil {
			return run, false, nil, err
		}
		if exists {
			return run, false, nil, nil
		}
	}

	active, activeErr := scanCodebaseRun(tx.QueryRow(ctx, `SELECT `+codebaseRunColumns+` FROM codebase_runs
WHERE workspace_id=$1 AND workflow_id=$2 AND mr_iid=$3 AND status IN ('pending','running')
ORDER BY created_at DESC LIMIT 1`, item.WorkspaceID, item.WorkflowID, item.MRIID))
	if activeErr == nil {
		if item.HeadSHA == "" || active.HeadSHA == item.HeadSHA {
			return active, false, nil, nil
		}
		short := item.HeadSHA
		if len(short) > 12 {
			short = short[:12]
		}
		reason := "Superseded by newer MR revision " + short
		now := time.Now().UTC()
		if _, err = tx.Exec(ctx, `UPDATE codebase_runs SET status='skipped', error=$3, finished_at=COALESCE(finished_at,$4)
WHERE workspace_id=$1 AND id=$2`, item.WorkspaceID, active.ID, reason, now); err != nil {
			return run, false, nil, err
		}
		superseded = &active
	} else if !errors.Is(activeErr, ErrNotFound) {
		return run, false, nil, activeErr
	}

	if item.Round < 1 {
		item.Round = 1
	}
	if prev, prevErr := scanCodebaseRun(tx.QueryRow(ctx, `SELECT `+codebaseRunColumns+` FROM codebase_runs
WHERE workspace_id=$1 AND workflow_id=$2 AND mr_iid=$3 AND review_json IS NOT NULL
ORDER BY created_at DESC LIMIT 1`, item.WorkspaceID, item.WorkflowID, item.MRIID)); prevErr == nil && prev.Round >= item.Round {
		item.Round = prev.Round + 1
	}

	var reviewJSON any
	if len(item.ReviewJSON) > 0 {
		reviewJSON = []byte(item.ReviewJSON)
	}
	inserted, err := scanCodebaseRun(tx.QueryRow(ctx, `INSERT INTO codebase_runs(id,workspace_id,workflow_id,repo_path,repo_id,mr_iid,mr_title,mr_url,head_sha,round,trigger,status,summary,review_json,risk_level,risk_floor,review_track,disposition,merge_policy,error,task_id,conversation_id,model,reasoning_effort,report_status,report_error,report_url,auto_approve_status,auto_approve_error,merged_head_sha,mr_merged_at,started_at,finished_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33) RETURNING `+codebaseRunColumns,
		item.ID, item.WorkspaceID, item.WorkflowID, item.RepoPath, item.RepoID, item.MRIID, item.MRTitle, item.MRURL, item.HeadSHA, item.Round, item.Trigger, item.Status, item.Summary, reviewJSON, item.RiskLevel, item.RiskFloor, item.ReviewTrack, item.Disposition, item.MergePolicy, item.Error, item.TaskID, item.ConversationID, item.Model, item.ReasoningEffort, item.ReportStatus, item.ReportError, item.ReportURL, item.AutoApproveStatus, item.AutoApproveError, item.MergedHeadSHA, item.MRMergedAt, item.StartedAt, item.FinishedAt))
	if err != nil {
		return run, false, nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return run, false, nil, err
	}
	return inserted, true, superseded, nil
}

// HasCodebaseRunForSHA returns true when a workflow already has a pending,
// running, or succeeded run covering the exact headSHA of an MR.
func (s *Store) HasCodebaseRunForSHA(ctx context.Context, wid, workflowID string, mrIID int, headSHA string) (bool, error) {
	if headSHA == "" {
		return false, nil
	}
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(
SELECT 1 FROM codebase_runs
WHERE workspace_id=$1 AND workflow_id=$2 AND mr_iid=$3 AND head_sha=$4 AND status IN ('pending','running','succeeded')
)`, wid, workflowID, mrIID, headSHA).Scan(&exists)
	return exists, err
}

// LatestCodebaseRunWithReview returns the most recent completed run for an MR
// that persisted a structured review_json payload, enabling stateless
// incremental review rounds without relying on local disk.
func (s *Store) LatestCodebaseRunWithReview(ctx context.Context, wid, workflowID string, mrIID int) (CodebaseRun, error) {
	return scanCodebaseRun(s.pool.QueryRow(ctx, `SELECT `+codebaseRunColumns+` FROM codebase_runs
WHERE workspace_id=$1 AND workflow_id=$2 AND mr_iid=$3 AND review_json IS NOT NULL
ORDER BY created_at DESC LIMIT 1`, wid, workflowID, mrIID))
}

// UpdateCodebaseRunReviewResult stores structured review.json metadata on a run.
func (s *Store) UpdateCodebaseRunReviewResult(ctx context.Context, wid, id string, meta CodebaseRunReviewMeta) (CodebaseRun, error) {
	var reviewJSON any
	if len(meta.ReviewJSON) > 0 {
		reviewJSON = []byte(meta.ReviewJSON)
	}
	return scanCodebaseRun(s.pool.QueryRow(ctx, `UPDATE codebase_runs
SET head_sha=COALESCE(NULLIF($3,''),head_sha),
    review_json=COALESCE($4::jsonb,review_json),
    risk_level=COALESCE(NULLIF($5,''),risk_level),
    risk_floor=COALESCE(NULLIF($6,''),risk_floor),
    review_track=COALESCE(NULLIF($7,''),review_track),
    disposition=COALESCE(NULLIF($8,''),disposition),
    merge_policy=COALESCE(NULLIF($9,''),merge_policy)
WHERE workspace_id=$1 AND id=$2 RETURNING `+codebaseRunColumns,
		wid, id, meta.HeadSHA, reviewJSON, meta.RiskLevel, meta.RiskFloor, meta.ReviewTrack, meta.Disposition, meta.MergePolicy))
}

// RecordCodebaseMRMerged records the merged head SHA and timestamp on runs of
// that MR for shadow-mode calibration (comparing AI merge_policy against human
// merge outcomes).
func (s *Store) RecordCodebaseMRMerged(ctx context.Context, wid, repoID string, mrIID int, mergedHeadSHA string, mergedAt time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE codebase_runs
SET merged_head_sha=COALESCE(NULLIF($4,''),merged_head_sha),
    mr_merged_at=COALESCE(mr_merged_at,$5)
WHERE workspace_id=$1 AND repo_id=$2 AND mr_iid=$3 AND status='succeeded'`,
		wid, repoID, mrIID, mergedHeadSHA, mergedAt)
	return err
}

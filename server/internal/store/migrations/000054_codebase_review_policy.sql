-- Batch 1: head_sha tracking, structured review.json storage, incremental rounds,
-- workflow governance toggles, and shadow merge-outcome tracking.

ALTER TABLE codebase_merge_requests
  ADD COLUMN IF NOT EXISTS head_sha text NOT NULL DEFAULT '';

ALTER TABLE codebase_workflows
  ADD COLUMN IF NOT EXISTS skip_draft boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_label_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_approve_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_ci_green boolean NOT NULL DEFAULT true;

ALTER TABLE codebase_runs
  ADD COLUMN IF NOT EXISTS head_sha text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS round integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS review_json jsonb,
  ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS risk_floor text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS review_track text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS disposition text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS merge_policy text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS auto_approve_status text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS auto_approve_error text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS merged_head_sha text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mr_merged_at timestamptz;

CREATE INDEX IF NOT EXISTS codebase_runs_workflow_mr_sha_idx
  ON codebase_runs(workspace_id, workflow_id, mr_iid, head_sha);

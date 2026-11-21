-- Review workflows now pin the execution model, reasoning effort, and the
-- Skills that shape the review. Runs keep a copy of the model/effort that was
-- used and the status of reporting the result back to the Codebase merge
-- request, so a failed writeback can be retried without rerunning the Agent.
ALTER TABLE codebase_workflows
  ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reasoning_effort text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS skill_ids text[] NOT NULL DEFAULT '{}';

ALTER TABLE codebase_runs
  ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reasoning_effort text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS report_status text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS report_error text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS report_url text NOT NULL DEFAULT '';

-- Webhook events are processed asynchronously after they are accepted, so the
-- stored payload must be readable and failures visible without parsing logs.
-- attempts bounds retries so a permanently failing event cannot spin forever.
ALTER TABLE codebase_webhook_events
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS codebase_webhook_events_pending
  ON codebase_webhook_events(workspace_id, id)
  WHERE processed_at IS NULL;

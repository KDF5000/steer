CREATE TABLE IF NOT EXISTS work_log_entries (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  content text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source_kind text NOT NULL DEFAULT 'manual',
  source_session_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_log_entries_workspace_time_idx
  ON work_log_entries (workspace_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS work_log_summaries (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  period_kind text NOT NULL,
  period_start date NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, period_kind, period_start)
);
CREATE INDEX IF NOT EXISTS work_log_summaries_workspace_period_idx
  ON work_log_summaries (workspace_id, period_start DESC);

-- Preserve existing user content when upgrading from the original Notes UI.
INSERT INTO work_log_entries (id, workspace_id, content, occurred_at, source_kind, created_at, updated_at)
SELECT id, workspace_id, trim(concat_ws(E'\n', nullif(title, ''), nullif(content, ''))), created_at, 'legacy_note', created_at, updated_at
FROM notes
WHERE trim(concat_ws(E'\n', nullif(title, ''), nullif(content, ''))) <> ''
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS footprint_reports (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  from_at timestamptz NOT NULL,
  to_at timestamptz NOT NULL,
  project_id text,
  source_session_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS footprint_reports_workspace_created_idx
  ON footprint_reports (workspace_id, created_at DESC);

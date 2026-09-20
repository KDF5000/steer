ALTER TABLE run_links
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

CREATE INDEX IF NOT EXISTS run_links_workspace_purpose_created_idx
  ON run_links (workspace_id, purpose, created_at DESC);

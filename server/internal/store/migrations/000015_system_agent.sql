CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id text PRIMARY KEY,
  system_agent_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_settings_system_agent_idx
  ON workspace_settings (workspace_id, system_agent_id)
  WHERE system_agent_id IS NOT NULL;

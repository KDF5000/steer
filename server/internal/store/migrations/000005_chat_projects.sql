CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  name text NOT NULL,
  workspace_kind text NOT NULL,
  workspace_source text NOT NULL,
  workspace_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_workspace_name_idx ON projects (workspace_id, lower(name));

ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS project_id text;
CREATE INDEX IF NOT EXISTS chat_sessions_project_idx ON chat_sessions (workspace_id, project_id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'in_place';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS runtime_id text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_subdir text;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS execution_runtime_id text;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS workspace_key text;

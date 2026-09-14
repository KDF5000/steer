ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS workspace_kind text;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS workspace_source text;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS workspace_ref text;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS workspace_subdir text;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS execution_mode text;

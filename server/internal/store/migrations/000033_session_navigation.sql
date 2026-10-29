ALTER TABLE chat_sessions ADD COLUMN pinned boolean NOT NULL DEFAULT false;
ALTER TABLE chat_sessions ADD COLUMN archived boolean NOT NULL DEFAULT false;
CREATE INDEX chat_sessions_navigation ON chat_sessions(workspace_id, pinned DESC, created_at DESC, id);
CREATE INDEX messages_search_session ON messages(workspace_id, session_id, created_at DESC);

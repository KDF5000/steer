ALTER TABLE chat_sessions ADD COLUMN parent_conversation_id text REFERENCES chat_sessions(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN parent_conversation_id text REFERENCES chat_sessions(id) ON DELETE SET NULL;
CREATE INDEX tasks_pending_delegations ON tasks(workspace_id,parent_conversation_id) WHERE parent_conversation_id IS NOT NULL;

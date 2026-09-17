CREATE TABLE IF NOT EXISTS shared_conversations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  session_id text NOT NULL,
  message_id text,
  token_hash text NOT NULL,
  snapshot jsonb NOT NULL,
  created_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shared_conversations_token_idx ON shared_conversations (token_hash);
CREATE INDEX IF NOT EXISTS shared_conversations_session_idx ON shared_conversations (workspace_id, session_id, created_at DESC);

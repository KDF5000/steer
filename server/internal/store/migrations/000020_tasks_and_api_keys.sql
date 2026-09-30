CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  conversation_id text NOT NULL,
  relay_run_id text NOT NULL,
  agent_id text NOT NULL,
  user_message_id text NOT NULL,
  assistant_message_id text NOT NULL,
  source text NOT NULL,
  idempotency_key text,
  status text NOT NULL,
  result text,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS tasks_workspace_idempotency_idx
  ON tasks (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_workspace_run_idx
  ON tasks (workspace_id, relay_run_id);
CREATE INDEX IF NOT EXISTS tasks_conversation_created_idx
  ON tasks (workspace_id, conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_api_keys (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  name text NOT NULL,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  scopes text[] NOT NULL,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_api_keys_token_idx
  ON workspace_api_keys (token_hash);
CREATE INDEX IF NOT EXISTS workspace_api_keys_workspace_idx
  ON workspace_api_keys (workspace_id, created_at DESC);

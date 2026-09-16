CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (lower(email));

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS owner_user_id text;
CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON workspaces (owner_user_id, created_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_idx ON auth_sessions (token_hash);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id, expires_at);

CREATE TABLE IF NOT EXISTS workspace_runtimes (
  runtime_id text PRIMARY KEY,
  workspace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_runtimes_workspace_idx ON workspace_runtimes (workspace_id, created_at);

CREATE TABLE workspace_codebase_connections (
  workspace_id text PRIMARY KEY,
  base_url text NOT NULL,
  api_prefix text NOT NULL DEFAULT '/api/v4',
  auth_type text NOT NULL CHECK (auth_type IN ('private_token', 'bearer')),
  encrypted_token bytea NOT NULL,
  remote_username text NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

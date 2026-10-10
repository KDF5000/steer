DROP TABLE IF EXISTS workspace_runtimes;

UPDATE agents SET runtime_id = NULL;
UPDATE projects SET runtime_id = NULL;
UPDATE chat_sessions SET execution_runtime_id = NULL;

CREATE TABLE relay_node_enrollments (
  id text PRIMARY KEY,
  owner_user_id text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX relay_node_enrollments_token_idx
  ON relay_node_enrollments (token_hash);
CREATE INDEX relay_node_enrollments_owner_idx
  ON relay_node_enrollments (owner_user_id, created_at DESC);

CREATE TABLE relay_nodes (
  id text PRIMARY KEY,
  owner_user_id text NOT NULL,
  name text NOT NULL,
  capacity integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'offline',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX relay_nodes_owner_idx
  ON relay_nodes (owner_user_id, updated_at DESC);

CREATE TABLE relay_node_runtimes (
  id text PRIMARY KEY,
  node_id text NOT NULL,
  provider text NOT NULL,
  version text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX relay_node_runtimes_node_idx
  ON relay_node_runtimes (node_id, provider);

CREATE TABLE workspace_runtime_bindings (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  node_runtime_id text NOT NULL,
  authorized_by_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workspace_runtime_bindings_workspace_runtime_idx
  ON workspace_runtime_bindings (workspace_id, node_runtime_id);
CREATE INDEX workspace_runtime_bindings_workspace_idx
  ON workspace_runtime_bindings (workspace_id, created_at);

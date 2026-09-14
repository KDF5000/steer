CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  runtime_provider text NOT NULL,
  runtime_id text,
  model text,
  workspace_kind text,
  workspace_source text,
  workspace_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_workspace_name_idx ON agents (workspace_id, lower(name));

CREATE TABLE IF NOT EXISTS chat_sessions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  title text NOT NULL,
  agent_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_sessions_workspace_updated_idx ON chat_sessions (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  session_id text NOT NULL,
  role text NOT NULL,
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'complete',
  relay_run_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_session_created_idx ON messages (workspace_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS messages_relay_run_idx ON messages (workspace_id, relay_run_id);

CREATE TABLE IF NOT EXISTS run_links (
  relay_run_id text PRIMARY KEY,
  workspace_id text NOT NULL,
  purpose text NOT NULL,
  session_id text,
  agent_id text NOT NULL,
  status text NOT NULL,
  summary text,
  error text,
  last_event_sequence integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_links_session_idx ON run_links (workspace_id, session_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  relay_artifact_id text,
  relay_run_id text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  ref text NOT NULL DEFAULT '',
  content_type text,
  size bigint,
  state text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS artifacts_workspace_relay_idx ON artifacts (workspace_id, relay_artifact_id) WHERE relay_artifact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_integrations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  provider text NOT NULL,
  name text NOT NULL,
  external_app_id text NOT NULL,
  encrypted_credentials bytea NOT NULL,
  agent_id text NOT NULL,
  project_id text,
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'connecting',
  last_error text,
  last_connected_at timestamptz,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_integrations_provider_check CHECK (provider IN ('feishu')),
  CONSTRAINT workspace_integrations_status_check CHECK (status IN ('connecting','connected','error','disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_integrations_provider_app_idx
  ON workspace_integrations (provider, external_app_id);
CREATE INDEX IF NOT EXISTS workspace_integrations_workspace_idx
  ON workspace_integrations (workspace_id, created_at);

CREATE TABLE IF NOT EXISTS integration_conversations (
  integration_id text NOT NULL,
  chat_id text NOT NULL,
  thread_key text NOT NULL,
  conversation_id text NOT NULL,
  active_task_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, chat_id, thread_key)
);

CREATE TABLE IF NOT EXISTS integration_events (
  id text PRIMARY KEY,
  integration_id text NOT NULL,
  external_event_id text NOT NULL,
  external_message_id text NOT NULL,
  chat_id text NOT NULL,
  thread_key text NOT NULL,
  sender_id text NOT NULL,
  prompt text NOT NULL,
  task_id text,
  status text NOT NULL DEFAULT 'queued',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS integration_events_pending_idx
  ON integration_events (integration_id, status, created_at);

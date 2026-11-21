CREATE TABLE workspace_codebase_webhooks (
  workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  token_hash text NOT NULL,
  encrypted_token bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE codebase_webhook_events (
  id bigserial PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace_codebase_webhooks(workspace_id) ON DELETE CASCADE,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text NOT NULL DEFAULT '',
  UNIQUE(workspace_id, payload_hash)
);
CREATE INDEX codebase_webhook_events_workspace_cursor ON codebase_webhook_events(workspace_id, id);

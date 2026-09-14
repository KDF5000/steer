CREATE TABLE IF NOT EXISTS message_attachments (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  session_id text NOT NULL,
  message_id text NOT NULL,
  name text NOT NULL,
  content_type text NOT NULL,
  size bigint NOT NULL,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_attachments_message_idx ON message_attachments (workspace_id, message_id);

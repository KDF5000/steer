ALTER TABLE integration_conversations
  ADD COLUMN model_override text,
  ADD COLUMN reasoning_effort text;

CREATE TABLE integration_cards (
  id uuid PRIMARY KEY,
  integration_id text NOT NULL REFERENCES workspace_integrations(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  thread_key text NOT NULL,
  message_id text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('task', 'model', 'project')),
  context jsonb NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  consumed_at timestamptz
);
CREATE INDEX integration_cards_expiry_idx ON integration_cards(expires_at);

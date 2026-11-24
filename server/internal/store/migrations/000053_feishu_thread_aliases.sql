-- Keep native Feishu thread IDs and root message IDs on one conversation key.
-- Alias rows hold no session state; /new, project and model changes only update
-- the canonical integration_conversations row.
CREATE TABLE integration_thread_aliases (
  integration_id text NOT NULL REFERENCES workspace_integrations(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  alias_key text NOT NULL,
  thread_key text NOT NULL,
  PRIMARY KEY (integration_id, chat_id, alias_key)
);

DROP INDEX IF EXISTS workspace_integrations_provider_app_idx;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_integrations_provider_app_lower_idx
  ON workspace_integrations (provider, lower(external_app_id));

ALTER TABLE integration_conversations
  ADD COLUMN IF NOT EXISTS project_id text;

UPDATE integration_conversations AS conversation
SET project_id = integration.project_id
FROM workspace_integrations AS integration
WHERE conversation.integration_id = integration.id
  AND conversation.project_id IS NULL
  AND integration.project_id IS NOT NULL;

UPDATE workspace_integrations
SET project_id = NULL
WHERE provider = 'feishu'
  AND project_id IS NOT NULL;

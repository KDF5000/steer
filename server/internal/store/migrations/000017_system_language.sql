ALTER TABLE workspace_settings
  RENAME COLUMN ai_output_language TO language;

ALTER TABLE workspace_settings
  DROP CONSTRAINT IF EXISTS workspace_settings_ai_output_language_check;

ALTER TABLE workspace_settings
  ADD CONSTRAINT workspace_settings_language_check
  CHECK (language IN ('auto', 'zh-CN', 'en'));

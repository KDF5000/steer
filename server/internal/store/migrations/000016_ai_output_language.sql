ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS ai_output_language text NOT NULL DEFAULT 'auto';

ALTER TABLE workspace_settings
  DROP CONSTRAINT IF EXISTS workspace_settings_ai_output_language_check;

ALTER TABLE workspace_settings
  ADD CONSTRAINT workspace_settings_ai_output_language_check
  CHECK (ai_output_language IN ('auto', 'zh-CN', 'en'));

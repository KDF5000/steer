ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS interface_language text NOT NULL DEFAULT 'auto';

ALTER TABLE workspace_settings
  DROP CONSTRAINT IF EXISTS workspace_settings_interface_language_check;

ALTER TABLE workspace_settings
  ADD CONSTRAINT workspace_settings_interface_language_check
  CHECK (interface_language IN ('auto', 'zh-CN', 'en'));

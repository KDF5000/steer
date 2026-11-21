-- Preserve writeback for existing workflows; users can disable it per workflow.
ALTER TABLE codebase_workflows
  ADD COLUMN report_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE resource_shares DROP CONSTRAINT resource_shares_kind_check;
ALTER TABLE resource_shares ADD CONSTRAINT resource_shares_kind_check CHECK (kind IN ('session', 'agent', 'workflow'));
ALTER TABLE resource_shares ADD CONSTRAINT resource_shares_workflow_view_check CHECK (kind <> 'workflow' OR (permission = 'view' AND project_id IS NULL));
CREATE INDEX codebase_runs_shared_conversation ON codebase_runs(workspace_id, workflow_id, conversation_id) WHERE conversation_id <> '';

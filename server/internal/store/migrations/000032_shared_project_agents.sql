ALTER TABLE projects ADD COLUMN shared_source_project_id text;
ALTER TABLE projects ADD COLUMN shared_source_workspace_id text;

UPDATE projects p SET shared_source_project_id=g.project_id,
 shared_source_workspace_id=g.workspace_id
FROM resource_shares g WHERE p.shared_agent_grant_id=g.id AND g.kind='agent';

-- Keep conversation IDs and worktree keys. Only regroup their project entries.
CREATE TEMP TABLE shared_project_merge ON COMMIT DROP AS
SELECT id, first_value(id) OVER (
 PARTITION BY workspace_id,shared_source_project_id
 ORDER BY (deleted_at IS NOT NULL),created_at,id
) AS retained_id FROM projects WHERE shared_source_project_id IS NOT NULL;
UPDATE chat_sessions c SET project_id=m.retained_id FROM shared_project_merge m WHERE c.project_id=m.id AND m.id<>m.retained_id;
UPDATE run_usage u SET project_id=m.retained_id FROM shared_project_merge m WHERE u.project_id=m.id AND m.id<>m.retained_id;
UPDATE footprint_reports f SET project_id=m.retained_id FROM shared_project_merge m WHERE f.project_id=m.id AND m.id<>m.retained_id;
UPDATE workspace_integrations i SET project_id=m.retained_id FROM shared_project_merge m WHERE i.project_id=m.id AND m.id<>m.retained_id;
UPDATE integration_conversations c SET project_id=m.retained_id FROM shared_project_merge m WHERE c.project_id=m.id AND m.id<>m.retained_id;
UPDATE resource_shares g SET project_id=m.retained_id FROM shared_project_merge m WHERE g.project_id=m.id AND m.id<>m.retained_id;
DELETE FROM projects p USING shared_project_merge m WHERE p.id=m.id AND m.id<>m.retained_id;

DROP INDEX projects_workspace_name_idx;
DROP INDEX projects_shared_grant;
CREATE UNIQUE INDEX projects_workspace_name_idx ON projects(workspace_id,lower(name)) WHERE shared_source_project_id IS NULL;
CREATE UNIQUE INDEX projects_shared_source_idx ON projects(workspace_id,shared_source_project_id) WHERE shared_source_project_id IS NOT NULL;
UPDATE projects p SET name=source.name FROM projects source WHERE source.id=p.shared_source_project_id;

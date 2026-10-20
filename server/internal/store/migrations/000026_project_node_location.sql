ALTER TABLE projects ADD COLUMN node_id text;

UPDATE projects p SET node_id = r.node_id
FROM workspace_runtime_bindings b
JOIN relay_node_runtimes r ON r.id = b.node_runtime_id
WHERE p.workspace_id = b.workspace_id AND p.runtime_id = b.id;

-- Auth-disabled deployments store physical Runtime IDs directly.
UPDATE projects SET node_id = regexp_replace(runtime_id, '/[^/]+$', '')
WHERE node_id IS NULL AND runtime_id LIKE '%/%';

UPDATE projects SET runtime_id = NULL WHERE node_id IS NOT NULL;

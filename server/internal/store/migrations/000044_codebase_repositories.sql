-- Repositories are managed explicitly instead of being derived from workflows.
-- A repository can exist without a review workflow; workflows choose from the
-- managed repositories. Existing workflows are backfilled so upgrades keep the
-- merge request page populated.
CREATE TABLE codebase_repositories (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo_id text NOT NULL,
  repo_path text NOT NULL,
  repo_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, repo_id)
);
CREATE INDEX codebase_repositories_path ON codebase_repositories(workspace_id, repo_path);

INSERT INTO codebase_repositories(workspace_id, repo_id, repo_path, repo_name)
SELECT workspace_id, repo_id, repo_path, MAX(repo_name)
FROM codebase_workflows
WHERE repo_id <> ''
GROUP BY workspace_id, repo_id, repo_path
ON CONFLICT DO NOTHING;

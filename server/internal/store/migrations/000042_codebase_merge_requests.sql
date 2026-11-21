-- Merge requests are stored per repository, not per workflow. A workflow is a
-- review configuration that points at a repository; several workflows may share
-- the same repository and therefore the same synced merge requests.
--
-- Sync is incremental: codebase_repo_syncs keeps the newest MR update timestamp
-- seen so the next sync only walks pages until it reaches data already stored.
CREATE TABLE codebase_merge_requests (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo_id text NOT NULL,
  repo_path text NOT NULL,
  mr_number integer NOT NULL,
  mr_id bigint NOT NULL DEFAULT 0,
  title text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'open',
  web_url text NOT NULL DEFAULT '',
  source_branch text NOT NULL DEFAULT '',
  target_branch text NOT NULL DEFAULT '',
  author_name text NOT NULL DEFAULT '',
  author_username text NOT NULL DEFAULT '',
  draft boolean NOT NULL DEFAULT false,
  labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  mr_created_at timestamptz,
  mr_updated_at timestamptz,
  first_synced_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, repo_id, mr_number)
);
CREATE INDEX codebase_merge_requests_repo_updated ON codebase_merge_requests(workspace_id, repo_id, mr_updated_at DESC);
CREATE INDEX codebase_merge_requests_repo_state ON codebase_merge_requests(workspace_id, repo_id, state);

CREATE TABLE codebase_repo_syncs (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo_id text NOT NULL,
  repo_path text NOT NULL,
  repo_name text NOT NULL DEFAULT '',
  last_synced_at timestamptz,
  last_mr_updated_at timestamptz,
  last_created integer NOT NULL DEFAULT 0,
  last_updated integer NOT NULL DEFAULT 0,
  last_error text NOT NULL DEFAULT '',
  PRIMARY KEY (workspace_id, repo_id)
);

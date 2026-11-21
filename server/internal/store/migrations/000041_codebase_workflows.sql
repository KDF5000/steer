-- Codebase review workflows bind a verified repository, a reviewer agent, and
-- review configuration to a workspace. Runs record each review execution and
-- link back to the workflow (and to the Steer conversation/task that ran it).
CREATE TABLE codebase_workflows (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  repo_path text NOT NULL,
  repo_id text NOT NULL,
  repo_name text NOT NULL DEFAULT '',
  agent_id text NOT NULL DEFAULT '',
  review_instruction text NOT NULL DEFAULT '',
  trigger_webhook boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX codebase_workflows_workspace ON codebase_workflows(workspace_id, created_at);

CREATE TABLE codebase_runs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id text NOT NULL REFERENCES codebase_workflows(id) ON DELETE CASCADE,
  repo_path text NOT NULL,
  repo_id text NOT NULL DEFAULT '',
  mr_iid integer NOT NULL,
  mr_title text NOT NULL DEFAULT '',
  mr_url text NOT NULL DEFAULT '',
  trigger text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'webhook')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  summary text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  task_id text NOT NULL DEFAULT '',
  conversation_id text NOT NULL DEFAULT '',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX codebase_runs_workspace ON codebase_runs(workspace_id, created_at DESC);
CREATE INDEX codebase_runs_workflow ON codebase_runs(workflow_id, created_at DESC);

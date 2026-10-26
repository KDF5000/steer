-- One immutable execution identity per Relay Run. A delegation has one child
-- execution even though its response is displayed in both conversations.
CREATE TABLE IF NOT EXISTS run_usage (
  relay_run_id text PRIMARY KEY REFERENCES run_links(relay_run_id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  session_id text,
  project_id text,
  agent_id text NOT NULL,
  runtime_id text,
  provider text NOT NULL DEFAULT '',
  model text,
  purpose text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  last_sequence integer NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 1,
  checked_at timestamptz,
  synced boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS run_usage_workspace_completed_idx ON run_usage(workspace_id,completed_at,project_id);
CREATE TABLE IF NOT EXISTS run_usage_attempts (
  relay_run_id text NOT NULL REFERENCES run_usage(relay_run_id) ON DELETE CASCADE,
  attempt_id text NOT NULL,
  sequence integer NOT NULL,
  input_tokens bigint CHECK(input_tokens >= 0),
  output_tokens bigint CHECK(output_tokens >= 0),
  total_tokens bigint CHECK(total_tokens >= 0),
  cache_read_tokens bigint CHECK(cache_read_tokens >= 0),
  cache_write_tokens bigint CHECK(cache_write_tokens >= 0),
  reasoning_tokens bigint CHECK(reasoning_tokens >= 0),
  status text NOT NULL CHECK(status IN ('partial','complete')),
  source text NOT NULL,
  raw jsonb NOT NULL,
  PRIMARY KEY(relay_run_id,attempt_id)
);
-- Existing runs are eligible for a bounded background pass. Runtime identity
-- for historical rows is best effort; new runs capture it when submitted.
INSERT INTO run_usage(relay_run_id,workspace_id,session_id,project_id,agent_id,runtime_id,provider,model,purpose,status,created_at,completed_at)
 SELECT r.relay_run_id,r.workspace_id,r.session_id,s.project_id,r.agent_id,a.runtime_id,COALESCE(a.runtime_provider,''),a.model,r.purpose,r.status,r.created_at,
 CASE WHEN r.status IN ('succeeded','failed','cancelled') THEN COALESCE(t.completed_at,r.updated_at) END
 FROM run_links r LEFT JOIN chat_sessions s ON s.id=r.session_id AND s.workspace_id=r.workspace_id
 LEFT JOIN agents a ON a.id=r.agent_id AND a.workspace_id=r.workspace_id
 LEFT JOIN tasks t ON t.relay_run_id=r.relay_run_id AND t.workspace_id=r.workspace_id
 ON CONFLICT(relay_run_id) DO NOTHING;

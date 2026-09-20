CREATE TABLE IF NOT EXISTS skills (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  content text NOT NULL,
  source_kind text NOT NULL DEFAULT 'manual',
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS skills_workspace_name_idx ON skills (workspace_id, lower(name));

CREATE TABLE IF NOT EXISTS agent_skills (
  workspace_id text NOT NULL,
  agent_id text NOT NULL,
  skill_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, agent_id, skill_id)
);
CREATE INDEX IF NOT EXISTS agent_skills_agent_idx ON agent_skills (workspace_id, agent_id, created_at);

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_workspace_updated_idx ON documents (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS notes (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  pinned boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  reminder_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_workspace_updated_idx ON notes (workspace_id, archived, pinned DESC, updated_at DESC);

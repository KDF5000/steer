CREATE TABLE resource_shares (
 id text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('session','agent')),
 resource_id text NOT NULL,
 workspace_id text NOT NULL REFERENCES workspaces(id),
 owner_user_id text NOT NULL REFERENCES users(id),
 recipient_email text NOT NULL,
 recipient_user_id text REFERENCES users(id),
 permission text NOT NULL CHECK(permission IN ('view','execute')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')),
 project_id text,
 max_concurrency integer NOT NULL DEFAULT 1 CHECK(max_concurrency BETWEEN 1 AND 10),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,resource_id,recipient_email)
);
CREATE INDEX resource_shares_recipient ON resource_shares(lower(recipient_email),status);
CREATE INDEX resource_shares_owner ON resource_shares(workspace_id,kind,status);
ALTER TABLE chat_sessions ADD COLUMN shared_agent_grant_id text REFERENCES resource_shares(id);
CREATE INDEX chat_sessions_shared_grant ON chat_sessions(shared_agent_grant_id) WHERE shared_agent_grant_id IS NOT NULL;

ALTER TABLE projects ADD COLUMN shared_agent_grant_id text REFERENCES resource_shares(id);
CREATE UNIQUE INDEX projects_shared_grant ON projects(workspace_id,shared_agent_grant_id) WHERE shared_agent_grant_id IS NOT NULL;

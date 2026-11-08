CREATE TABLE IF NOT EXISTS watch_push_devices (
 id text PRIMARY KEY,
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 api_key_id text REFERENCES workspace_api_keys(id) ON DELETE CASCADE,
 binding_hash text NOT NULL,
 account_fingerprint text NOT NULL,
 token text NOT NULL,
 topic text NOT NULL,
 environment text NOT NULL CHECK(environment IN ('sandbox','production')),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS watch_push_devices_workspace ON watch_push_devices(workspace_id) WHERE enabled;
CREATE TABLE IF NOT EXISTS watch_push_deliveries (
 id text PRIMARY KEY,
 device_id text NOT NULL REFERENCES watch_push_devices(id) ON DELETE CASCADE,
 task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 status text NOT NULL,
 state text NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(device_id,task_id)
);
CREATE INDEX IF NOT EXISTS watch_push_deliveries_pending ON watch_push_deliveries(available_at) WHERE sent_at IS NULL;

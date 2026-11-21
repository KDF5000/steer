ALTER TABLE workspace_codebase_connections
  ADD COLUMN app_id text,
  ADD COLUMN encrypted_app_secret bytea;

UPDATE workspace_codebase_connections
  SET app_id = '', encrypted_app_secret = encrypted_token
  WHERE encrypted_token IS NOT NULL;

ALTER TABLE workspace_codebase_connections
  ALTER COLUMN app_id SET NOT NULL,
  ALTER COLUMN encrypted_app_secret SET NOT NULL,
  DROP COLUMN api_prefix,
  DROP COLUMN auth_type,
  DROP COLUMN encrypted_token;

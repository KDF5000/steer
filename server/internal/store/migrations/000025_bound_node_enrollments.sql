-- Expire legacy enrollment codes that were not bound to a generated Node ID.
ALTER TABLE relay_node_enrollments ADD COLUMN node_id TEXT;
UPDATE relay_node_enrollments SET consumed_at=now() WHERE consumed_at IS NULL;

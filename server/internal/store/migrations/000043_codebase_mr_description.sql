-- Merge request descriptions are shown in the review detail dialog. They are
-- stored with the synced copy so the dialog never calls Codebase directly.
ALTER TABLE codebase_merge_requests ADD COLUMN description text NOT NULL DEFAULT '';

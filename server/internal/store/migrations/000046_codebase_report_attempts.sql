-- Bound automatic retries of the review writeback so a permanently failing
-- comment (missing App credentials, revoked permission) does not retry on every
-- worker tick. A manual sync can still retry after the budget is exhausted.
ALTER TABLE codebase_runs
  ADD COLUMN IF NOT EXISTS report_attempts integer NOT NULL DEFAULT 0;

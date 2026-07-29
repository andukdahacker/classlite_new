-- Reverse 20260728120000_create_jobs. DROP TABLE cascades its policies +
-- indexes; the enum type is dropped after the table that uses it. ai_credit_ledger
-- (20260728130000) rolls back FIRST (reverse order); note its ref_job_id is a
-- plain-uuid SOFT pointer, NOT a FK, so it never constrained this drop either way.
-- No prior migration is edited (WF-2).
DROP TABLE IF EXISTS jobs;
DROP TYPE IF EXISTS job_status;

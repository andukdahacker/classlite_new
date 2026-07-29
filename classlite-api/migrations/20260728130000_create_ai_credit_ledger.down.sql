-- Reverse 20260728130000_create_ai_credit_ledger. DROP TABLE cascades its
-- policies + indexes. The REVOKE is dropped with the table. Rolls back BEFORE
-- 20260728120000_create_jobs (reverse order); ref_job_id is a plain-uuid SOFT
-- pointer (NOT a FK), so drop ordering is not actually constrained by it. No
-- prior migration is edited (WF-2).
DROP TABLE IF EXISTS ai_credit_ledger;

-- Story 4.3a — append-only AI credit ledger. 4.3a writes only the -1
-- job_deduction (enqueue, AC1) and the +1 job_failed_refund (terminal fail /
-- stuck sweep, AC7). balance_after is the running per-(center,user) sum. Because
-- the ledger is append-only (UPDATE/DELETE REVOKEd in the migration — a wrong
-- balance_after is permanent), each write takes a per-(center,user)
-- pg_advisory_xact_lock BEFORE reading SUM(change), so two concurrent inserts for
-- the same payer can never compute the same stale running sum. The lock lives in
-- a MATERIALIZED CTE so PG cannot inline/reorder it past the SUM read; it is
-- released automatically at tx end. RLS scopes every statement on center_id; the
-- append-only guarantee is enforced by the REVOKE, so there is no update/delete
-- query here by design.

-- name: InsertJobDeduction :exec
-- The -1 deduction, inserted in the SAME tx as the job row (R23/A6). Idempotent
-- against a double-insert via the unique (ref_job_id, reason) index. The lock CTE
-- serializes concurrent deductions/refunds for the same (center,user) so
-- balance_after stays a correct monotone running sum.
WITH k AS MATERIALIZED (
    -- Type the params as uuid in ONE place so sqlc infers uuid (not text); the
    -- lock key casts the column, not the param.
    SELECT @center_id::uuid AS center_id, @user_id::uuid AS user_id
),
_lock AS MATERIALIZED (
    SELECT pg_advisory_xact_lock(hashtextextended(center_id::text || '/' || user_id::text, 0))
    FROM k
)
INSERT INTO ai_credit_ledger (id, center_id, user_id, change, reason, ref_job_id, balance_after)
SELECT
    gen_random_uuid(), k.center_id, k.user_id, -1, 'job_deduction', @ref_job_id,
    COALESCE((SELECT SUM(change) FROM ai_credit_ledger
              WHERE center_id = k.center_id AND user_id = k.user_id), 0) - 1
FROM k, _lock
ON CONFLICT (ref_job_id, reason) DO NOTHING;

-- name: RefundJob :exec
-- The +1 refund for a terminally-failed job. center_id/user_id are DERIVED from
-- the job's own deduction row (the worker holds only the job-row center_id, not
-- the enqueuing user), so the credit returns to whoever paid. The unique
-- (ref_job_id, reason) index + ON CONFLICT DO NOTHING makes a worker/sweep race
-- collapse to exactly one refund (AC7 idempotency). A job with no deduction row
-- (or already refunded) is a silent no-op. The lock is keyed off the deduction
-- row's (center,user) — same key as InsertJobDeduction — and is acquired in a
-- MATERIALIZED CTE before the SUM read; if there is no deduction row the CTE is
-- empty, no lock is taken, and the INSERT selects nothing (the intended no-op).
WITH deduction AS MATERIALIZED (
    SELECT d.center_id, d.user_id, d.ref_job_id
    FROM ai_credit_ledger d
    WHERE d.ref_job_id = @ref_job_id AND d.reason = 'job_deduction'
),
_lock AS MATERIALIZED (
    SELECT center_id, user_id, ref_job_id,
           pg_advisory_xact_lock(hashtextextended(center_id::text || '/' || user_id::text, 0))
    FROM deduction
)
INSERT INTO ai_credit_ledger (id, center_id, user_id, change, reason, ref_job_id, balance_after)
SELECT
    gen_random_uuid(), l.center_id, l.user_id, 1, 'job_failed_refund', l.ref_job_id,
    COALESCE((SELECT SUM(change) FROM ai_credit_ledger x
              WHERE x.center_id = l.center_id AND x.user_id = l.user_id), 0) + 1
FROM _lock l
ON CONFLICT (ref_job_id, reason) DO NOTHING;

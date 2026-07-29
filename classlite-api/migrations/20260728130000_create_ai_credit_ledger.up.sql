-- Migration: create_ai_credit_ledger
-- Story 4.3a — the append-only AI credit ledger (A6,
-- blocker-resolutions-2026-06-04.md:70-111). Minted HERE, not deferred to 6.5
-- (Ducdo): the enqueue AC requires a -1 job_deduction row in the SAME tx as
-- the job insert, and the refund AC a +1 job_failed_refund on terminal
-- failure — deferring the table would make those ACs unsatisfiable and leave
-- R23 unmitigated. 4.3a writes only job_deduction / job_failed_refund; 6.5
-- layers monthly_grant / addon_purchase / admin_adjustment + the balance cache
-- + Settings UI on top (the reason CHECK already admits all five).
--
-- IDEMPOTENCY (R23/A6): the partial unique index (ref_job_id, reason) makes a
-- second refund for the same job a no-op via ON CONFLICT DO NOTHING — the
-- worker-terminal-fail path and the 5-min stuck-sweep can both attempt a
-- refund and exactly one lands. Enforced by the DB, never by discipline.
--
-- APPEND-ONLY (SEC-9): mirror auth_audit_logs (Story 1.3b). RLS keys reads +
-- inserts on center_id with the null-guard; UPDATE/DELETE/TRUNCATE are REVOKEd
-- from the classlite_app role so history cannot be rewritten. balance_after is
-- the running sum computed under a per-(center,user) pg_advisory_xact_lock taken
-- before the SUM read (see store/queries/ai_credit_ledger.sql) so concurrent
-- writes for the same payer cannot record the same stale sum into this
-- unrepairable table; the balance cache + nightly reconciliation cron are 6.5.
--
-- ref_job_id is a SOFT pointer (plain uuid, NOT a FK) by design. An append-only
-- audit ledger must OUTLIVE the rows it references — a real FK forces one of
-- three wrong behaviors: ON DELETE CASCADE silently erases credit history when
-- a job row is removed (contradicts append-only), SET NULL mutates an immutable
-- row, RESTRICT blocks the centers→jobs cascade. A6 documents the logical
-- reference; the partial unique index (ref_job_id, reason) is what enforces the
-- refund idempotency invariant, and it needs no FK to do so. A center delete
-- cascades BOTH jobs and ledger via their center_id FKs, so no dangling pointer
-- can arise in practice (jobs are never hard-deleted independently).

CREATE TABLE ai_credit_ledger (
    id              uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id       uuid       NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    user_id         uuid       NOT NULL REFERENCES users (id),
    change          integer    NOT NULL,
    reason          text       NOT NULL
                                   CHECK (reason IN ('monthly_grant', 'job_deduction',
                                                     'job_failed_refund', 'addon_purchase',
                                                     'admin_adjustment')),
    ref_job_id      uuid,
    ref_purchase_id uuid,
    balance_after   integer    NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Idempotency guard: at most one row per (job, reason). A FULL (not partial)
-- unique index so the production refund `INSERT … ON CONFLICT (ref_job_id,
-- reason) DO NOTHING` can INFER it — a partial index needs its WHERE predicate
-- repeated in the ON CONFLICT clause, which the refund query does not carry.
-- NULLs are distinct by default (NULLS DISTINCT), so 6.5's grant/purchase rows
-- (null ref_job_id) still stack freely — only real (job, reason) pairs collide.
CREATE UNIQUE INDEX uq_ai_credit_ledger_job_reason
    ON ai_credit_ledger (ref_job_id, reason);

-- Read path: a center/user's ledger newest-first (balance display, 6.5 cache).
CREATE INDEX idx_ai_credit_ledger_read
    ON ai_credit_ledger (center_id, user_id, created_at DESC);

ALTER TABLE ai_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_ledger FORCE ROW LEVEL SECURITY;

-- INSERT-only tenant policies (no UPDATE/DELETE policy — append-only).
CREATE POLICY ai_credit_ledger_select ON ai_credit_ledger
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY ai_credit_ledger_insert ON ai_credit_ledger
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Append-only defense in depth (mirrors auth_audit_logs / audit_logs). The
-- non-superuser application role cannot mutate or wipe credit history.
REVOKE UPDATE, DELETE, TRUNCATE ON ai_credit_ledger FROM classlite_app;

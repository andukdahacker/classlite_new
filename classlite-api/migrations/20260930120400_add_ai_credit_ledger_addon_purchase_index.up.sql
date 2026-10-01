-- Migration: add_ai_credit_ledger_addon_purchase_index
-- Story 9.2a (AC10/AC33/D22 — Murat: re-runs the 9-1a D17 double-credit bug) — the add-on
-- purchase idempotency guard. The 9-1a idempotency index is UNIQUE(ref_job_id, reason); an
-- `addon_purchase` row has ref_job_id NULL (NULLs distinct) so that arbiter NEVER fires for
-- add-ons. Add a SEPARATE FULL UNIQUE(ref_purchase_id, reason) index so a dedicated
-- `InsertAddonPurchaseLedgerRow … ON CONFLICT (ref_purchase_id, reason) DO NOTHING` can
-- INFER it (a FULL index — like 9-1a's uq_ai_credit_ledger_job_reason — needs no WHERE
-- predicate repeated in the ON CONFLICT). Non-addon rows carry ref_purchase_id NULL (NULLs
-- distinct) so they never collide; only a real (purchase, reason) pair dedups.
--
-- The 4.3a append-only REVOKE (UPDATE/DELETE/TRUNCATE from classlite_app) is app-role DML
-- and does NOT block this migration-role CREATE INDEX. No RLS/policy change. Additive.

CREATE UNIQUE INDEX uq_ai_credit_ledger_purchase_reason
    ON ai_credit_ledger (ref_purchase_id, reason);

-- Migration: create_ai_credits
-- Story 9.1a (AC2, D5/D14) — the per-center AI-credit balance, the ENFORCEMENT
-- source-of-truth the pre-enqueue gate reads/locks (fast: one row per center). It is
-- a TYPED PROJECTION of the append-only ai_credit_ledger head (D14): at all times
-- `available = (monthly_allocation - monthly_used) + addon_remaining` equals the
-- latest ledger row's balance_after. ai_credit_ledger stays the audit trail; this is
-- the mutable bucket decomposition.
--
-- Buckets: monthly_allocation/monthly_used reset lazily each period (D6 — monthly_used
-- zeroed, unused remainder FORFEITED); addon_remaining CARRIES FORWARD (add-ons never
-- expire, FR-64) and is spent only AFTER the monthly allowance (D-CREDIT). reset_at is
-- the next lazy-reset boundary — VN-local (centers.timezone) month start, non-null even
-- for Free (D26a), so the lazy reset keys on it, not the NULL Free current_period_end.
--
-- CHECKs monthly_used >= 0 / addon_remaining >= 0 (D26d) are the last line against a
-- refund/consume arithmetic bug underflowing a bucket. Same RLS shape as subscriptions.

CREATE TABLE ai_credits (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id          uuid        NOT NULL UNIQUE REFERENCES centers (id) ON DELETE CASCADE,
    monthly_allocation integer     NOT NULL,
    monthly_used       integer     NOT NULL DEFAULT 0 CHECK (monthly_used >= 0),
    addon_remaining    integer     NOT NULL DEFAULT 0 CHECK (addon_remaining >= 0),
    reset_at           timestamptz NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credits FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_credits_select ON ai_credits
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY ai_credits_insert ON ai_credits
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY ai_credits_update ON ai_credits
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

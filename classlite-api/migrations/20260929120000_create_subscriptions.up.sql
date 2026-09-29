-- Migration: create_subscriptions
-- Story 9.1a (AC1, D7) — the per-center billing subscription row. Exactly ONE row
-- per center (UNIQUE(center_id)), holding the plan tier + status + billing period.
-- The plan tier drives the limits enforced write-time in billing_service and the
-- storage ceiling written into centers.storage_limit_bytes (AC6/D21). `plan` is
-- ALWAYS read from this table — never a JWT claim (SEC-1, AC1).
--
-- Free has no billing period: current_period_end is NULL (AC3). polar_subscription_id
-- is NULL until 9.2 creates a real Polar subscription. The status CHECK admits the
-- three 9-1a states; 9.3 GROWS it (Polar trialing/unpaid/paused) — no code may assume
-- exactly three (D26e).
--
-- RLS: ENABLE+FORCE with tenant SELECT/INSERT/UPDATE policies keyed on center_id
-- (mirror ai_credit_ledger, but not append-only — billing state mutates). The
-- null-guard NULLIF(current_setting('app.current_tenant_id', true), '') prevents a
-- cross-tenant leak when the tenant GUC is unset (returns NULL → no rows).

CREATE TABLE subscriptions (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id             uuid        NOT NULL UNIQUE REFERENCES centers (id) ON DELETE CASCADE,
    plan                  text        NOT NULL CHECK (plan IN ('free', 'pro', 'studio')),
    billing_cycle         text        NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
    status                text        NOT NULL CHECK (status IN ('active', 'past_due', 'cancelled')),
    polar_subscription_id text,
    current_period_start  timestamptz NOT NULL,
    current_period_end    timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_select ON subscriptions
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY subscriptions_insert ON subscriptions
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY subscriptions_update ON subscriptions
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

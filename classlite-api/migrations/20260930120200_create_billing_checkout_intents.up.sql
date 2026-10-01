-- Migration: create_billing_checkout_intents
-- Story 9.2a (AC29/D18/D20) — a durable record of a checkout the owner started, written
-- BEFORE the hosted URL is returned. Two jobs:
--   (1) LOST-WEBHOOK RECONCILE (D18): if the confirming webhook never arrives, a pending
--       intent past a threshold is polled against Polar on GET /api/billing and applied
--       exactly once via the shared idempotent apply path — so money that left the card is
--       never silently lost.
--   (2) TENANT-RESOLUTION ANCHOR (D20): on the FIRST-ever subscription there is no
--       polar_subscription_id yet; the webhook resolves center_id via this
--       polar_checkout_id → center_id mapping first (then persisted polar_subscription_id,
--       then metadata — with the confused-deputy guard: the persisted mapping WINS over the
--       untrusted body).
--
-- RLS tenant-scoped (SELECT/INSERT/UPDATE — the reconcile marks a row `applied`). Same
-- null-guarded policy shape as subscriptions.

CREATE TABLE billing_checkout_intents (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id            uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    kind                 text        NOT NULL CHECK (kind IN ('upgrade', 'addon')),
    target_plan          text,
    target_billing_cycle text,
    addon_pack_id        text,
    polar_checkout_id    text,
    status               text        NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending', 'applied', 'expired')),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- The tenant-resolution anchor lookup (D20) + reconcile-by-checkout. NULLs distinct.
CREATE UNIQUE INDEX uq_billing_checkout_intents_checkout_id
    ON billing_checkout_intents (polar_checkout_id);

-- Reconcile scan: a center's pending intents oldest-first (the GET-poll threshold check).
CREATE INDEX idx_billing_checkout_intents_pending
    ON billing_checkout_intents (center_id, status, created_at);

ALTER TABLE billing_checkout_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_checkout_intents FORCE ROW LEVEL SECURITY;

CREATE POLICY billing_checkout_intents_select ON billing_checkout_intents
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY billing_checkout_intents_insert ON billing_checkout_intents
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY billing_checkout_intents_update ON billing_checkout_intents
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

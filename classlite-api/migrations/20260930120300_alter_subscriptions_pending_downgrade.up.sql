-- Migration: alter_subscriptions_pending_downgrade
-- Story 9.2a (AC15/AC16/D9/D11/D26) — the at-renewal downgrade intent + the Polar status
-- widening. NEVER edits the applied 9-1a create_subscriptions migration (WF-2).
--
-- (1) Pending-downgrade columns (D9/D26): a scheduled downgrade records the SINGLE pending
--     target here; the current plan/limits stay active until the renewal boundary, when the
--     webhook applies pending_plan and clears these columns. Nullable — no CHECK NOT NULL,
--     and the plan CHECK admits NULL (a cleared/absent pending change).
-- (2) status CHECK widening (D11/D26e): the 9-1a CHECK admitted only active/past_due/
--     cancelled and warned it GROWS at the Polar story. Polar drives trialing/unpaid/paused
--     too, so drop the auto-named 9-1a constraint and re-add a widened one (no code assumes a
--     closed set — the API status field stays an open string).

ALTER TABLE subscriptions
    ADD COLUMN pending_plan          text CHECK (pending_plan IN ('free', 'pro', 'studio')),
    ADD COLUMN pending_billing_cycle text CHECK (pending_billing_cycle IN ('monthly', 'annual')),
    ADD COLUMN pending_effective_at  timestamptz;

ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing', 'unpaid', 'paused'));

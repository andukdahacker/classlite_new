-- Reverse 20260930120300_alter_subscriptions_pending_downgrade. Restore the 3-value
-- status CHECK (D11 reversibility) and drop the pending-downgrade columns. Safe on an
-- empty/fresh DB (migrate up→down→up); a live rollback with rows in a widened status
-- would fail the re-added CHECK — acceptable, the widened states are 9.2+ only.
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('active', 'past_due', 'cancelled'));

ALTER TABLE subscriptions
    DROP COLUMN IF EXISTS pending_effective_at,
    DROP COLUMN IF EXISTS pending_billing_cycle,
    DROP COLUMN IF EXISTS pending_plan;

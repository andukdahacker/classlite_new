-- Reverse alter_subscriptions_grace_period (Story 9.3, D8). Drops the four grace-tracking
-- columns; the 9-2a status CHECK (active/past_due/cancelled/trialing/unpaid/paused) is
-- untouched, so a down→up round-trip is clean.
ALTER TABLE subscriptions
    DROP COLUMN grace_last_tick_day,
    DROP COLUMN grace_retry_count,
    DROP COLUMN payment_failed_at,
    DROP COLUMN grace_period_start;

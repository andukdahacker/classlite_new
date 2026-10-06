-- Migration: alter_subscriptions_grace_period
-- Story 9.3 (D8, AC1/AC2/AC5/AC6/AC17) — the payment-failure grace-period state on the
-- subscriptions row. Layered on the shipped 9-2a receiver: a Polar payment-failure event
-- sets status='past_due' and stamps grace_period_start/payment_failed_at; the MockClock-driven
-- billing_grace_tick job (on the existing jobs queue) then runs the 7-day clock off these cols.
-- NEVER edits the applied 9-1a/9-2a subscriptions migrations (WF-2).
--
-- NO status-CHECK change: 9-2a already widened the CHECK to admit past_due + cancelled
-- (alter_subscriptions_pending_downgrade), so the grace entry (past_due) and the day-7
-- auto-downgrade (cancelled) both satisfy the existing constraint.
--
--   grace_period_start   when the 7-day clock started (= clk.Now() at the payment-failure
--                        event). NULL ⇔ not in grace. The elapsed-day index + the 23:59
--                        day-7 deadline are both derived from it (R1).
--   payment_failed_at    when Polar reported the failure (stamped with grace entry; retained
--                        for the recovery timeline + audit).
--   grace_retry_count    how many Polar re-collect requests OUR ticks have issued (days 3 & 5).
--                        Provider-agnostic AC4 anchor — DB-observable regardless of whether
--                        Polar exposes a manual re-collect or auto-retries (D2).
--   grace_last_tick_day  the per-day high-water marker (BLOCKER-4): the highest elapsed-day a
--                        tick has already acted on. EVERY day's effect is gated on
--                        elapsedDay > grace_last_tick_day, so a re-run tick for an
--                        already-processed day (incl. the email-only days 0/6 that no counter
--                        guards) is a pure no-op (AC5 idempotency). -1 = no tick has acted yet.
--
-- All on the same subscriptions row → the existing tenant SELECT/INSERT/UPDATE RLS policies
-- cover the new columns (AC17 cross-tenant isolation holds with no new policy).

ALTER TABLE subscriptions
    ADD COLUMN grace_period_start  timestamptz,
    ADD COLUMN payment_failed_at   timestamptz,
    ADD COLUMN grace_retry_count   smallint NOT NULL DEFAULT 0,
    ADD COLUMN grace_last_tick_day smallint NOT NULL DEFAULT -1;

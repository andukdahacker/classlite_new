-- Migration: backfill_free_subscriptions
-- Story 9.1a (AC3, D7/D26a) — every existing center gets exactly one Free
-- subscriptions row + one 0/0/0 ai_credits row, so the write-time gate never divides
-- by a missing row. Idempotent: UNIQUE(center_id) + ON CONFLICT DO NOTHING makes a
-- re-run a no-op (AC3).
--
-- Deploy order (D26b): the on-center-create code that writes these rows for NEW
-- centers ships BEFORE this backfill, so a center created in the gap is not orphaned
-- (the backfill then no-ops on it via ON CONFLICT).
--
-- RLS trap (mirror 20260908120200_backfill_enrollment_history_genesis): both tables
-- are ENABLE+FORCE with a FOR INSERT WITH CHECK (center_id = app.current_tenant_id).
-- migrate.sh connects as a superuser (bypasses RLS), but the per-center
-- set_config('app.current_tenant_id', …, is_local => true) loop keeps the INSERT
-- correct even under a non-superuser table-owner with FORCE RLS. is_local=true is
-- tx-scoped (golang-migrate wraps each migration in a tx) so it never leaks.
--
-- reset_at (D26a/D24): VN-local (centers.timezone) start of NEXT month, as a
-- timestamptz. date_trunc on the wall-clock local time, +1 month, then re-anchored to
-- the center's zone. Genesis Free = monthly_allocation 0 (Free grants no AI credits).

DO $$
DECLARE
    v_center  uuid;
    v_tz      text;
    v_reset   timestamptz;
BEGIN
    FOR v_center, v_tz IN SELECT id, COALESCE(timezone, 'UTC') FROM centers LOOP
        PERFORM set_config('app.current_tenant_id', v_center::text, true);

        v_reset := (date_trunc('month', (now() AT TIME ZONE v_tz)) + interval '1 month') AT TIME ZONE v_tz;

        INSERT INTO subscriptions
            (id, center_id, plan, billing_cycle, status,
             polar_subscription_id, current_period_start, current_period_end)
        VALUES
            (gen_random_uuid(), v_center, 'free', 'monthly', 'active',
             NULL, now(), NULL)
        ON CONFLICT (center_id) DO NOTHING;

        INSERT INTO ai_credits
            (id, center_id, monthly_allocation, monthly_used, addon_remaining, reset_at)
        VALUES
            (gen_random_uuid(), v_center, 0, 0, 0, v_reset)
        ON CONFLICT (center_id) DO NOTHING;
    END LOOP;
END $$;

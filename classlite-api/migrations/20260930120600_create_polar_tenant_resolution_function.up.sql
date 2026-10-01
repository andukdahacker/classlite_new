-- Migration: create_polar_tenant_resolution_function
-- Story 9.2a (AC31/D20/SEC-6) — pre-tenant tenant resolution for the webhook receiver.
--
-- The POST /api/webhooks/polar receiver authenticates by SIGNATURE, not a tenant GUC, so
-- it runs BEFORE tenant context is set (like the 4.3a worker dequeue). To resolve center_id
-- from a signed `subscription.updated` whose data.id is a persisted polar_subscription_id,
-- it must read `subscriptions` ACROSS tenants — but that table is FORCE RLS, so a plain
-- classlite_app SELECT with no tenant GUC returns 0 rows. This SECURITY DEFINER function is
-- the minimal RLS-bypass surface (the exact 4.3a next_ready_job_center pattern): it returns
-- ONLY a center_id (never subscription data), so the receiver can then bind + SET LOCAL and
-- do every mutation under normal RLS.
--
-- CONFUSED-DEPUTY GUARD (D20): because the receiver resolves via this PERSISTED mapping
-- FIRST, a signed-but-replayed event whose body metadata.center_id names an attacker's center
-- can never redirect a grant — the persisted (polar_subscription_id → center) mapping wins.
--
-- search_path is pinned (pg_catalog, public) so the definer's privileges cannot be hijacked
-- via a shadowed relation. STABLE (read-only). Returns NULL when the subscription id is not
-- yet bound (the first-ever event for a new subscription — the receiver then falls back to
-- the signed metadata.center_id).

CREATE FUNCTION polar_center_by_subscription_id(p_polar_sub_id text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT center_id
    FROM subscriptions
    WHERE polar_subscription_id = p_polar_sub_id
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION polar_center_by_subscription_id(text) TO classlite_app;

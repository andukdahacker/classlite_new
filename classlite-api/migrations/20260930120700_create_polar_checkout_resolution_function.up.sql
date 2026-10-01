-- Migration: create_polar_checkout_resolution_function
-- Story 9.2a (AC31/D20/SEC-6, code-review D-3) — the pre-tenant FIRST-EVENT tenant-resolution
-- anchor for the webhook receiver.
--
-- The first-ever subscription.updated/.active for a new subscription has no persisted
-- polar_subscription_id yet; D20 names billing_checkout_intents (which WE populate at
-- checkout-create) as the authoritative first-resolution anchor, keyed by polar_checkout_id.
-- But billing_checkout_intents is FORCE RLS and the receiver runs BEFORE any tenant GUC, so a
-- plain classlite_app SELECT returns 0 rows. This SECURITY DEFINER function is the minimal
-- RLS-bypass surface — the exact polar_center_by_subscription_id() pattern (migration 120600):
-- it returns ONLY a center_id (never intent data), so the receiver can bind + SET LOCAL and then
-- mutate under normal RLS.
--
-- CONFUSED-DEPUTY GUARD (D20): resolving via this persisted anchor FIRST means a signed/replayed
-- event whose body metadata.center_id names an attacker's center can never redirect a grant —
-- the checkout we planted wins over the untrusted body.
--
-- search_path pinned (pg_catalog, public) so the definer's privileges cannot be hijacked via a
-- shadowed relation. STABLE (read-only). Returns NULL when the checkout id is unknown (the
-- receiver then falls back to the signed metadata.center_id).

CREATE FUNCTION polar_center_by_checkout_id(p_polar_checkout_id text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT center_id
    FROM billing_checkout_intents
    WHERE polar_checkout_id = p_polar_checkout_id
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION polar_center_by_checkout_id(text) TO classlite_app;

-- Migration: create single_center_membership_for_user SECURITY DEFINER function
--
-- buildAccessToken (login + refresh) resolves the caller's single-membership
-- center_id + role so the JWT carries the tenant claim and the frontend can
-- rehydrate Session.center. It did so with a PLAIN `SELECT ... FROM center_members
-- WHERE user_id = $1` from the pre-tenant (no app.current_tenant_id) login context.
-- But center_members is FORCE RLS — a plain read by the non-superuser classlite_app
-- role with no tenant GUC returns 0 rows, so login/refresh left center_id/role
-- UNSET for EVERY onboarded user: no tenant in the JWT → 403 on every scoped route
-- (the onboarding-complete user cannot use the app; the bug detonates on the first
-- real prod onboarding + on every 15-min token refresh).
--
-- The counterpart count was already correct via count_center_members_for_user
-- (migration 20260724120000); only the (center_id, role) READ was missing a
-- SECURITY DEFINER surface. This is the same narrow RLS-bypass pattern as
-- count_center_members_for_user / get_invite_by_token_hash / the polar resolvers:
-- a legitimate pre-tenant read done via a tight SECURITY DEFINER function so RLS
-- stays intact for every other center_members access path. search_path is pinned
-- so the definer's privileges cannot be hijacked via a shadowed relation. STABLE
-- (read-only). LIMIT 1 is belt-and-suspenders — the caller only invokes this when
-- count_center_members_for_user == 1.

CREATE OR REPLACE FUNCTION single_center_membership_for_user(p_user_id uuid)
RETURNS TABLE (center_id uuid, role text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT center_id, role
    FROM center_members
    WHERE user_id = p_user_id
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION single_center_membership_for_user(uuid) TO classlite_app;
REVOKE EXECUTE ON FUNCTION single_center_membership_for_user(uuid) FROM PUBLIC;

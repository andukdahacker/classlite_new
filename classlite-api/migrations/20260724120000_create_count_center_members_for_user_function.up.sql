-- Migration: create count_center_members_for_user SECURITY DEFINER function
-- Story 2.7 — bulk import PREVIEW must detect a student email that already
-- belongs to ANOTHER center (the one-center-per-user invariant,
-- idx_center_members_user_id) so the row can be flagged USER_IN_ANOTHER_CENTER
-- before any write. center_members is FORCE-RLS-scoped to the caller's center
-- (center_members_tenant_isolation USING center_id = current_tenant), so a
-- tenant-scoped COUNT cannot see the other center's row. This is the same
-- shape as get_invite_by_token_hash (Story 1.6): a legitimate PRE-decision read
-- that spans tenants, done via a narrow SECURITY DEFINER function so RLS stays
-- intact for every other center_members access path.
--
-- Returns the TOTAL number of center memberships for the user across ALL
-- centers. The caller subtracts the (RLS-visible) membership in its own center
-- to decide whether the user is a member elsewhere.

CREATE OR REPLACE FUNCTION count_center_members_for_user(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT count(*) FROM center_members WHERE user_id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION count_center_members_for_user(uuid) TO classlite_app;
REVOKE EXECUTE ON FUNCTION count_center_members_for_user(uuid) FROM PUBLIC;

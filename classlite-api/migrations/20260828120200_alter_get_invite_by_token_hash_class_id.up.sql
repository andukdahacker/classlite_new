-- Migration: alter_get_invite_by_token_hash_class_id
-- Story 7.1a (D13a) — the accept-invite path resolves the invite through the
-- SECURITY DEFINER function get_invite_by_token_hash (bypasses RLS — invite
-- acceptance is PRE-tenant). Adding invites.class_id (20260828120100) does NOT
-- surface it to the accept path: the function's RETURNS TABLE must also expose
-- class_id, or loadInviteByTokenHash can never read it and D7 auto-assign is
-- impossible. class_id is appended LAST so the column order of the existing
-- return columns is preserved.
--
-- Adding a column to RETURNS TABLE changes the function's return type, which
-- CREATE OR REPLACE cannot do in place — DROP then CREATE. SECURITY DEFINER,
-- STABLE, search_path, and the GRANT/REVOKE grants are re-established verbatim.

DROP FUNCTION get_invite_by_token_hash(text);

CREATE FUNCTION get_invite_by_token_hash(p_token_hash text)
RETURNS TABLE (
    id          uuid,
    center_id   uuid,
    inviter_id  uuid,
    email       text,
    name        text,
    role        text,
    token_hash  text,
    expires_at  timestamptz,
    accepted_at timestamptz,
    created_at  timestamptz,
    class_id    uuid
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT id, center_id, inviter_id, email, name, role, token_hash,
           expires_at, accepted_at, created_at, class_id
    FROM invites
    WHERE token_hash = p_token_hash
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_invite_by_token_hash(text) TO classlite_app;
REVOKE EXECUTE ON FUNCTION get_invite_by_token_hash(text) FROM PUBLIC;

-- Reverse alter_get_invite_by_token_hash_class_id (Story 7.1a D13a) —
-- restore the prior signature (without class_id) from migration
-- 20260607120100. DROP then CREATE (the return type changes back).

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
    created_at  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT id, center_id, inviter_id, email, name, role, token_hash,
           expires_at, accepted_at, created_at
    FROM invites
    WHERE token_hash = p_token_hash
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_invite_by_token_hash(text) TO classlite_app;
REVOKE EXECUTE ON FUNCTION get_invite_by_token_hash(text) FROM PUBLIC;

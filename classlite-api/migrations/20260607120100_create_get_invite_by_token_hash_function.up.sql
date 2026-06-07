-- Migration: create get_invite_by_token_hash SECURITY DEFINER function
-- Story 1.6 — `invites` is RLS-protected, but invite acceptance is a
-- PRE-TENANT operation (the caller doesn't know which center they're
-- joining until after the token resolves). The token IS the access
-- boundary — 32 random bytes from crypto/rand means brute-force is
-- computationally infeasible. SECURITY DEFINER is the idiomatic Postgres
-- bypass and the cleanest path that preserves RLS for every other access
-- path (Owner listing invites, Admin creating invites).

CREATE OR REPLACE FUNCTION get_invite_by_token_hash(p_token_hash text)
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

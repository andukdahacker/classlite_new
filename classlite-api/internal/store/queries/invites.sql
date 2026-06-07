-- name: CreateInvite :one
INSERT INTO invites (center_id, inviter_id, email, name, role, token_hash, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, center_id, inviter_id, email, name, role, token_hash, expires_at, accepted_at, created_at;

-- Story 1.6 — token-based invite lookup goes through the SECURITY DEFINER
-- function `get_invite_by_token_hash` which bypasses RLS (invite acceptance
-- is PRE-tenant; the token IS the access boundary). sqlc cannot introspect
-- SELECT-from-function returning TABLE so the call is made directly via
-- raw pgx (see internal/service/auth_invite.go).

-- name: MarkInviteAcceptedGuarded :execrows
-- Returns affected row count so the service can detect "lost the accept
-- race" — two clients submitting the same token concurrently. The
-- WHERE accepted_at IS NULL guard means only the first request wins.
UPDATE invites SET accepted_at = now()
WHERE id = $1 AND accepted_at IS NULL;

-- name: ListInvitesByCenter :many
SELECT id, center_id, inviter_id, email, name, role, token_hash, expires_at, accepted_at, created_at
FROM invites
WHERE center_id = $1
ORDER BY created_at DESC;

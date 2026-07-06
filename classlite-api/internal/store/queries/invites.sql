-- name: CreateInvite :one
INSERT INTO invites (center_id, inviter_id, email, name, role, token_hash, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, center_id, inviter_id, email, name, role, token_hash, expires_at, accepted_at, created_at;

-- name: CreateInviteFull :one
-- Story 2.2 — Story 1.6's CreateInvite lets the DB DEFAULT the id.
-- Spawn pre-generates the invite id (like model.NewID for classes) so the
-- response payload can round-trip through the same tx without an extra
-- RETURNING id round-trip after conflict retry.
INSERT INTO invites (id, center_id, inviter_id, email, name, role, token_hash, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, center_id, inviter_id, email, name, role, token_hash, expires_at, accepted_at, created_at;

-- name: GetActiveInviteByEmail :one
-- Story 2.2 — dedup lookup after Spawn hits idx_invites_center_email_active
-- unique violation. Returns the winning row so we can reuse its id + skip
-- the email send.
--
-- C1-05 review fix — the previous `expires_at > $3` guard could return zero
-- rows when a stale (expired, unaccepted) row still owned the partial unique
-- index slot (index only requires `accepted_at IS NULL`). That caused a
-- 23505 → pgx.ErrNoRows → 500 spiral. The predicate is dropped so the query
-- returns whatever row currently owns the slot; caller sees its ExpiresAt on
-- the response and can decide whether the reused invite is fresh enough for
-- its purposes.
SELECT id, center_id, inviter_id, email, name, role, token_hash, expires_at, accepted_at, created_at
FROM invites
WHERE center_id = sqlc.arg('center_id')
  AND LOWER(email) = LOWER(sqlc.arg('email'))
  AND accepted_at IS NULL;

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

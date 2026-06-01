-- name: CreateInvite :one
INSERT INTO invites (center_id, inviter_id, email, name, role, token, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, center_id, inviter_id, email, name, role, token, expires_at, accepted_at, created_at;

-- name: GetInviteByToken :one
SELECT id, center_id, inviter_id, email, name, role, token, expires_at, accepted_at, created_at
FROM invites
WHERE token = $1;

-- name: MarkInviteAccepted :exec
UPDATE invites
SET accepted_at = now()
WHERE id = $1;

-- name: ListInvitesByCenter :many
SELECT id, center_id, inviter_id, email, name, role, token, expires_at, accepted_at, created_at
FROM invites
WHERE center_id = $1
ORDER BY created_at DESC;

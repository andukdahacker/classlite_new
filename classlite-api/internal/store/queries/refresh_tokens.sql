-- name: CreateRefreshToken :one
INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, remember_me)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, user_id, token_hash, family_id, expires_at, revoked_at, remember_me, created_at;

-- name: GetRefreshTokenByTokenHash :one
SELECT id, user_id, token_hash, family_id, expires_at, revoked_at, remember_me, created_at
FROM refresh_tokens
WHERE token_hash = $1;

-- name: DeleteRefreshToken :exec
DELETE FROM refresh_tokens
WHERE id = $1;

-- name: DeleteAllRefreshTokensForUser :exec
DELETE FROM refresh_tokens
WHERE user_id = $1;

-- name: DeleteRefreshTokenByTokenHash :exec
DELETE FROM refresh_tokens
WHERE token_hash = $1;

-- name: RotateRefreshToken :one
-- Atomic delete-and-return: pgx returns ErrNoRows when 0 rows match (race
-- loser or unknown hash). The same row-locking that makes DELETE...RETURNING
-- safe under concurrent rotation is what AC9 leans on.
--
-- Expiry is intentionally NOT filtered here: an expired-but-uncleaned row
-- must NOT trigger reuse detection (which deletes the entire family). The
-- caller checks `expires_at` against the injected clock after this returns
-- and surfaces RefreshTokenInvalidError on expiry without revoking the
-- family.
DELETE FROM refresh_tokens
WHERE token_hash = $1
  AND revoked_at IS NULL
RETURNING id, user_id, family_id, expires_at, remember_me;

-- name: DeleteRefreshTokensByFamily :many
-- Used by reuse detection (AC8) and the lost-race path (AC9). Returns
-- (id, user_id) per deleted row so callers can count for assertions and
-- attribute the family_revoked audit row to the rightful user.
DELETE FROM refresh_tokens
WHERE family_id = $1
RETURNING id, user_id;

-- name: CountSiblingsInFamily :one
SELECT COUNT(*) FROM refresh_tokens WHERE family_id = $1;

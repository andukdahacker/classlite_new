-- name: CreateRefreshToken :one
INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING id, user_id, token_hash, family_id, expires_at, revoked_at, created_at;

-- name: GetRefreshTokenByTokenHash :one
SELECT id, user_id, token_hash, family_id, expires_at, revoked_at, created_at
FROM refresh_tokens
WHERE token_hash = $1;

-- name: DeleteRefreshToken :exec
DELETE FROM refresh_tokens
WHERE id = $1;

-- name: DeleteAllRefreshTokensForUser :exec
DELETE FROM refresh_tokens
WHERE user_id = $1;

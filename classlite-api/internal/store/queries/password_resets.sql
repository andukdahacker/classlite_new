-- name: CreatePasswordReset :one
INSERT INTO password_resets (user_id, token, expires_at)
VALUES ($1, $2, $3)
RETURNING id, user_id, token, expires_at, used_at, created_at;

-- name: GetPasswordResetByToken :one
SELECT id, user_id, token, expires_at, used_at, created_at
FROM password_resets
WHERE token = $1;

-- name: MarkPasswordResetUsed :exec
UPDATE password_resets
SET used_at = now()
WHERE id = $1;

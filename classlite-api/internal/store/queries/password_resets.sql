-- name: CreatePasswordReset :one
INSERT INTO password_resets (user_id, token_hash, expires_at, email)
VALUES ($1, $2, $3, $4)
RETURNING id, user_id, token_hash, expires_at, used_at, email, created_at;

-- name: GetPasswordResetByTokenHash :one
SELECT id, user_id, token_hash, expires_at, used_at, email, created_at
FROM password_resets
WHERE token_hash = $1;

-- name: GetActivePasswordResetByTokenHash :one
-- Closes deferred-work W5: explicit active-only lookup keyed on the time
-- the service injects (so MockClock drives expiry behavior in tests).
SELECT id, user_id, token_hash, expires_at, used_at, email, created_at
FROM password_resets
WHERE token_hash = $1
  AND used_at IS NULL
  AND expires_at > $2;

-- name: MarkPasswordResetUsed :execrows
-- WHERE used_at IS NULL closes the TOCTOU window between two concurrent
-- ResetPassword calls. The caller checks RowsAffected == 1 and surfaces
-- ResetTokenConsumedError on 0 rows.
UPDATE password_resets
SET used_at = $2
WHERE id = $1
  AND used_at IS NULL;

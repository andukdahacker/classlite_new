-- name: CreateEmailVerification :one
INSERT INTO email_verifications (user_id, token, expires_at)
VALUES ($1, $2, $3)
RETURNING id, user_id, token, expires_at, verified_at, created_at;

-- name: GetEmailVerificationByToken :one
SELECT id, user_id, token, expires_at, verified_at, created_at
FROM email_verifications
WHERE token = $1;

-- name: MarkEmailVerificationVerified :exec
UPDATE email_verifications
SET verified_at = now()
WHERE id = $1;

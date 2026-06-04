-- name: CreateEmailVerification :one
INSERT INTO email_verifications (user_id, token, expires_at)
VALUES ($1, $2, $3)
RETURNING id, user_id, token, expires_at, verified_at, created_at;

-- name: GetEmailVerificationByToken :one
SELECT id, user_id, token, expires_at, verified_at, created_at
FROM email_verifications
WHERE token = $1;

-- name: MarkEmailVerificationVerified :execrows
-- Guarded UPDATE: only mark a row consumed if it is still unconsumed.
-- Returning rowsAffected lets the service layer detect a concurrent verify race
-- (0 rows = another request already consumed the token) and short-circuit to an
-- idempotent 200 rather than emit a second audit row.
UPDATE email_verifications
SET verified_at = now()
WHERE id = $1 AND verified_at IS NULL;

-- name: InvalidateUnconsumedEmailVerificationsForUser :exec
-- Marks every unconsumed token for a user as consumed (verified_at = now()).
-- Used on token rotation (resend) and on successful verify, so prior tokens cannot be replayed.
UPDATE email_verifications
SET verified_at = now()
WHERE user_id = $1 AND verified_at IS NULL;

-- name: GetEmailVerificationByID :one
-- Backs the verify-status polling endpoint. pollIds expire 24h after creation
-- (matches the verification token TTL, per Story 1.4 AC8 / M6).
SELECT id, user_id, token, expires_at, verified_at, created_at
FROM email_verifications
WHERE id = $1
  AND created_at > now() - INTERVAL '24 hours';

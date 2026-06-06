-- name: InsertLoginAttempt :exec
INSERT INTO login_attempts (email_norm, attempted_at, success, ip_address)
VALUES ($1, $2, $3, $4);

-- name: CountFailedLoginAttemptsSince :one
SELECT COUNT(*) FROM login_attempts
WHERE email_norm = $1 AND attempted_at > $2 AND success = false;

-- name: LastFailedLoginAttempt :one
SELECT attempted_at FROM login_attempts
WHERE email_norm = $1 AND success = false
ORDER BY attempted_at DESC
LIMIT 1;

-- name: DeleteLoginAttemptsByEmail :exec
DELETE FROM login_attempts WHERE email_norm = $1;

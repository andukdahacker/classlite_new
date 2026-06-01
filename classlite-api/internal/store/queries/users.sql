-- name: GetUserByID :one
SELECT id, email, password_hash, full_name, email_verified, avatar_url, language_pref, google_id, created_at, updated_at
FROM users
WHERE id = $1;

-- name: GetUserByEmail :one
SELECT id, email, password_hash, full_name, email_verified, avatar_url, language_pref, google_id, created_at, updated_at
FROM users
WHERE email = $1;

-- name: GetUserByGoogleID :one
SELECT id, email, password_hash, full_name, email_verified, avatar_url, language_pref, google_id, created_at, updated_at
FROM users
WHERE google_id = $1;

-- name: CreateUser :one
INSERT INTO users (email, password_hash, full_name, google_id)
VALUES ($1, $2, $3, $4)
RETURNING id, email, password_hash, full_name, email_verified, avatar_url, language_pref, google_id, created_at, updated_at;

-- name: UpdateUserEmailVerified :exec
UPDATE users
SET email_verified = true, updated_at = now()
WHERE id = $1;

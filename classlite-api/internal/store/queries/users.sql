-- name: GetUserByID :one
SELECT id, email, password_hash, full_name, email_verified, avatar_url, language_pref, google_id, created_at, updated_at, persona
FROM users
WHERE id = $1;

-- name: GetUserByEmail :one
SELECT id, email, password_hash, full_name, email_verified, avatar_url, language_pref, google_id, created_at, updated_at, persona
FROM users
WHERE email = $1;

-- name: GetUserByGoogleID :one
SELECT id, email, password_hash, full_name, email_verified, avatar_url, language_pref, google_id, created_at, updated_at, persona
FROM users
WHERE google_id = $1;

-- name: CreateUser :one
INSERT INTO users (email, password_hash, full_name, google_id)
VALUES ($1, $2, $3, $4)
RETURNING id, email, password_hash, full_name, email_verified, avatar_url, language_pref, google_id, created_at, updated_at, persona;

-- name: UpdateUserEmailVerified :exec
UPDATE users
SET email_verified = true, updated_at = now()
WHERE id = $1;

-- name: UpdateUserPassword :exec
UPDATE users
SET password_hash = $2, updated_at = now()
WHERE id = $1;

-- name: UpdateUserPersona :execrows
UPDATE users
SET persona = $2, updated_at = now()
WHERE id = $1;

-- name: GetUserPersona :one
SELECT persona FROM users WHERE id = $1;

-- name: GetUserPersonaAndEmail :one
-- Story 2.2 — Spawn reads persona (drives AC6 Founder auto-assign),
-- email (drives AC4 Branch A self-assign), AND full_name (drives the
-- inviter-name field in invite emails — C1-20 review fix; was previously
-- derived from the email local-part which leaked the caller's raw address
-- into invite subject / body). Users table has no RLS so a pool read is fine.
SELECT persona, email, full_name FROM users WHERE id = $1;

-- name: LinkGoogleAccount :execrows
-- Story 1.6 — Branch B of HandleGoogleCallback's account-resolution. The
-- WHERE google_id IS NULL clause is the race guard: two simultaneous
-- linkers can both load the row with google_id NULL, but only the first
-- UPDATE succeeds (1 row affected). The loser sees 0 rows affected and
-- the service surfaces *GoogleIDAlreadyLinkedError.
UPDATE users
SET google_id      = $2,
    email_verified = true,
    avatar_url     = COALESCE(avatar_url, $3),
    updated_at     = now()
WHERE id = $1 AND google_id IS NULL;

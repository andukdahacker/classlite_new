-- name: GetUserByID :one
SELECT id, email, password_hash, full_name, email_verified, avatar_url, language_pref, google_id, created_at, updated_at, persona, notification_settings
FROM users
WHERE id = $1;

-- name: GetUserByEmail :one
-- Case-insensitive lookup (Story 2.7 code review D3). All callers already pass a
-- lowercased address, but a mixed-case STORED email (legacy / OAuth-created row)
-- must still resolve — matched by the LOWER(email) unique index on users.
SELECT id, email, password_hash, full_name, email_verified, avatar_url, language_pref, google_id, created_at, updated_at, persona, notification_settings
FROM users
WHERE LOWER(email) = LOWER($1);

-- name: GetUserByGoogleID :one
SELECT id, email, password_hash, full_name, email_verified, avatar_url, language_pref, google_id, created_at, updated_at, persona, notification_settings
FROM users
WHERE google_id = $1;

-- name: CreateUser :one
INSERT INTO users (email, password_hash, full_name, google_id)
VALUES ($1, $2, $3, $4)
RETURNING id, email, password_hash, full_name, email_verified, avatar_url, language_pref, google_id, created_at, updated_at, persona, notification_settings;

-- name: UpdateUserEmailVerified :exec
UPDATE users
SET email_verified = true, updated_at = now()
WHERE id = $1;

-- name: UpdateUserPassword :exec
UPDATE users
SET password_hash = $2, updated_at = now()
WHERE id = $1;

-- name: GetUserProfile :one
-- Story 9.4 — the self-profile read (GET /api/users/me). Distinct from
-- GetUserByID so the new notification_settings column is surfaced WITHOUT
-- widening the many GetUserByID callers. password_hash is included so the
-- profile/handler layer can derive the OAuth-only explanatory state (AC7).
SELECT id, email, password_hash, full_name, email_verified, avatar_url, language_pref, notification_settings, google_id, created_at, updated_at
FROM users
WHERE id = $1;

-- name: UpdateUserProfile :one
-- Story 9.4 (AC6 / D5) — FULL-SNAPSHOT replace of the four editable profile
-- fields. The client ALWAYS sends the current full profile (an avatar-only or
-- language-only edit still carries the unchanged name/notif), so a partial PUT
-- cannot silently blank a field (Murat's clobber/self-blank bug). The service
-- requires all four present before reaching this query. RETURNING feeds the
-- response + the session-cache write.
UPDATE users
SET full_name = $2, avatar_url = $3, language_pref = $4, notification_settings = $5, updated_at = now()
WHERE id = $1
RETURNING id, email, password_hash, full_name, email_verified, avatar_url, language_pref, notification_settings, google_id, created_at, updated_at;

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

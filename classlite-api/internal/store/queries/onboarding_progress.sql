-- name: GetOnboardingProgressByUser :one
-- Story 2.1 — table has no RLS (see 20260702120100 migration comment).
-- Isolation enforced at the service layer via the user_id filter here.
-- The service converts pgx.ErrNoRows into a default-state response per AC4.
SELECT user_id, current_step, payload, updated_at
FROM onboarding_progress
WHERE user_id = $1;

-- name: GetOnboardingProgressWithPersona :one
-- Story 2.1 AC4 — single-round-trip resume: joins users.persona so GetProgress
-- returns a consistent snapshot (both users.persona and progress row observed
-- at the same MVCC snapshot; two-query variant risked cross-write races).
-- LEFT JOIN because AC4 requires the response even when no progress row exists,
-- but this query returns pgx.ErrNoRows in that case — the service maps it to
-- the AC4 default state and reads users.persona separately via
-- GetUserPersonaForDefaultState.
SELECT p.user_id, p.current_step, p.payload, p.updated_at, u.persona
FROM onboarding_progress p
LEFT JOIN users u ON u.id = p.user_id
WHERE p.user_id = $1;

-- name: UpsertOnboardingProgress :one
-- Story 2.1 — single row per user, keyed by user_id (PRIMARY KEY).
INSERT INTO onboarding_progress (user_id, current_step, payload, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (user_id) DO UPDATE
SET current_step = EXCLUDED.current_step,
    payload      = EXCLUDED.payload,
    updated_at   = now()
RETURNING user_id, current_step, payload, updated_at;

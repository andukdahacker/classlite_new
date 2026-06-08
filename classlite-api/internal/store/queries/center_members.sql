-- name: GetCenterMemberByUserAndCenter :one
SELECT user_id, center_id, role, created_at
FROM center_members
WHERE user_id = $1 AND center_id = $2;

-- name: CreateCenterMember :one
INSERT INTO center_members (user_id, center_id, role)
VALUES ($1, $2, $3)
RETURNING user_id, center_id, role, created_at;

-- name: ListCenterMembersByCenter :many
SELECT user_id, center_id, role, created_at
FROM center_members
WHERE center_id = $1
ORDER BY created_at;

-- name: UpdateCenterMemberRole :execrows
-- Story 1.6 — invite acceptance role upgrade for already-member users.
-- When AcceptInvite hits the unique-PK softening path AND the invite's
-- role differs from the current role, honor the Owner's intent and
-- promote/demote the existing row. Returns row count so the caller can
-- audit "no change" vs "upgraded".
UPDATE center_members
SET role = $3
WHERE user_id = $1 AND center_id = $2 AND role != $3;

-- name: UpsertCenterMemberWithRole :one
-- Story 1.6 — atomic upsert used by AcceptInvite. Postgres aborts the
-- transaction on a unique-violation, so a try-INSERT-then-UPDATE
-- sequence breaks the surrounding tx; ON CONFLICT does the work
-- atomically. Returns the row's role so the caller can detect a
-- role change for the audit payload.
INSERT INTO center_members (user_id, center_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, center_id) DO UPDATE
SET role = EXCLUDED.role
RETURNING user_id, center_id, role, created_at;

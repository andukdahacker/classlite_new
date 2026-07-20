-- Story 2.2 — classes queries. Full CRUD ships in Story 3.1; this file
-- carries what Spawn needs plus GetClassByID for handler tests + Story 3.1's
-- read path pre-emptive use.

-- name: CreateClass :one
INSERT INTO classes (
    id, center_id, template_id, name,
    target_band, primary_skill, session_count,
    status, teacher_id, pending_teacher_email, start_date,
    description, capacity, due_dates_enabled, end_date, color
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
RETURNING id, center_id, template_id, name, target_band, primary_skill,
          session_count, status, teacher_id, pending_teacher_email, start_date, created_at,
          description, capacity, due_dates_enabled, updated_at, end_date, color;

-- name: GetClassByID :one
-- RLS-scoped — invisible class returns pgx.ErrNoRows. Returns the full class
-- row (all Story 3.1 columns) for edit-form prefill (AC6).
SELECT id, center_id, template_id, name, target_band, primary_skill,
       session_count, status, teacher_id, pending_teacher_email, start_date, created_at,
       description, capacity, due_dates_enabled, updated_at, end_date, color
FROM classes
WHERE id = $1;

-- name: ListClasses :many
-- Owner/admin scope (AC5) — ALL center classes. RLS tenant-scopes the rows;
-- ordered by status priority (tab order: upcoming, active, paused, ended)
-- then newest-first.
SELECT id, center_id, template_id, name, target_band, primary_skill,
       session_count, status, teacher_id, pending_teacher_email, start_date, created_at,
       description, capacity, due_dates_enabled, updated_at, end_date, color
FROM classes
ORDER BY
    CASE status
        WHEN 'upcoming' THEN 0
        WHEN 'active'   THEN 1
        WHEN 'paused'   THEN 2
        WHEN 'ended'    THEN 3
        ELSE 4
    END,
    created_at DESC;

-- name: ListClassesByTeacher :many
-- Teacher scope (AC5) — ONLY classes assigned to the caller. Still runs inside
-- a SetTenantContext tx so RLS is belt-and-suspenders on tenant.
SELECT id, center_id, template_id, name, target_band, primary_skill,
       session_count, status, teacher_id, pending_teacher_email, start_date, created_at,
       description, capacity, due_dates_enabled, updated_at, end_date, color
FROM classes
WHERE teacher_id = $1
ORDER BY
    CASE status
        WHEN 'upcoming' THEN 0
        WHEN 'active'   THEN 1
        WHEN 'paused'   THEN 2
        WHEN 'ended'    THEN 3
        ELSE 4
    END,
    created_at DESC;

-- name: UpdateClass :one
-- Partial update (AC6). Absent field = unchanged via COALESCE. Nullable fields
-- CANNOT be cleared to NULL via PATCH this story — send a value or leave absent.
-- updated_at is set explicitly (the column DEFAULT fires on INSERT only).
-- teacher_id / pending_teacher_email honor classes_teacher_mutex: supplying one
-- side clears the other so the XOR CHECK always holds.
UPDATE classes
SET name              = COALESCE(sqlc.narg('name'), name),
    description       = COALESCE(sqlc.narg('description'), description),
    target_band       = COALESCE(sqlc.narg('target_band'), target_band),
    primary_skill     = COALESCE(sqlc.narg('primary_skill'), primary_skill),
    session_count     = COALESCE(sqlc.narg('session_count'), session_count),
    capacity          = COALESCE(sqlc.narg('capacity'), capacity),
    start_date        = COALESCE(sqlc.narg('start_date'), start_date),
    end_date          = COALESCE(sqlc.narg('end_date'), end_date),
    color             = COALESCE(sqlc.narg('color'), color),
    due_dates_enabled = COALESCE(sqlc.narg('due_dates_enabled'), due_dates_enabled),
    teacher_id = CASE
        WHEN sqlc.narg('teacher_id')::uuid IS NOT NULL THEN sqlc.narg('teacher_id')::uuid
        WHEN sqlc.narg('pending_teacher_email')::text IS NOT NULL THEN NULL
        ELSE teacher_id
    END,
    pending_teacher_email = CASE
        WHEN sqlc.narg('pending_teacher_email')::text IS NOT NULL THEN sqlc.narg('pending_teacher_email')::text
        WHEN sqlc.narg('teacher_id')::uuid IS NOT NULL THEN NULL
        ELSE pending_teacher_email
    END,
    updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING id, center_id, template_id, name, target_band, primary_skill,
          session_count, status, teacher_id, pending_teacher_email, start_date, created_at,
          description, capacity, due_dates_enabled, updated_at, end_date, color;

-- name: UpdateClassStatus :one
-- Compare-and-swap lifecycle transition (AC4). The WHERE binds the expected
-- current status; a 0-row result means the row moved under a concurrent
-- transition → caller returns INVALID_STATUS_TRANSITION. updated_at advanced.
UPDATE classes
SET status = sqlc.arg('new_status'), updated_at = now()
WHERE id = sqlc.arg('id') AND status = sqlc.arg('expected_status')
RETURNING id, center_id, template_id, name, target_band, primary_skill,
          session_count, status, teacher_id, pending_teacher_email, start_date, created_at,
          description, capacity, due_dates_enabled, updated_at, end_date, color;

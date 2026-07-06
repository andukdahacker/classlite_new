-- Story 2.2 — classes queries. Full CRUD ships in Story 3.1; this file
-- carries what Spawn needs plus GetClassByID for handler tests + Story 3.1's
-- read path pre-emptive use.

-- name: CreateClass :one
INSERT INTO classes (
    id, center_id, template_id, name,
    target_band, primary_skill, session_count,
    status, teacher_id, pending_teacher_email, start_date
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING id, center_id, template_id, name, target_band, primary_skill,
          session_count, status, teacher_id, pending_teacher_email, start_date, created_at;

-- name: GetClassByID :one
-- RLS-scoped — invisible class returns pgx.ErrNoRows.
SELECT id, center_id, template_id, name, target_band, primary_skill,
       session_count, status, teacher_id, pending_teacher_email, start_date, created_at
FROM classes
WHERE id = $1;

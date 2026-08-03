-- Story 5.1 — assignment management queries (AC1,5,6,11,13). RLS-scoped on
-- center_id: every query runs inside a tenant tx (store.SetTenantContext), so no
-- center predicate is written here — the row-level policies enforce isolation.
-- center_id is passed EXPLICITLY on INSERT (GO-1; the WITH CHECK policy rejects a
-- spoofed value), never derived via trigger/subquery. updated_at has no trigger —
-- every UPDATE SETs it explicitly.

-- name: CreateAssignment :one
INSERT INTO assignments (
    id, center_id, exercise_id, class_id, created_by,
    status, deadline_at, hard_deadline_at, instructions, late_penalty
)
VALUES (
    gen_random_uuid(), sqlc.arg('center_id'), sqlc.arg('exercise_id'), sqlc.arg('class_id'), sqlc.narg('created_by'),
    'open', sqlc.arg('deadline_at'), sqlc.narg('hard_deadline_at'), sqlc.narg('instructions'), sqlc.arg('late_penalty')
)
RETURNING id, center_id, exercise_id, class_id, created_by, status,
          deadline_at, hard_deadline_at, instructions, late_penalty,
          created_at, updated_at;

-- name: GetAssignmentByID :one
-- RLS-scoped; a row in another tenant returns pgx.ErrNoRows → 404.
SELECT id, center_id, exercise_id, class_id, created_by, status,
       deadline_at, hard_deadline_at, instructions, late_penalty,
       created_at, updated_at
FROM assignments
WHERE id = sqlc.arg('id');

-- name: GetAssignmentForUpdate :one
-- Row-locking read for the submit/close serialization (D10). FOR UPDATE holds the
-- assignment row for the duration of the tx so a concurrent close cannot interleave
-- with an in-flight submit (the "no submitted row under a closed assignment"
-- invariant, Murat #9).
SELECT id, center_id, exercise_id, class_id, created_by, status,
       deadline_at, hard_deadline_at, instructions, late_penalty,
       created_at, updated_at
FROM assignments
WHERE id = sqlc.arg('id')
FOR UPDATE;

-- name: ListAssignmentsByClass :many
-- Paginated (XL-2 page+pageSize → OFFSET/LIMIT computed in Go). WHERE clause is
-- byte-identical to CountAssignmentsByClass — keep them in lockstep.
SELECT id, center_id, exercise_id, class_id, created_by, status,
       deadline_at, hard_deadline_at, instructions, late_penalty,
       created_at, updated_at
FROM assignments
WHERE class_id = sqlc.arg('class_id')
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg('page_limit') OFFSET sqlc.arg('page_offset');

-- name: CountAssignmentsByClass :one
-- Total for the pagination meta. WHERE must match ListAssignmentsByClass exactly.
SELECT COUNT(*)::bigint AS total
FROM assignments
WHERE class_id = sqlc.arg('class_id');

-- name: ListStudentAssignments :many
-- Story 5.2a (AC1,2) — the student's own enrollment-scoped assignment list.
-- Rows are gated to classes the caller is ACTIVELY enrolled in (the enrollments
-- JOIN with status='active'). The caller's own submission summary is a single
-- plain LEFT JOIN (PERF-2 — one join, no per-row EXISTS/N+1). The AC2 wording
-- pins "LEFT JOIN LATERAL … LIMIT 1"; a plain LEFT JOIN is provably equivalent
-- here because submissions carries UNIQUE(assignment_id, student_id), so the
-- (assignment, caller) predicate matches AT MOST ONE row — there is nothing for a
-- LIMIT 1 to trim, and no row multiplication is possible. The plain form is used
-- because sqlc does NOT propagate LATERAL outer-join nullability (it would type
-- the NOT NULL submissions.status column as non-nullable and fail to scan the NULL
-- for a not-started assignment); a plain LEFT JOIN's right-side columns ARE typed
-- nullable, so submission_status comes back pgtype.Text (null = not started). See
-- the sibling completion-notes for the rationale. exercises is JOINed for
-- title/skill (FK-guaranteed to exist; no deleted_at filter so an
-- assigned-then-soft-deleted exercise still lists — the attempt read path reads it
-- regardless too). Center scope is RLS (tenant tx). ORDER BY deadline_at ASC
-- (due-soonest first), stable tiebreak on id. WHERE/JOIN must stay byte-identical
-- to CountStudentAssignments (minus the submission LEFT JOIN, which never filters).
SELECT a.id, a.exercise_id, a.class_id, a.status, a.deadline_at, a.hard_deadline_at,
       a.instructions, a.late_penalty, a.created_at, a.updated_at,
       e.title AS exercise_title, e.skill AS exercise_skill,
       sub.id AS submission_id, sub.status AS submission_status
FROM assignments a
JOIN enrollments en ON en.class_id = a.class_id
    AND en.student_id = sqlc.arg('student_id')
    AND en.status = 'active'
JOIN exercises e ON e.id = a.exercise_id
LEFT JOIN submissions sub ON sub.assignment_id = a.id
    AND sub.student_id = sqlc.arg('student_id')
ORDER BY a.deadline_at ASC, a.id ASC
LIMIT sqlc.arg('page_limit') OFFSET sqlc.arg('page_offset');

-- name: CountStudentAssignments :one
-- Total for the pagination meta. WHERE/JOIN must match ListStudentAssignments
-- exactly (the exercises JOIN never drops a row — FK-guaranteed — but is kept in
-- lockstep so the two never drift).
SELECT COUNT(*)::bigint AS total
FROM assignments a
JOIN enrollments en ON en.class_id = a.class_id
    AND en.student_id = sqlc.arg('student_id')
    AND en.status = 'active'
JOIN exercises e ON e.id = a.exercise_id;

-- name: UpdateAssignmentStatus :one
-- Compare-and-swap on the expected status (AC5). A lost race / no-op transition
-- matches 0 rows → pgx.ErrNoRows → service maps to 409 CONFLICT. Reopen never
-- touches deadline_at/hard_deadline_at (D11).
UPDATE assignments
SET status = sqlc.arg('new_status'),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND status = sqlc.arg('expected_status')
RETURNING id, center_id, exercise_id, class_id, created_by, status,
          deadline_at, hard_deadline_at, instructions, late_penalty,
          created_at, updated_at;

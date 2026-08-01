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

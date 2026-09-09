-- Story 7.3a — enrollment_history queries. The immutable audit trail written in
-- the SAME tx as each enrollment state change (R17). center_id comes straight
-- from tc.CenterID on insert (GO-1); the FORCE-RLS INSERT policy's WITH CHECK
-- rejects a spoofed value and the REVOKE UPDATE/DELETE/TRUNCATE makes the table
-- unconditionally append-only. Reads are RLS tenant-scoped.

-- name: InsertEnrollmentHistory :one
-- Appends one history row for an Add/Transfer/Withdraw. performed_at is
-- clock-injected by the service (AC7) so tests are deterministic; performed_by is
-- nullable (NULL for system/genesis rows).
INSERT INTO enrollment_history
    (id, center_id, student_id, action, from_class_id, to_class_id,
     effective_date, note, performed_by, performed_at)
VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, center_id, student_id, action, from_class_id, to_class_id,
          effective_date, note, performed_by, performed_at, created_at;

-- name: ListEnrollmentHistoryPaged :many
-- Center-wide history, newest-first, PAGINATED (XL-2) — the GET
-- /api/enrollments/history read. Denormalized with the student name, source/target
-- class names, and performer name (NULL performer → 7-3b renders "System"). Optional
-- student_id / class_id filters (class_id matches either endpoint of a transfer).
-- performed_at DESC + id DESC is a page-stable order. RLS tenant-scopes every join.
SELECT eh.id, eh.center_id, eh.student_id, eh.action,
       eh.from_class_id, eh.to_class_id, eh.effective_date, eh.note,
       eh.performed_by, eh.performed_at, eh.created_at,
       su.full_name AS student_name,
       cf.name       AS from_class_name,
       ct.name       AS to_class_name,
       pu.full_name  AS performer_name
FROM enrollment_history eh
JOIN users su ON su.id = eh.student_id
LEFT JOIN classes cf ON cf.id = eh.from_class_id
LEFT JOIN classes ct ON ct.id = eh.to_class_id
LEFT JOIN users pu ON pu.id = eh.performed_by
WHERE (sqlc.narg('student_id')::uuid IS NULL OR eh.student_id = sqlc.narg('student_id')::uuid)
  AND (sqlc.narg('class_id')::uuid IS NULL
       OR eh.from_class_id = sqlc.narg('class_id')::uuid
       OR eh.to_class_id = sqlc.narg('class_id')::uuid)
ORDER BY eh.performed_at DESC, eh.id DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: CountEnrollmentHistory :one
-- meta.total for the paginated history read. Same filters as
-- ListEnrollmentHistoryPaged, RLS tenant-scoped.
SELECT count(*)::bigint AS total
FROM enrollment_history eh
WHERE (sqlc.narg('student_id')::uuid IS NULL OR eh.student_id = sqlc.narg('student_id')::uuid)
  AND (sqlc.narg('class_id')::uuid IS NULL
       OR eh.from_class_id = sqlc.narg('class_id')::uuid
       OR eh.to_class_id = sqlc.narg('class_id')::uuid);

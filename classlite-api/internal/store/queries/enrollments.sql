-- Story 3.4.5 — enrollments queries. This story only ever WRITES status='active'
-- (the Add case); withdraw/transfer + enrollment_history stay in Story 7.3 which
-- CONSUMES this file. center_id is set DIRECTLY from tc.CenterID on insert (never
-- a trigger/subquery — GO-1); RLS handles tenant-scoping on every read.

-- name: CreateEnrollment :one
-- Links an existing student member to a class. center_id comes straight from
-- tc.CenterID (GO-1); the RLS INSERT policy's WITH CHECK rejects a spoofed value.
-- The partial-unique uq_enrollments_active is the suspenders behind the service's
-- ALREADY_ENROLLED pre-check.
INSERT INTO enrollments (id, center_id, student_id, class_id, status)
VALUES ($1, $2, $3, $4, 'active')
RETURNING id, center_id, student_id, class_id, enrolled_at, withdrawn_at,
          status, created_at, updated_at;

-- name: CreateEnrollmentIfNotActive :one
-- Story 2.7 bulk import — idempotent enrollment insert. ON CONFLICT DO NOTHING
-- against the partial-unique uq_enrollments_active (class_id, student_id) WHERE
-- status='active' makes a re-run a no-op: 0 rows returned (pgx.ErrNoRows) means
-- an active enrollment already exists → counted done, NO 23505 (a unique
-- violation would abort the surrounding savepoint and could not be continued in).
-- Distinct from CreateEnrollment, whose 23505→ALREADY_ENROLLED the 3.4.5 Add
-- endpoint depends on — do NOT fold them.
INSERT INTO enrollments (id, center_id, student_id, class_id, status)
VALUES ($1, $2, $3, $4, 'active')
ON CONFLICT (class_id, student_id) WHERE status = 'active' DO NOTHING
RETURNING id, center_id, student_id, class_id, enrolled_at, withdrawn_at,
          status, created_at, updated_at;

-- name: ListEnrolledStudentsByClass :many
-- Active roster for one class (AC3), FULL (unpaginated). JOIN users for the
-- display name/email the downstream consumers (3.5b attendance — which needs the
-- WHOLE active set to validate bulk targets) need. RLS tenant-scopes the
-- enrollments rows; the service enforces teacher-scope on the parent class before
-- calling this. ORDER BY full_name for a stable roster.
SELECT e.id, e.center_id, e.student_id, e.class_id, e.enrolled_at, e.withdrawn_at,
       e.status, e.created_at, e.updated_at,
       u.full_name AS student_name, u.email AS student_email
FROM enrollments e
JOIN users u ON u.id = e.student_id
WHERE e.class_id = $1 AND e.status = 'active'
ORDER BY u.full_name ASC;

-- name: ListEnrolledStudentsByClassPaged :many
-- Active roster for one class, PAGINATED (CR-3-4-5-3, Story 7.2a D10) — the
-- GET /api/classes/{classId}/enrollments read path. Same shape/order as the full
-- roster (+ e.id for a page-stable tiebreak) with LIMIT/OFFSET (XL-2). Attendance
-- keeps the full ListEnrolledStudentsByClass; only the HTTP list paginates.
SELECT e.id, e.center_id, e.student_id, e.class_id, e.enrolled_at, e.withdrawn_at,
       e.status, e.created_at, e.updated_at,
       u.full_name AS student_name, u.email AS student_email
FROM enrollments e
JOIN users u ON u.id = e.student_id
WHERE e.class_id = sqlc.arg('class_id') AND e.status = 'active'
ORDER BY u.full_name ASC, e.id ASC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: CountEnrolledStudentsByClass :one
-- meta.total for the paginated class roster (Story 7.2a D10). Same filter as
-- ListEnrolledStudentsByClassPaged, RLS tenant-scoped.
SELECT count(*)::bigint AS total
FROM enrollments e
WHERE e.class_id = sqlc.arg('class_id') AND e.status = 'active';

-- name: GetActiveEnrollment :one
-- ALREADY_ENROLLED pre-check (belt; uq_enrollments_active is the suspenders).
-- Returns the id of an existing active enrollment, or pgx.ErrNoRows if none.
SELECT id FROM enrollments
WHERE class_id = $1 AND student_id = $2 AND status = 'active';

-- name: IsStudentMemberOfCenter :one
-- NOT_A_STUDENT_MEMBER validation (AC2). True iff the user is a `student`
-- center-member of this center. RLS does not cover center_members reads here, so
-- the explicit center_id predicate is the scope guard.
SELECT EXISTS (
    SELECT 1 FROM center_members
    WHERE center_id = $1 AND user_id = $2 AND role = 'student'
) AS is_student_member;

-- Story 7.3a — the withdraw/transfer transitions + the s43 needs-attention reads.

-- name: WithdrawEnrollment :one
-- AC4 — set the student's ACTIVE enrollment in a class to 'withdrawn'. withdrawn_at
-- is the effective date (coupling CHECK requires it non-null for a terminal status);
-- updated_at is bumped explicitly (the table's default fires on INSERT only). Matched
-- by (class_id, student_id, status='active') — 0 rows (pgx.ErrNoRows) means the
-- student holds no active enrollment there → the service maps NOT_ENROLLED_IN_SOURCE.
UPDATE enrollments
SET status = 'withdrawn', withdrawn_at = $3, updated_at = now()
WHERE class_id = $1 AND student_id = $2 AND status = 'active'
RETURNING id, center_id, student_id, class_id, enrolled_at, withdrawn_at,
          status, created_at, updated_at;

-- name: TransferEnrollmentSource :one
-- AC3 — set the student's ACTIVE enrollment in the SOURCE class to 'transferred'
-- (the target is created via CreateEnrollment, in the same tx). Same 0-rows →
-- NOT_ENROLLED_IN_SOURCE contract as WithdrawEnrollment. uq_enrollments_active
-- permits the transferred row to coexist with the new active target row.
UPDATE enrollments
SET status = 'transferred', withdrawn_at = $3, updated_at = now()
WHERE class_id = $1 AND student_id = $2 AND status = 'active'
RETURNING id, center_id, student_id, class_id, enrolled_at, withdrawn_at,
          status, created_at, updated_at;

-- name: ListUnassignedStudents :many
-- AC12 (D4) — `student` center-members with ZERO active enrollments. RLS
-- tenant-scopes the enrollments NOT EXISTS; center_members carries an explicit
-- center_id (belt) matching IsStudentMemberOfCenter. Ordered by name for the s43
-- zone. Paginated (XL-2) — a large center never returns an unbounded payload.
SELECT u.id AS student_id, u.full_name AS student_name, u.email AS student_email
FROM center_members cm
JOIN users u ON u.id = cm.user_id
WHERE cm.center_id = $1 AND cm.role = 'student'
  AND NOT EXISTS (
      SELECT 1 FROM enrollments e
      WHERE e.student_id = cm.user_id AND e.status = 'active'
  )
ORDER BY u.full_name ASC
LIMIT $2 OFFSET $3;

-- name: CountUnassignedStudents :one
-- AC12 (D4) — total count for the unassigned zone's pagination meta. Predicate
-- MUST mirror ListUnassignedStudents exactly.
SELECT count(*)
FROM center_members cm
WHERE cm.center_id = $1 AND cm.role = 'student'
  AND NOT EXISTS (
      SELECT 1 FROM enrollments e
      WHERE e.student_id = cm.user_id AND e.status = 'active'
  );

-- name: ListOverCapacityClasses :many
-- AC12 (D4) — classes whose ACTIVE-enrollment count exceeds capacity (only where
-- capacity IS NOT NULL). Aggregated in SQL, never an N+1 loop (PERF-2). classes +
-- enrollments are both RLS tenant-scoped. Paginated (XL-2).
SELECT c.id AS class_id, c.name AS class_name, c.capacity,
       count(e.id) FILTER (WHERE e.status = 'active')::bigint AS active_count
FROM classes c
LEFT JOIN enrollments e ON e.class_id = c.id
WHERE c.capacity IS NOT NULL
GROUP BY c.id, c.name, c.capacity
HAVING count(e.id) FILTER (WHERE e.status = 'active') > c.capacity
ORDER BY c.name ASC
LIMIT $1 OFFSET $2;

-- name: CountOverCapacityClasses :one
-- AC12 (D4) — total count of over-capacity classes for the zone's pagination meta.
-- Predicate MUST mirror ListOverCapacityClasses; wrap the HAVING aggregate in a
-- subquery so count(*) counts qualifying classes, not grouped rows.
SELECT count(*) FROM (
    SELECT c.id
    FROM classes c
    LEFT JOIN enrollments e ON e.class_id = c.id
    WHERE c.capacity IS NOT NULL
    GROUP BY c.id, c.capacity
    HAVING count(e.id) FILTER (WHERE e.status = 'active') > c.capacity
) sub;

-- name: GetEnrollmentClass :one
-- Resolve a class for an enrollment action in ONE read: existence/RLS (ErrNoRows →
-- 404 CLASS_NOT_FOUND), status (D3 enrollable guard), name (email body), and the
-- teacher recipient (AC14 notify). A class with pending_teacher_email (no assigned
-- teacher) has teacher_id NULL → teacher_email NULL → the service skips the teacher
-- email. RLS tenant-scopes the class read; users is global.
SELECT c.id, c.name AS class_name, c.status AS class_status,
       c.teacher_id, c.pending_teacher_email,
       u.full_name AS teacher_name, u.email AS teacher_email
FROM classes c
LEFT JOIN users u ON u.id = c.teacher_id
WHERE c.id = $1;

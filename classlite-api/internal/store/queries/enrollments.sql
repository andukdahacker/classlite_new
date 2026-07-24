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

-- name: ListEnrolledStudentsByClass :many
-- Active roster for one class (AC3). JOIN users for the display name/email the
-- downstream consumers (3.5b attendance, 7.2 teacher roster) need. RLS
-- tenant-scopes the enrollments rows; the service enforces teacher-scope on the
-- parent class before calling this. ORDER BY full_name for a stable roster.
SELECT e.id, e.center_id, e.student_id, e.class_id, e.enrolled_at, e.withdrawn_at,
       e.status, e.created_at, e.updated_at,
       u.full_name AS student_name, u.email AS student_email
FROM enrollments e
JOIN users u ON u.id = e.student_id
WHERE e.class_id = $1 AND e.status = 'active'
ORDER BY u.full_name ASC;

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

-- Story 3.5b — attendance queries. RLS scopes center_id on every statement.
-- center_id is set DIRECTLY from tc.CenterID on upsert (never a trigger) so the
-- INSERT satisfies the WITH CHECK policy. There is NO status/time gate —
-- attendance is recordable on past AND cancelled sessions (D14), mirroring the
-- session-content sibling.

-- name: ListAttendanceRosterBySession :many
-- The per-session roster (D4): every ACTIVE enrollment of the session's class,
-- LEFT JOINed to any recorded attendance row. status/marked_at are NULL for a
-- student not yet marked (an unmarked toggle in the UI). class_id is derived from
-- the session by the service (GetSessionByID) — never trusted from the client.
-- RLS tenant-scopes both the enrollments and the attendance rows; the service
-- enforces teacher-scope on the parent session before calling this.
SELECT e.student_id,
       u.full_name  AS student_name,
       u.email      AS student_email,
       a.status     AS status,
       a.updated_at AS marked_at
FROM enrollments e
JOIN users u ON u.id = e.student_id
LEFT JOIN attendance a
       ON a.session_id = sqlc.arg('session_id')
      AND a.student_id = e.student_id
WHERE e.class_id = sqlc.arg('class_id') AND e.status = 'active'
ORDER BY u.full_name ASC;

-- name: UpsertAttendance :one
-- Record one student's attendance (AC6). INSERT on first mark, UPDATE on re-mark
-- of the same (session, student) via ON CONFLICT on uq_attendance_session_student.
-- updated_at is set EXPLICITLY in DO UPDATE — ON CONFLICT does not re-fire the
-- column DEFAULT, so without this a re-mark would leave a stale updated_at.
INSERT INTO attendance (id, center_id, session_id, student_id, status, marked_by)
VALUES (gen_random_uuid(), sqlc.arg('center_id'), sqlc.arg('session_id'),
        sqlc.arg('student_id'), sqlc.arg('status'), sqlc.arg('marked_by'))
ON CONFLICT (session_id, student_id) DO UPDATE
    SET status     = EXCLUDED.status,
        marked_by  = EXCLUDED.marked_by,
        updated_at = now()
RETURNING id, center_id, session_id, student_id, status, marked_by, created_at, updated_at;

-- name: GetAttendanceEntryForStudent :one
-- Read back one roster entry (student display fields + current attendance) after
-- a single set, so the PUT response is a full AttendanceRosterEntry. Scoped to an
-- ACTIVE enrollment of the class; pgx.ErrNoRows means the student is not enrolled.
SELECT e.student_id,
       u.full_name  AS student_name,
       u.email      AS student_email,
       a.status     AS status,
       a.updated_at AS marked_at
FROM enrollments e
JOIN users u ON u.id = e.student_id
LEFT JOIN attendance a
       ON a.session_id = sqlc.arg('session_id')
      AND a.student_id = e.student_id
WHERE e.class_id = sqlc.arg('class_id')
  AND e.student_id = sqlc.arg('student_id')
  AND e.status = 'active';

-- Story 8.1a — dashboard aggregates (D6). Reads only; every window binds the
-- injected clock via @now / pre-computed @*_start / @*_end args (D8 — day/week
-- boundaries are bucketed in centers.timezone by the service, never SQL now()).
-- Every ≤N/top-N rail carries a `, id` tiebreak so LIMIT slice membership is
-- deterministic (AC11, the 7-2a released_at lesson). Set-based only — no per-row
-- fan-out (PERF-2). RLS (SET LOCAL app.current_tenant_id) tenant-scopes every
-- table underneath; the explicit center_id predicates also make the tenant index
-- usable (AC14, no Seq Scan).

-- name: GetCenterTimezone :one
-- The IANA tz string the service uses to bucket day/week/"today" boundaries (D8).
-- centers is a global (non-RLS) table; the id is the caller's own center.
SELECT timezone FROM centers WHERE id = sqlc.arg('center_id');

-- name: CountGradingBacklog :one
-- Teacher/center grading backlog: submitted|ai_processing submissions with no
-- released grade. teacher_id narg NULL ⇒ center-wide (owner); set ⇒ own classes.
SELECT count(*)::bigint
FROM submissions sub
JOIN assignments a ON a.id = sub.assignment_id
JOIN classes c ON c.id = a.class_id
LEFT JOIN current_grades cg ON cg.submission_id = sub.id
WHERE sub.center_id = sqlc.arg('center_id')
  AND sub.status IN ('submitted', 'ai_processing')
  AND (cg.id IS NULL OR cg.released_at IS NULL)
  AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id')::uuid);

-- name: ListGradingBacklog :many
-- Top-N of the grading backlog. overdue = past hard_deadline_at (or deadline_at
-- when no hard deadline) vs the bound @now. Ordered oldest-submitted first with an
-- id tiebreak (mirrors ListGradingQueue's total order).
SELECT sub.id AS submission_id,
       u.full_name AS student_name,
       e.title AS assignment_title,
       c.name AS class_name,
       (COALESCE(a.hard_deadline_at, a.deadline_at) < sqlc.arg('now'))::boolean AS overdue,
       sub.submitted_at
FROM submissions sub
JOIN assignments a ON a.id = sub.assignment_id
JOIN classes c ON c.id = a.class_id
JOIN exercises e ON e.id = a.exercise_id
JOIN users u ON u.id = sub.student_id
LEFT JOIN current_grades cg ON cg.submission_id = sub.id
WHERE sub.center_id = sqlc.arg('center_id')
  AND sub.status IN ('submitted', 'ai_processing')
  AND (cg.id IS NULL OR cg.released_at IS NULL)
  AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id')::uuid)
ORDER BY sub.submitted_at ASC NULLS LAST, sub.id ASC
LIMIT sqlc.arg('item_limit');

-- name: ListStudentRecentFeedback :many
-- The student's most-recent RELEASED grades (own submissions). released_at DESC
-- with an id tiebreak. current_grades is a security_invoker view over the RLS'd
-- grades table (WF-2 precedent).
SELECT cg.submission_id,
       e.title AS assignment_title,
       cg.overall_band,
       cg.released_at
FROM current_grades cg
JOIN submissions sub ON sub.id = cg.submission_id
JOIN assignments a ON a.id = sub.assignment_id
JOIN exercises e ON e.id = a.exercise_id
WHERE cg.center_id = sqlc.arg('center_id')
  AND sub.student_id = sqlc.arg('student_id')
  AND cg.released_at IS NOT NULL
ORDER BY cg.released_at DESC, cg.id DESC
LIMIT sqlc.arg('item_limit');

-- name: GetOwnerPulse :one
-- Center pulse counts (D8 day/week boundaries pre-bucketed in centers.timezone by
-- the service and passed as UTC instants). staff_active_today counts admin/teacher
-- members with a refresh-token created today (login/rotation proxy — 7.1a idiom).
SELECT
  (SELECT count(*) FROM classes c
     WHERE c.center_id = sqlc.arg('center_id') AND c.status = 'active')::bigint AS active_classes,
  (SELECT count(DISTINCT e.student_id) FROM enrollments e
     WHERE e.center_id = sqlc.arg('center_id') AND e.status = 'active')::bigint AS students_enrolled,
  (SELECT count(*) FROM center_members cm
     WHERE cm.center_id = sqlc.arg('center_id') AND cm.role IN ('admin', 'teacher')
       AND EXISTS (SELECT 1 FROM refresh_tokens rt
                     WHERE rt.user_id = cm.user_id
                       AND rt.created_at >= sqlc.arg('day_start')
                       AND rt.created_at < sqlc.arg('day_end')))::bigint AS staff_active_today,
  (SELECT count(*) FROM sessions s
     WHERE s.center_id = sqlc.arg('center_id')
       AND s.starts_at >= sqlc.arg('week_start') AND s.starts_at < sqlc.arg('week_end'))::bigint AS sessions_this_week,
  (SELECT count(*) FROM sessions s
     WHERE s.center_id = sqlc.arg('center_id')
       AND s.starts_at >= sqlc.arg('day_start') AND s.starts_at < sqlc.arg('day_end'))::bigint AS sessions_today;

-- name: ListTodaySessionsForCenter :many
-- The center's sessions today ([day_start, day_end) in centers.timezone), enriched
-- with teacherName + active enrolledCount for the s48 "Today across the center" +
-- "live now" derivation (AC6). starts_at ASC with an id tiebreak.
SELECT s.id AS session_id,
       s.class_id,
       c.name AS class_name,
       c.color AS class_color,
       s.topic,
       s.starts_at,
       s.ends_at,
       s.status,
       tu.full_name AS teacher_name,
       (SELECT count(*) FROM enrollments e
          WHERE e.class_id = s.class_id AND e.status = 'active')::bigint AS enrolled_count
FROM sessions s
JOIN classes c ON c.id = s.class_id
LEFT JOIN users tu ON tu.id = c.teacher_id
WHERE s.center_id = sqlc.arg('center_id')
  AND s.starts_at >= sqlc.arg('day_start') AND s.starts_at < sqlc.arg('day_end')
ORDER BY s.starts_at ASC, s.id ASC;

-- name: CountPendingInvites :one
-- Un-accepted, un-expired invites for the center (D6). expires_at > @now.
SELECT count(*)::bigint
FROM invites i
WHERE i.center_id = sqlc.arg('center_id')
  AND i.accepted_at IS NULL
  AND i.expires_at > sqlc.arg('now');

-- name: ListStudentDueSoon :many
-- Student dueSoon rail (AC9) — the student's OPEN assignments only, soonest deadline
-- first, gated to actively-enrolled classes. status='open' is filtered HERE in SQL,
-- not in Go over a capped scan: the reused ListStudentAssignments returns ALL
-- statuses ordered deadline ASC, so a fixed LIMIT+Go-side open filter silently hid a
-- student's upcoming open work behind older closed assignments (closed rows have the
-- earliest deadlines and consumed the scan budget). Overdue-but-open assignments
-- surface first (earliest deadline) as the most urgent — no future-only lower bound.
-- Explicit center_id predicate keeps the tenant index usable (AC14). id tiebreak (AC11).
SELECT a.id, a.deadline_at,
       a.class_id, cls.name AS class_name,
       e.title AS exercise_title, e.skill AS exercise_skill,
       sub.id AS submission_id, sub.status AS submission_status
FROM assignments a
JOIN enrollments en ON en.class_id = a.class_id
    AND en.student_id = sqlc.arg('student_id')
    AND en.status = 'active'
JOIN classes cls ON cls.id = a.class_id
JOIN exercises e ON e.id = a.exercise_id
LEFT JOIN submissions sub ON sub.assignment_id = a.id
    AND sub.student_id = sqlc.arg('student_id')
WHERE a.center_id = sqlc.arg('center_id')
  AND a.status = 'open'
ORDER BY a.deadline_at ASC, a.id ASC
LIMIT sqlc.arg('item_limit');

-- name: ListAtRiskPendingCounts :many
-- Pending-assignment count per student for the at-risk rail's ≤5 shown items (D13
-- `pendingCount`). Mirrors GetStudentSubmissionStats.pending_count EXACTLY: an
-- actively-enrolled assignment with NO valid submission (status NOT IN
-- submitted/ai_processing/graded) and a future deadline. Set-based over the id
-- array — ONE query, never an N+1 (PERF-2). Explicit center_id keeps the tenant
-- index usable (AC14). RLS tenant-scopes assignments/enrollments/submissions.
SELECT en.student_id,
       count(*) FILTER (
         WHERE NOT (sub.id IS NOT NULL AND sub.status IN ('submitted', 'ai_processing', 'graded'))
           AND a.deadline_at > sqlc.arg('now')
       )::bigint AS pending_count
FROM assignments a
JOIN enrollments en ON en.class_id = a.class_id
    AND en.status = 'active'
    AND en.student_id = ANY(sqlc.arg('student_ids')::uuid[])
LEFT JOIN submissions sub ON sub.assignment_id = a.id AND sub.student_id = en.student_id
WHERE a.center_id = sqlc.arg('center_id')
GROUP BY en.student_id;

-- name: ListClassNamesByIDs :many
-- Class id → name for the dashboard rails that carry a classId but need a label
-- (D13 question-rail `className`). Set-based over the ≤5 ids — ONE query (PERF-2).
-- Explicit center_id keeps the tenant index usable (AC14); classes is RLS-scoped.
SELECT c.id AS class_id, c.name AS class_name
FROM classes c
WHERE c.center_id = sqlc.arg('center_id')
  AND c.id = ANY(sqlc.arg('class_ids')::uuid[]);

-- name: ListStudentUpcomingSessions :many
-- Sessions for the student's actively-enrolled classes in [from_ts, to_ts) (a
-- rolling window relative to @now — TZ-agnostic, D8). starts_at ASC + id tiebreak.
SELECT s.id AS session_id,
       s.class_id,
       c.name AS class_name,
       c.color AS class_color,
       s.topic,
       s.starts_at,
       s.ends_at,
       s.status
FROM sessions s
JOIN classes c ON c.id = s.class_id
JOIN enrollments e ON e.class_id = s.class_id
  AND e.student_id = sqlc.arg('student_id') AND e.status = 'active'
WHERE s.center_id = sqlc.arg('center_id')
  AND s.starts_at >= sqlc.arg('from_ts') AND s.starts_at < sqlc.arg('to_ts')
ORDER BY s.starts_at ASC, s.id ASC;

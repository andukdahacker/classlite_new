-- Story 5.1 — submission lifecycle queries (AC7,9,11,12,14,19). RLS-scoped on
-- center_id (tenant tx). center_id passed EXPLICITLY on INSERT (GO-1). started_at,
-- submitted_at, and updated_at are supplied by the injected clock.Clock (not DB
-- now()) so deadline/time-limit/late math is deterministic under test. The service
-- permits ONLY in_progress → submitted; ai_processing/graded are provisioned but
-- unreachable here (AC14). updated_at has no trigger — every UPDATE SETs it.

-- name: GetSubmissionByAssignmentStudent :one
-- Idempotency probe for start/resume (AC7). RLS + the UNIQUE(assignment_id,
-- student_id) mean at most one row. pgx.ErrNoRows → no attempt yet.
SELECT id, center_id, assignment_id, student_id, status, content, schema_version,
       is_late, applied_penalty, started_at, submitted_at, created_at, updated_at
FROM submissions
WHERE assignment_id = sqlc.arg('assignment_id')
  AND student_id = sqlc.arg('student_id');

-- name: GetSubmissionByID :one
-- RLS-scoped; a row in another tenant returns pgx.ErrNoRows → 404.
SELECT id, center_id, assignment_id, student_id, status, content, schema_version,
       is_late, applied_penalty, started_at, submitted_at, created_at, updated_at
FROM submissions
WHERE id = sqlc.arg('id');

-- name: StartSubmission :one
-- Create a fresh in_progress attempt (AC7). started_at is the server clock value,
-- set once and never reset on resume. If a concurrent double-start races, the
-- UNIQUE(assignment_id, student_id) constraint raises 23505 → the service falls
-- back to the resume path (exactly one row survives, Murat #4).
INSERT INTO submissions (
    id, center_id, assignment_id, student_id,
    status, content, schema_version, started_at, created_at, updated_at
)
VALUES (
    gen_random_uuid(), sqlc.arg('center_id'), sqlc.arg('assignment_id'), sqlc.arg('student_id'),
    'in_progress', sqlc.arg('content'), sqlc.arg('schema_version'),
    sqlc.arg('started_at'), sqlc.arg('started_at'), sqlc.arg('started_at')
)
RETURNING id, center_id, assignment_id, student_id, status, content, schema_version,
          is_late, applied_penalty, started_at, submitted_at, created_at, updated_at;

-- name: SaveSubmissionProgress :one
-- DB-guarded save (AC9): WHERE status='in_progress'. 0 rows (terminal/absent) →
-- pgx.ErrNoRows → 409 SUBMISSION_NOT_EDITABLE. The write is a plain content
-- replace; the time-limit gate (AC10) is enforced in the service before this runs.
-- student_id is guarded here too (self-defending SQL, not only the service check).
UPDATE submissions
SET content = sqlc.arg('content'),
    schema_version = sqlc.arg('schema_version'),
    updated_at = sqlc.arg('updated_at')
WHERE id = sqlc.arg('id')
  AND student_id = sqlc.arg('student_id')
  AND status = 'in_progress'
RETURNING id, center_id, assignment_id, student_id, status, content, schema_version,
          is_late, applied_penalty, started_at, submitted_at, created_at, updated_at;

-- name: SubmitSubmission :one
-- Atomic submit (AC11,12). A SINGLE guarded UPDATE flips status, stamps
-- submitted_at (server clock), computes is_late = submitted_at > deadline_at
-- (STRICT — exactly-at-deadline is not late), and snapshots the POINT-IN-TIME late
-- penalty from the assignment row read in the same statement (a later penalty edit
-- cannot move this value). WHERE status='in_progress' → 0 rows → 409
-- SUBMISSION_NOT_EDITABLE. Status + timestamp + late + snapshot land together so
-- Epic 6's immutability trigger drops in additively (Winston #5).
UPDATE submissions AS s
SET status = 'submitted',
    submitted_at = sqlc.arg('submitted_at'),
    is_late = (sqlc.arg('submitted_at') > a.deadline_at),
    applied_penalty = CASE WHEN sqlc.arg('submitted_at') > a.deadline_at
                           THEN a.late_penalty ELSE 0 END,
    updated_at = sqlc.arg('submitted_at')
FROM assignments AS a
WHERE s.id = sqlc.arg('id')
  AND s.student_id = sqlc.arg('student_id')
  AND s.status = 'in_progress'
  AND a.id = s.assignment_id
RETURNING s.id, s.center_id, s.assignment_id, s.student_id, s.status, s.content,
          s.schema_version, s.is_late, s.applied_penalty, s.started_at,
          s.submitted_at, s.created_at, s.updated_at;

-- name: LockSubmissionForGrading :one
-- Story 6.1 (AC4,6 / B3). Row-lock the submission for the grade / revise write
-- path. FOR UPDATE serializes concurrent grade attempts on the SAME submission so
-- the already-graded check (grade) and the MAX(version)+1 computation (revise)
-- happen under the lock, not as a TOCTOU pre-check. RLS-scoped; other-tenant →
-- pgx.ErrNoRows → 404.
SELECT id, center_id, assignment_id, student_id, status, content, schema_version,
       is_late, applied_penalty, started_at, submitted_at, created_at, updated_at
FROM submissions
WHERE id = sqlc.arg('id')
FOR UPDATE;

-- name: GradeSubmission :one
-- Story 6.1 (AC4). Guarded submitted → graded flip, run under the row lock. WHERE
-- status='submitted' → 0 rows when the submission was already graded (or is not
-- yet submitted) → the service maps ErrNoRows to 409 SUBMISSION_ALREADY_GRADED, so
-- the losing writer commits ZERO side effects. The immutability trigger
-- (submission_immutable_after_release) additionally RAISEs on any UPDATE of an
-- already-graded row — belt and braces. Revise (AC6) does NOT call this: the
-- submission stays 'graded' and would trip the trigger; the current version lives
-- in the current_grades view, never on the submission (D1).
UPDATE submissions
SET status = 'graded',
    updated_at = sqlc.arg('updated_at')
WHERE id = sqlc.arg('id')
  AND status = 'submitted'
RETURNING id, center_id, assignment_id, student_id, status, content, schema_version,
          is_late, applied_penalty, started_at, submitted_at, created_at, updated_at;

-- name: CountTeacherQueue :one
-- Story 10.1c — the teacher inbox work-queue count. Reuses the 8-1a dashboard
-- grading-backlog shape (submitted|ai_processing submissions with no RELEASED grade),
-- but teacher_id is a REQUIRED arg bound to the caller (Ducdo Q4 — teacher-scoped-only,
-- never the center-wide narg). RLS tenant-scopes every table; the service-layer
-- teacher_id predicate is what isolates two teachers in the SAME center (the 7-2a
-- class). late_only (Ducdo Q3) filters on the is_late snapshot so the filtered total
-- stays paginated honestly. See _bmad-output/implementation-artifacts/10-1c-teacher-work-queue.md.
SELECT count(*)::bigint
FROM submissions sub
JOIN assignments a ON a.id = sub.assignment_id
JOIN classes c ON c.id = a.class_id
LEFT JOIN current_grades cg ON cg.submission_id = sub.id
WHERE sub.center_id = sqlc.arg('center_id')
  AND sub.status IN ('submitted', 'ai_processing')
  AND (cg.id IS NULL OR cg.released_at IS NULL)
  AND c.teacher_id = sqlc.arg('teacher_id')
  AND (NOT sqlc.arg('late_only')::bool OR sub.is_late);

-- name: ListTeacherQueue :many
-- Story 10.1c — one paginated page of the teacher inbox work-queue. Clone of the
-- 8-1a dashboard ListGradingBacklog body + {is_late, class_id, assignment_id ids for
-- the grading deep-link, LIMIT/OFFSET, late_only}. overdue is a LIVE computation vs
-- the injected @now (distinct from the is_late submit-time snapshot, DD6). teacher_id
-- REQUIRED (Ducdo Q4). Ordered NEWEST-submitted-first with the id tiebreak: the FE
-- inbox is a newest-first merged feed that only ever fetches page 1 at a bounded cap
-- (INBOX_QUEUE_FETCH_SIZE), so when the backlog exceeds the cap DESC fetches exactly
-- the rows that surface at the top of the feed — oldest-first would fetch the rows that
-- the merge-sort then discards, silently dropping the newest ungraded (code-review
-- 10-1c). id DESC keeps LIMIT slice membership deterministic under pagination.
SELECT sub.id AS submission_id,
       u.full_name AS student_name,
       e.title AS assignment_title,
       c.name AS class_name,
       sub.is_late,
       (COALESCE(a.hard_deadline_at, a.deadline_at) < sqlc.arg('now'))::boolean AS overdue,
       sub.submitted_at,
       c.id AS class_id,
       a.id AS assignment_id
FROM submissions sub
JOIN assignments a ON a.id = sub.assignment_id
JOIN classes c ON c.id = a.class_id
JOIN exercises e ON e.id = a.exercise_id
JOIN users u ON u.id = sub.student_id
LEFT JOIN current_grades cg ON cg.submission_id = sub.id
WHERE sub.center_id = sqlc.arg('center_id')
  AND sub.status IN ('submitted', 'ai_processing')
  AND (cg.id IS NULL OR cg.released_at IS NULL)
  AND c.teacher_id = sqlc.arg('teacher_id')
  AND (NOT sqlc.arg('late_only')::bool OR sub.is_late)
ORDER BY sub.submitted_at DESC NULLS LAST, sub.id DESC
LIMIT sqlc.arg('lim') OFFSET sqlc.arg('off');

-- name: ListGradingQueue :many
-- Story 6.1 (AC17). Teacher grading queue for one assignment: every
-- non-in_progress submission (submitted / ai_processing / graded) with the
-- student's display name and current release state. Ordered submitted_at ASC
-- (oldest waiting first) — the FE walks this list with prev/next. RLS
-- tenant-scopes; the assignment predicate + teacher-of-class authz are enforced in
-- the service before this runs. LEFT JOIN current_grades is plain (not LATERAL):
-- the view is one row per submission, so no row multiplication is possible.
SELECT su.id AS submission_id, su.student_id, su.status, su.submitted_at, su.is_late,
       u.full_name AS student_name,
       (cg.released_at IS NOT NULL)::boolean AS released,
       cg.overall_band AS overall_band
FROM submissions su
JOIN users u ON u.id = su.student_id
LEFT JOIN current_grades cg ON cg.submission_id = su.id
WHERE su.assignment_id = sqlc.arg('assignment_id')
  AND su.status <> 'in_progress'
ORDER BY su.submitted_at ASC NULLS LAST, su.id ASC;

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

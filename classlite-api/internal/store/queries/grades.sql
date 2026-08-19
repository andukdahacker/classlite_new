-- Story 6.1 — grades ledger queries (AC1,4,6,8,10,17). Append-only: the ONLY
-- write is InsertGrade (a revision is a NEW row, version = N+1; the table has no
-- UPDATE/DELETE grant — see 20260818120000_create_grades). All reads run inside a
-- tenant tx (store.SetTenantContext); RLS enforces center isolation, so no
-- center_id predicate is written here. graded_by/center_id are passed EXPLICITLY
-- on INSERT (GO-1; the WITH CHECK policy rejects a spoofed center_id).

-- name: InsertGrade :one
-- Append a grade row. version = 1 for the initial grade (AC4), MAX(version)+1 for
-- a revision (AC6). released_at is set = the release timestamp for Writing (6.1);
-- a future 6.4 deferred-release would insert with released_at = NULL. The
-- UNIQUE(submission_id, version) index makes concurrent version-N+1 writes
-- race-safe: the loser hits 23505 → the service maps it to a 409 retry (B3).
INSERT INTO grades (
    id, submission_id, center_id, graded_by, version,
    criterion_scores, overall_band, comments, feedback, released_at, created_at
)
VALUES (
    gen_random_uuid(), @submission_id, @center_id, @graded_by, @version,
    @criterion_scores, @overall_band, @comments, @feedback, @released_at, @created_at
)
RETURNING id, submission_id, center_id, graded_by, version, criterion_scores,
          overall_band, comments, feedback, released_at, created_at;

-- name: GetCurrentGrade :one
-- Latest grade version for a submission via the current_grades view (DISTINCT ON
-- (submission_id) ORDER BY version DESC). The view is security_invoker, so RLS is
-- evaluated as the querying role under its tenant GUC. pgx.ErrNoRows → ungraded.
SELECT id, submission_id, center_id, graded_by, version, criterion_scores,
       overall_band, comments, feedback, released_at, created_at
FROM current_grades
WHERE submission_id = @submission_id;

-- name: ListGradeVersions :many
-- Full version history for a submission, newest first (audit / revise UI).
SELECT id, submission_id, center_id, graded_by, version, criterion_scores,
       overall_band, comments, feedback, released_at, created_at
FROM grades
WHERE submission_id = @submission_id
ORDER BY version DESC;

-- name: MaxGradeVersion :one
-- Highest existing version for a submission, 0 when ungraded. The revise flow
-- reads this WITHOUT a serializing submission lock (a lock would make the 23505
-- retry path impossible) — UNIQUE(submission_id,version) is the sole guard: two
-- concurrent revises both compute N+1 and the index rejects the loser (23505 →
-- 409 GRADE_REVISE_CONFLICT, B3). Do NOT add a FOR UPDATE lock here on that
-- assumption.
SELECT COALESCE(MAX(version), 0)::int AS max_version
FROM grades
WHERE submission_id = @submission_id;

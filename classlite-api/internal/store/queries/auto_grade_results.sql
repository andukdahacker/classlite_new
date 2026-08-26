-- Story 6.4a — auto_grade_results working-table queries (AC8,10,13,16). The MUTABLE
-- pre-release grading state. All run inside a tenant tx (store.SetTenantContext); RLS
-- enforces center isolation, so no center_id predicate is written here. center_id is
-- passed EXPLICITLY on INSERT (GO-1; the WITH CHECK policy rejects a spoofed center_id).

-- name: InsertAutoGradeResult :one
-- One row per submission (submission_id UNIQUE). Written once by the synchronous
-- auto-grade hook on submit. created_at/updated_at default to now().
INSERT INTO auto_grade_results (
    id, submission_id, center_id, raw_score, max_score, percentage, provisional_band, answers
)
VALUES (
    gen_random_uuid(), @submission_id, @center_id, @raw_score, @max_score, @percentage,
    @provisional_band, @answers
)
RETURNING id, submission_id, center_id, raw_score, max_score, percentage, provisional_band,
          answers, created_at, updated_at;

-- name: GetAutoGradeResultBySubmission :one
-- The working row for a submission. pgx.ErrNoRows → auto-grade never ran (or the
-- submission is not objective) → the service maps it to 409 AUTO_GRADE_NOT_FOUND.
SELECT id, submission_id, center_id, raw_score, max_score, percentage, provisional_band,
       answers, created_at, updated_at
FROM auto_grade_results
WHERE submission_id = @submission_id;

-- name: UpdateAutoGradeResult :one
-- Recompute in place after a teacher override (max_score is fixed — the question count
-- never changes). The immutability trigger (auto_grade_results_immutable_after_release)
-- RAISEs P0001 if a released grade already exists → the store maps it to a typed 409.
UPDATE auto_grade_results
SET raw_score        = @raw_score,
    percentage       = @percentage,
    provisional_band = @provisional_band,
    answers          = @answers,
    updated_at       = now()
WHERE submission_id = @submission_id
RETURNING id, submission_id, center_id, raw_score, max_score, percentage, provisional_band,
          answers, created_at, updated_at;

-- Migration: add_grades_answer_errors
-- Story 8-3a / FU-8-2-A (AC15, D3). Additive, immutable `grades.answer_errors jsonb`
-- snapshot of the definitive-incorrect answers written at objective Release
-- (AutoGradeService.Release), so the student/class Mistakes surfaces can mine
-- Reading/Listening auto-graded errors — the source 8-2a D3 deferred.
--
-- Safety (Winston, R-2):
--   * `ADD COLUMN` with NO default is metadata-only — no table rewrite, no existing
--     row touched. The grades ledger stays append-only: this column is written at
--     INSERT only, NEVER UPDATEd.
--   * Immutability is table-level `REVOKE UPDATE/DELETE/TRUNCATE` + the absence of an
--     UPDATE policy (there is NO immutability trigger on grades). The new column
--     inherits that REVOKE for free — no privilege change needed here.
--   * The reader queries (GetCurrentGrade / ListGradeVersions) enumerate columns
--     explicitly, so appending `answer_errors` to the `current_grades` SELECT list is
--     additive. The view stays `security_invoker = true` (LOAD-BEARING — without it
--     the view runs RLS as its owner and leaks every tenant's grades; see the 6.1
--     create_grades migration).
--
-- CREATE OR REPLACE VIEW can only append columns to the END of the existing SELECT
-- list (same names/types/order for the existing columns) — `answer_errors` therefore
-- goes last, after `created_at`.

ALTER TABLE grades ADD COLUMN answer_errors jsonb;

CREATE OR REPLACE VIEW current_grades WITH (security_invoker = true) AS
SELECT DISTINCT ON (submission_id)
    id, submission_id, center_id, graded_by, version, criterion_scores,
    overall_band, comments, feedback, released_at, created_at, answer_errors
FROM grades
ORDER BY submission_id, version DESC;

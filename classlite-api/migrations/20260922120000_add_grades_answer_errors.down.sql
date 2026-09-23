-- Reverse 20260922120000_add_grades_answer_errors.
--
-- VIEW-DEPENDENCY ORDERING (Winston C1, R-2): `current_grades` SELECTs
-- `answer_errors`, so Postgres REFUSES to drop the column while the view depends on
-- it. The view must be dropped and recreated WITHOUT the column BEFORE the column is
-- dropped — a down that runs `DROP COLUMN` first errors ("cannot drop column
-- answer_errors ... because other objects depend on it").
DROP VIEW IF EXISTS current_grades;

CREATE VIEW current_grades WITH (security_invoker = true) AS
SELECT DISTINCT ON (submission_id)
    id, submission_id, center_id, graded_by, version, criterion_scores,
    overall_band, comments, feedback, released_at, created_at
FROM grades
ORDER BY submission_id, version DESC;

ALTER TABLE grades DROP COLUMN answer_errors;

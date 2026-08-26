-- Migration: add_auto_grade_results_immutable_trigger
-- Story 6.4a (AC10 / R16 / D9). The repo's SECOND immutability trigger, following the
-- WF-2 convention set by submission_immutable_after_release (Story 6.1):
--   * trigger function: <table>_<invariant>_fn()
--   * trigger:          <table>_<invariant>
--   * named SQLSTATE P0001 + stable message → the store maps (P0001, name) to a typed
--     409, never a bare 500.
--   * ships in its OWN migration, AFTER the table.
--
-- Invariant: once a submission's grade is RELEASED (a grades row with released_at
-- IS NOT NULL exists — the keystone reader contract, NOT submission.status), the
-- working row is frozen. A teacher override after release must be rejected: the
-- released grade is the definitive record. Pre-release UPDATEs (the override path)
-- MUST pass — the trigger discriminates on release state, it does not reject all
-- updates. Release itself does NOT touch this table (it only appends to grades and
-- flips the submission), so the trigger never fires on the release path.
--
-- The EXISTS runs under the tx tenant GUC — safe because every writer path sets
-- SET LOCAL app.current_tenant_id (PERF-1), and the released grade is same-center as
-- the working row, so grades RLS makes it visible. Backed by idx_grades_submission_released.

CREATE FUNCTION auto_grade_results_immutable_after_release_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM grades
        WHERE submission_id = NEW.submission_id
          AND released_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'auto_grade_results_immutable_after_release'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER auto_grade_results_immutable_after_release
    BEFORE UPDATE ON auto_grade_results
    FOR EACH ROW
    EXECUTE FUNCTION auto_grade_results_immutable_after_release_fn();

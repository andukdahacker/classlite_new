-- Migration: add_submission_release_trigger
-- Story 6.1 (AC3 / R16 / NFR-6). The FIRST trigger in the repo. Conditional
-- immutability the REVOKE + RLS idiom cannot express: a submission is frozen once
-- graded. A BEFORE UPDATE trigger RAISEs a NAMED exception (SQLSTATE P0001 +
-- message 'submission_immutable_after_release') so the store maps it to a typed
-- 409, never a bare 500 (Murat B4).
--
-- The submitted → graded transition MUST pass (that is how a grade is released —
-- AC4 flips status in the same tx). Only an UPDATE of an ALREADY-graded row raises.
-- DELETE of a graded submission is blocked by the grades FK (ON DELETE RESTRICT,
-- AC1) — no trigger arm needed for DELETE.
--
-- CONVENTION PRECEDENT (Winston — documented in docs/project-context.md WF-2):
--   * trigger function: <table>_<invariant>_fn()
--   * trigger:          <table>_<invariant>
--   * immutability triggers ship in their OWN migration, AFTER the table and the
--     append-only ledger that references it (grades here).
-- 6.4's second trigger MUST follow this shape rather than invent a new one.

CREATE FUNCTION submission_immutable_after_release_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'graded' THEN
        RAISE EXCEPTION 'submission_immutable_after_release'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER submission_immutable_after_release
    BEFORE UPDATE ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION submission_immutable_after_release_fn();

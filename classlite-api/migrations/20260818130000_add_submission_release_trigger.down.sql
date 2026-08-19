-- Reverse 20260818130000_add_submission_release_trigger. Drop the trigger before
-- its function. No prior migration is edited (WF-2).
DROP TRIGGER IF EXISTS submission_immutable_after_release ON submissions;
DROP FUNCTION IF EXISTS submission_immutable_after_release_fn();

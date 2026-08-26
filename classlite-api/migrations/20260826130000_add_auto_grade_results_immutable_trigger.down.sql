-- Reverse add_auto_grade_results_immutable_trigger (Story 6.4a).
DROP TRIGGER IF EXISTS auto_grade_results_immutable_after_release ON auto_grade_results;
DROP FUNCTION IF EXISTS auto_grade_results_immutable_after_release_fn();

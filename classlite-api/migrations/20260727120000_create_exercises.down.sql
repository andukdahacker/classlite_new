-- Reverse 20260727120000_create_exercises. DROP TABLE cascades the policies +
-- indexes. exercise_code_counters has no FK from exercises, so drop order is
-- immaterial; both are dropped. No prior migration is edited (WF-2).
DROP TABLE IF EXISTS exercise_code_counters;
DROP TABLE IF EXISTS exercises;

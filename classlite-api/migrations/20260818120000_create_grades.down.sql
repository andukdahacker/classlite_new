-- Reverse 20260818120000_create_grades. Drop the view first (it depends on the
-- table), then the table (cascades its policies + index). No prior migration is
-- edited (WF-2).
DROP VIEW IF EXISTS current_grades;
DROP TABLE IF EXISTS grades;

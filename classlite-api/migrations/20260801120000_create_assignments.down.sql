-- Reverse 20260801120000_create_assignments. DROP TABLE cascades the policies +
-- indexes. submissions (20260801130000) FK-references assignments ON DELETE
-- RESTRICT, so its down migration must run first. No prior migration is edited (WF-2).
DROP TABLE IF EXISTS assignments;

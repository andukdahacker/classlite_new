-- Reverse 20260801130000_create_submissions. DROP TABLE cascades the policies +
-- indexes. Runs before the assignments down migration (submissions FK-references
-- assignments). No prior migration is edited (WF-2).
DROP TABLE IF EXISTS submissions;

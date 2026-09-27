-- Reverse of idx_classes_name_trgm_concurrent. DROP INDEX CONCURRENTLY also cannot
-- run inside a transaction, so it is the sole statement in this file.
DROP INDEX CONCURRENTLY IF EXISTS idx_classes_name_trgm;

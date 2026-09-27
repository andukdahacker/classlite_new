-- Migration: idx_files_name_trgm_concurrent (Story 8.4a, /code-review 8-4a)
-- The files.name functional trigram index, built CONCURRENTLY. ONE statement per
-- file (see 20260924120100 for why). Byte-matches immutable_unaccent(f.name) in
-- search.sql's SearchFiles.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_files_name_trgm ON files USING gin (immutable_unaccent(name) gin_trgm_ops);

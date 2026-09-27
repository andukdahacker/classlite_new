-- Migration: idx_classes_name_trgm_concurrent (Story 8.4a, /code-review 8-4a)
-- The classes.name functional trigram index, built CONCURRENTLY so the build never
-- write-locks the table. ONE statement per file: golang-migrate v4 does not wrap a
-- single-statement migration in a transaction (CONCURRENTLY is allowed), but a
-- multi-statement file runs as one implicit tx where CONCURRENTLY errors — so this
-- file MUST contain exactly this one statement. The index expression byte-matches
-- the query's immutable_unaccent(c.name) in search.sql (else the planner skips it).
-- immutable_unaccent is defined in 20260924120000, applied first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_classes_name_trgm ON classes USING gin (immutable_unaccent(name) gin_trgm_ops);

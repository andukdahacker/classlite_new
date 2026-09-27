-- Migration: idx_exercises_title_trgm_concurrent (Story 8.4a, /code-review 8-4a)
-- The exercises.title functional trigram index, built CONCURRENTLY. Also serves the
-- Assignments category, which trigram-matches the JOINed exercises.title. ONE
-- statement per file (see 20260924120100 for why). Byte-matches
-- immutable_unaccent(e.title) in search.sql's SearchExercises + SearchAssignments.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exercises_title_trgm ON exercises USING gin (immutable_unaccent(title) gin_trgm_ops);

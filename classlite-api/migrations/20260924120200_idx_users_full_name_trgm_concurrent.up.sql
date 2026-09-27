-- Migration: idx_users_full_name_trgm_concurrent (Story 8.4a, /code-review 8-4a)
-- The users.full_name functional trigram index, built CONCURRENTLY. `users` is the
-- GLOBAL (no-RLS) table shared across all tenants — the one most in need of a
-- non-blocking build. ONE statement per file (see 20260924120100 for why). Byte-
-- matches immutable_unaccent(u.full_name) in search.sql's SearchStudents.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_full_name_trgm ON users USING gin (immutable_unaccent(full_name) gin_trgm_ops);

-- Migration: add_search_trgm_unaccent
-- Story 8.4a — the project's first accent-insensitive trigram search layer for
-- GET /api/search (FR-67). ADDITIVE ONLY: two contrib extensions + one IMMUTABLE
-- unaccent wrapper. No table rewrite.
--
-- The four functional gin_trgm_ops GIN indexes (classes.name, users.full_name,
-- exercises.title, files.name) ship in FOUR follow-up migrations
-- (20260924120100..120400), each a single `CREATE INDEX CONCURRENTLY` — a plain
-- CREATE INDEX takes ACCESS EXCLUSIVE for the build (write-blocking; `users` is
-- global and grows across all tenants), so the build is done non-blocking. It
-- MUST be one statement per migration file: golang-migrate v4 does not wrap a
-- single-statement migration in a transaction (so CONCURRENTLY is allowed), but a
-- multi-statement file runs as one implicit tx where CONCURRENTLY errors. This
-- extensions+function migration stays multi-statement (no CONCURRENTLY here).
-- Verified /code-review 8-4a 2026-09-26.
--
-- WHY an IMMUTABLE wrapper (D9): the 1-arg unaccent(text) is only STABLE (it
-- resolves the dictionary through the search_path at call time), so it cannot
-- back a functional index. The 2-arg unaccent(regdictionary, text) IS immutable;
-- pinning the dictionary name in a SQL wrapper marked IMMUTABLE is the documented
-- Postgres pattern. Every WHERE/ORDER BY in search.sql wraps BOTH sides in
-- immutable_unaccent(...) so the query expression byte-matches the index
-- expression — otherwise the planner ignores the index (Seq Scan → SLO death).
--
-- WHY trigram + ILIKE (D2, not tsvector): the searched entities are short labels
-- (names/titles), not documents; pg_trgm '%q%' ILIKE gives partial/prefix match
-- that tsvector word-stemming cannot ("Ali" → "Alice"). min-length 3 runes (D7)
-- guarantees the pattern yields ≥1 trigram so the GIN index is actually usable.
--
-- WHY CREATE EXTENSION needs a privileged role: contrib extensions are
-- cluster-level objects. Railway's migrate role grants it; IF NOT EXISTS keeps
-- re-runs safe. Local dev runs migrations as the `classlite` superuser.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- immutable_unaccent pins the `unaccent` dictionary so the marking is sound (D9).
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    STRICT
AS $func$ SELECT unaccent('unaccent', $1) $func$;

-- The four functional gin_trgm_ops GIN indexes over immutable_unaccent(<label>)
-- follow in 20260924120100..120400 (CREATE INDEX CONCURRENTLY, one per file). The
-- index expression MUST match the query's immutable_unaccent(<label>) byte-for-byte.
-- v1 searches exactly 4 labels (classes.name, users.full_name, exercises.title,
-- files.name) — keep indexes ⇔ searched columns in sync (exercises.code/description
-- and folder names are intentionally NOT searched).

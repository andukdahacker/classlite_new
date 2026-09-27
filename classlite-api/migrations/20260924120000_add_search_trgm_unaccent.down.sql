-- Reverse of add_search_trgm_unaccent (extensions + wrapper function only). The
-- four functional trigram indexes are dropped by their own 20260924120100..120400
-- down migrations, which run BEFORE this one (golang-migrate reverses order), so
-- the indexes are already gone by the time the function is dropped. LEAVE
-- pg_trgm/unaccent installed (Winston #7): dropping a shared contrib extension
-- risks cascading anything else that adopts it later, and an unused extension is
-- harmless and cheap. Extensions are cluster-level and idempotent (up uses IF NOT
-- EXISTS).

DROP FUNCTION IF EXISTS immutable_unaccent(text);

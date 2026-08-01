-- Story 4.5 — ADMIN-TOOL-ONLY query for the JSONB schema-migration batch tool
-- (tools/jsonbmigrate). CROSS-TENANT (no center_id / RLS predicate): the tool
-- runs on a SUPERUSER MIGRATION_DATABASE_URL connection that bypasses RLS,
-- sweeping every tenant's rows in one pass. Keep this ISOLATED from the
-- request-path exercise queries (exercises.sql) — nothing request-serving may
-- ever call it, and no request-path query may adopt the xmin/keyset shape. The
-- correctness boundary here is NOT RLS but the monotonic ladder + the
-- `schema_version` + `xmin` guards (party-mode Q1 ruling, 2026-07-31).
--
-- NOTE — the guarded WRITE is intentionally NOT here. sqlc's static analyzer
-- resolves the `xmin` system column in a SELECT target list (below) but NOT in
-- an UPDATE ... WHERE predicate ("column \"xmin\" does not exist"). Neither a
-- `xmin::text` cast nor a table alias gets past it. So the lost-update-guarded
-- UPDATE (WHERE id = $ AND schema_version = $from AND xmin::text = $readXmin) is
-- issued as a raw pgx Exec inside the tool, using CommandTag.RowsAffected() for
-- the rows-affected assertion. The tool runs on a raw superuser pgx pool anyway;
-- this keeps the xmin guard without abandoning the typed keyset read.

-- name: ListExercisesForJSONBMigration :many
-- One keyset page of rows still at the `from` version. KEYSET on id (id > $after,
-- ORDER BY id) — NEVER OFFSET: the tool mutates schema_version out from under its
-- own cursor, so an OFFSET page would skip rows (AC2a). `xmin::text` is the
-- whole-row MVCC version token read for the lost-update guard (AC2b) — surfaced
-- as text because sqlc has no native xid type; the raw-pgx UPDATE compares it
-- back as text. `deleted_at IS NULL` skip is SAFE per the GOVERNING INVARIANT: a
-- soft-deleted row upgrades lazily on restore/read, so the tool need not touch it.
SELECT id, xmin::text AS row_xmin, content, schema_version
FROM exercises
WHERE schema_version = sqlc.arg('from_version')
  AND id > sqlc.arg('after_id')
  AND deleted_at IS NULL
ORDER BY id
LIMIT sqlc.arg('page_limit');

-- Story 5.1 (AC19) — ADMIN-TOOL-ONLY query for the JSONB schema-migration batch
-- tool (tools/jsonbmigrate). CROSS-TENANT (no center_id / RLS predicate): the tool
-- runs on a SUPERUSER MIGRATION_DATABASE_URL connection that bypasses RLS. Keep
-- ISOLATED from the request-path submission queries (submissions.sql) — nothing
-- request-serving may call it. Mirror of exercise_jsonb_migration.sql; the xmin +
-- schema_version guards are the correctness boundary, not RLS.
--
-- The guarded WRITE is NOT here (sqlc can't resolve `xmin` in an UPDATE WHERE) —
-- it is a raw pgx Exec in the tool, matching the exercises arm.
--
-- status = 'in_progress' FILTER is load-bearing (D6): only in-flight rows are
-- batch-upgraded-and-written. submitted/ai_processing/graded rows are the grading
-- audit trail — Epic 6 makes them immutable, so the batch tool must never write
-- them; they upgrade transform-only on read instead.

-- name: ListSubmissionsForJSONBMigration :many
SELECT id, xmin::text AS row_xmin, content, schema_version
FROM submissions
WHERE schema_version = sqlc.arg('from_version')
  AND status = 'in_progress'
  AND id > sqlc.arg('after_id')
ORDER BY id
LIMIT sqlc.arg('page_limit');

-- Story 4.4a — Knowledge Hub file queries. RLS scopes center_id on every
-- statement (center_id set DIRECTLY from tc.CenterID on insert — GO-1). Reads
-- filter `deleted_at IS NULL`; storage accounting (SumFileSizeByCenter) filters
-- it too so a soft-delete frees quota (AC3/AC12). (center_id, object_key) is the
-- idempotency key for /uploads/confirm (AC4).

-- name: InsertFile :one
INSERT INTO files (
    center_id, folder_id, name, slug, object_key, content_type, size_bytes, uploaded_by
)
VALUES (
    sqlc.arg('center_id'), sqlc.narg('folder_id'), sqlc.arg('name'), sqlc.arg('slug'),
    sqlc.arg('object_key'), sqlc.arg('content_type'), sqlc.arg('size_bytes'), sqlc.narg('uploaded_by')
)
RETURNING id, center_id, folder_id, name, slug, object_key, content_type, size_bytes,
          uploaded_by, deleted_at, created_at, updated_at;

-- name: InsertFileIdempotent :one
-- Confirm-path insert. ON CONFLICT on the (center_id, object_key) idempotency
-- key DO NOTHING → 0 rows (pgx.ErrNoRows) when the same upload was already
-- confirmed (a concurrent double-confirm); the caller then re-reads via
-- GetFileByObjectKey and returns the winner (AC4 — one row, counted once).
INSERT INTO files (
    center_id, folder_id, name, slug, object_key, content_type, size_bytes, uploaded_by
)
VALUES (
    sqlc.arg('center_id'), sqlc.narg('folder_id'), sqlc.arg('name'), sqlc.arg('slug'),
    sqlc.arg('object_key'), sqlc.arg('content_type'), sqlc.arg('size_bytes'), sqlc.narg('uploaded_by')
)
ON CONFLICT (center_id, object_key) DO NOTHING
RETURNING id, center_id, folder_id, name, slug, object_key, content_type, size_bytes,
          uploaded_by, deleted_at, created_at, updated_at;

-- name: GetFileByObjectKey :one
-- Idempotency lookup — returns the existing row for (center_id, object_key)
-- regardless of deleted_at (a retried confirm returns the same file id).
SELECT id, center_id, folder_id, name, slug, object_key, content_type, size_bytes,
       uploaded_by, deleted_at, created_at, updated_at
FROM files
WHERE center_id = sqlc.arg('center_id') AND object_key = sqlc.arg('object_key');

-- name: GetFileByID :one
-- RLS-scoped; absent/soft-deleted/cross-tenant → pgx.ErrNoRows → 404.
SELECT id, center_id, folder_id, name, slug, object_key, content_type, size_bytes,
       uploaded_by, deleted_at, created_at, updated_at
FROM files
WHERE id = sqlc.arg('id') AND deleted_at IS NULL;

-- name: GetFileBySlug :one
SELECT id, center_id, folder_id, name, slug, object_key, content_type, size_bytes,
       uploaded_by, deleted_at, created_at, updated_at
FROM files
WHERE center_id = sqlc.arg('center_id') AND slug = sqlc.arg('slug') AND deleted_at IS NULL;

-- name: ListFilesByFolder :many
-- folder_id NULL argument lists root-level files (folder_id IS NULL); a uuid
-- lists that folder's files. Sorted name-ascending for a stable render.
SELECT id, center_id, folder_id, name, slug, object_key, content_type, size_bytes,
       uploaded_by, deleted_at, created_at, updated_at
FROM files
WHERE center_id = sqlc.arg('center_id') AND deleted_at IS NULL
  AND (
        (sqlc.narg('folder_id')::uuid IS NULL AND folder_id IS NULL)
        OR folder_id = sqlc.narg('folder_id')::uuid
      )
ORDER BY name ASC, id ASC;

-- name: UpdateFileName :one
-- Rename only. Used directly by the RLS write-isolation grid; the service's
-- combined rename+move goes through UpdateFile.
UPDATE files
SET name = sqlc.arg('name'), updated_at = now()
WHERE id = sqlc.arg('id') AND center_id = sqlc.arg('center_id') AND deleted_at IS NULL
RETURNING id, center_id, folder_id, name, slug, object_key, content_type, size_bytes,
          uploaded_by, deleted_at, created_at, updated_at;

-- name: UpdateFile :one
-- Combined rename + reparent (move). folder_id is set unconditionally to the
-- (possibly NULL) argument — the service resolves the tri-state before calling.
UPDATE files
SET name = sqlc.arg('name'), folder_id = sqlc.narg('folder_id'), updated_at = now()
WHERE id = sqlc.arg('id') AND deleted_at IS NULL
RETURNING id, center_id, folder_id, name, slug, object_key, content_type, size_bytes,
          uploaded_by, deleted_at, created_at, updated_at;

-- name: SoftDeleteFile :one
-- Soft-delete (AC3): stamp deleted_at once; frees storage accounting. A
-- missing/already-deleted row returns 0 rows (pgx.ErrNoRows) → 404.
UPDATE files
SET deleted_at = now(), updated_at = now()
WHERE id = sqlc.arg('id') AND center_id = sqlc.arg('center_id') AND deleted_at IS NULL
RETURNING id, center_id, folder_id, name, slug, object_key, content_type, size_bytes,
          uploaded_by, deleted_at, created_at, updated_at;

-- name: SoftDeleteFilesByFolderIDs :execrows
-- Cascade helper (review D2): soft-delete every live file whose folder is in a
-- deleted subtree — frees quota. Root files (folder_id NULL) are untouched.
UPDATE files
SET deleted_at = now(), updated_at = now()
WHERE center_id = sqlc.arg('center_id')
  AND folder_id = ANY(sqlc.arg('folder_ids')::uuid[])
  AND deleted_at IS NULL;

-- name: SumFileSizeByCenter :one
-- Live storage usage (AC12). Filters deleted_at IS NULL so a soft-delete frees
-- space. Computed inside the confirm tx AFTER the per-center advisory lock.
SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used_bytes
FROM files
WHERE center_id = sqlc.arg('center_id') AND deleted_at IS NULL;

-- name: GetCenterStorageLimit :one
-- The per-center ceiling (AC12). `centers` is a global no-RLS table; the read
-- is scoped by id. READ-ONLY in 4.4a.
SELECT storage_limit_bytes FROM centers WHERE id = sqlc.arg('id');

-- name: ListSessionsLinkingFile :many
-- AC13 linked-locations — sessions referencing the file via the indexed
-- session_materials.file_id FK. RLS scopes both tables to the tenant. Sessions
-- have no soft-delete (cancelled_at, not deleted_at); a hard-deleted session
-- cascades its materials away, so every row here is a live host.
SELECT s.id, s.topic
FROM session_materials sm
JOIN sessions s ON s.id = sm.session_id
WHERE sm.file_id = sqlc.arg('file_id')
ORDER BY s.starts_at DESC, s.id ASC;

-- name: ListExercisesLinkingFile :many
-- AC13 linked-locations — exercises whose content references the file via the
-- GIN-indexed JSONB containment {"sections":[{"knowledgeFileId":"<uuid>"}]}
-- (the 4.4b picker writes that marker). deleted_at IS NULL excludes a
-- soft-deleted host. `content @> $1` uses idx_exercises_content_gin, never a
-- per-load seq scan.
SELECT id, title
FROM exercises
WHERE content @> sqlc.arg('link_filter')::jsonb AND deleted_at IS NULL
ORDER BY updated_at DESC, id ASC;

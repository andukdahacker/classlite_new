-- Story 4.4a — Knowledge Hub folder queries. RLS scopes center_id on every
-- statement; center_id is set DIRECTLY from tc.CenterID on insert (never a
-- trigger — GO-1) so the INSERT satisfies the WITH CHECK policy. Every read
-- filters `deleted_at IS NULL` (soft-delete). The explicit `center_id = $` on
-- reads is belt-and-suspenders with RLS and makes the cross-tenant RLS grid
-- meaningful at the query level (TEST-BE-1).

-- name: InsertFolder :one
INSERT INTO folders (center_id, parent_folder_id, name)
VALUES (sqlc.arg('center_id'), sqlc.narg('parent_folder_id'), sqlc.arg('name'))
RETURNING id, center_id, parent_folder_id, name, deleted_at, created_at, updated_at;

-- name: ListFolders :many
-- Flat list for the 4.4b tree; the client composes the hierarchy via
-- parent_folder_id. Sorted by name for a stable render.
SELECT id, center_id, parent_folder_id, name, deleted_at, created_at, updated_at
FROM folders
WHERE center_id = sqlc.arg('center_id') AND deleted_at IS NULL
ORDER BY name ASC, id ASC;

-- name: GetFolder :one
-- RLS-scoped single folder; absent/soft-deleted/cross-tenant → pgx.ErrNoRows → 404.
SELECT id, center_id, parent_folder_id, name, deleted_at, created_at, updated_at
FROM folders
WHERE id = sqlc.arg('id') AND deleted_at IS NULL;

-- name: UpdateFolderName :one
-- Rename only. Used directly by the RLS write-isolation grid; the service's
-- combined rename+move goes through UpdateFolder.
UPDATE folders
SET name = sqlc.arg('name'), updated_at = now()
WHERE id = sqlc.arg('id') AND center_id = sqlc.arg('center_id') AND deleted_at IS NULL
RETURNING id, center_id, parent_folder_id, name, deleted_at, created_at, updated_at;

-- name: UpdateFolder :one
-- Combined rename + reparent (move). parent_folder_id is set unconditionally to
-- the (possibly NULL) argument — the service resolves the tri-state (unchanged
-- vs move-to-root vs reparent) before calling, and runs the cycle/depth guard.
UPDATE folders
SET name = sqlc.arg('name'), parent_folder_id = sqlc.narg('parent_folder_id'), updated_at = now()
WHERE id = sqlc.arg('id') AND deleted_at IS NULL
RETURNING id, center_id, parent_folder_id, name, deleted_at, created_at, updated_at;

-- name: SoftDeleteFolder :one
-- Soft-delete (AC2): stamp deleted_at once. A missing/already-deleted row
-- returns 0 rows (pgx.ErrNoRows) → 404.
UPDATE folders
SET deleted_at = now(), updated_at = now()
WHERE id = sqlc.arg('id') AND center_id = sqlc.arg('center_id') AND deleted_at IS NULL
RETURNING id, center_id, parent_folder_id, name, deleted_at, created_at, updated_at;

-- name: FolderSubtreeIDs :many
-- Recursive DOWNWARD walk: every live folder id in the subtree rooted at
-- start_id (INCLUDING start_id). Drives the cascade soft-delete (review D2) so a
-- deleted folder never leaves live descendants — which would orphan their quota
-- AND leave a live folder with a soft-deleted ancestor (defeating the
-- ancestor-based cycle guard). Terminates on the finite child tree.
WITH RECURSIVE subtree AS (
    SELECT f.id
    FROM folders f
    WHERE f.id = sqlc.arg('start_id') AND f.deleted_at IS NULL
    UNION ALL
    SELECT c.id
    FROM folders c
    INNER JOIN subtree s ON c.parent_folder_id = s.id
    WHERE c.deleted_at IS NULL
)
SELECT id FROM subtree;

-- name: SoftDeleteFoldersByIDs :execrows
-- Cascade helper (review D2): soft-delete the folder subtree in one statement.
UPDATE folders
SET deleted_at = now(), updated_at = now()
WHERE center_id = sqlc.arg('center_id')
  AND id = ANY(sqlc.arg('ids')::uuid[])
  AND deleted_at IS NULL;

-- name: FolderAncestorIDs :many
-- Recursive-CTE ancestor walk (AC2): returns every folder id on start_id's
-- parent chain, INCLUDING start_id itself, root-first order not guaranteed. The
-- service derives BOTH guards from this one list:
--   - cycle: moving folder F under target T is a cycle iff F ∈ ancestors(T)
--     (F == T is covered because start_id is included).
--   - depth: len(ancestors(T)) is T's depth (root = 1); reject T+child beyond
--     maxFolderDepth.
-- Terminates on the finite parent chain (the cycle guard is what keeps
-- parent_folder_id acyclic). A soft-deleted ancestor breaks the walk (re-roots).
WITH RECURSIVE ancestors AS (
    SELECT f.id, f.parent_folder_id
    FROM folders f
    WHERE f.id = sqlc.arg('start_id') AND f.deleted_at IS NULL
    UNION ALL
    SELECT p.id, p.parent_folder_id
    FROM folders p
    INNER JOIN ancestors a ON p.id = a.parent_folder_id
    WHERE p.deleted_at IS NULL
)
SELECT id FROM ancestors;

-- Migration: create_knowledge_hub
-- Story 4.4a — the Knowledge Hub data model: `folders` (nestable via a self-FK)
-- and `files` (R2-backed, soft-deleted, unique slug + object_key per center),
-- plus the storage-ceiling column on `centers`, the `session_materials.file_id`
-- link (FU-3-5-C), and the GIN index that keeps the file-detail linked-locations
-- resolver (AC13) off a per-load sequential scan.
--
-- FK policy:
--   center_id       → centers ON DELETE CASCADE (a purged center takes its rows).
--   folders.parent_folder_id → folders ON DELETE SET NULL (a deleted parent
--     re-roots its children rather than cascade-nuking a subtree; combined with
--     soft-delete this is defensive — v1 has no hard folder delete).
--   files.folder_id → folders ON DELETE SET NULL (same rationale — a removed
--     folder re-roots its files, never orphan-cascades them).
--   files.uploaded_by → users ON DELETE SET NULL (preserve the file if its
--     uploader is ever removed; mirrors session_notes.author_id).
--
-- Soft-delete: both tables carry a nullable `deleted_at`. Every read filters
-- `deleted_at IS NULL`; storage accounting (SUM(size_bytes)) filters it too so a
-- soft-delete frees quota (AC3/AC12). The row + R2 object are retained (ratified
-- user-authored-content policy); the archive/restore + hard-purge reaper are
-- deferred (FU-4-4-5/6).
--
-- Uniqueness: (center_id, object_key) is a FULL unique constraint — it is the
-- ON CONFLICT target that makes /uploads/confirm idempotent (AC4), and object
-- keys embed a per-upload uuid so a soft-deleted row never blocks a real new
-- upload. (center_id, slug) is likewise unique-per-center (AC1); the service
-- appends a short random token to the slugified name so collisions don't occur.

CREATE TABLE folders (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id        uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    parent_folder_id uuid        REFERENCES folders (id) ON DELETE SET NULL,
    name             text        NOT NULL,
    deleted_at       timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE files (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id    uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    folder_id    uuid        REFERENCES folders (id) ON DELETE SET NULL,
    name         text        NOT NULL,
    slug         text        NOT NULL,
    object_key   text        NOT NULL,
    content_type text        NOT NULL,
    size_bytes   bigint      NOT NULL,
    uploaded_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
    deleted_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT files_center_slug_unique       UNIQUE (center_id, slug),
    CONSTRAINT files_center_object_key_unique UNIQUE (center_id, object_key)
);

-- Composite index serving BOTH the RLS predicate (center_id) and the
-- list-by-folder filter (folder_id) in one index (AC1). folder_id NULL rows
-- (root-level files) are indexed too — btree indexes NULLs.
CREATE INDEX idx_files_center_folder ON files (center_id, folder_id);
-- Serves the folder tree walk + the cycle-guard recursive CTE (AC2).
CREATE INDEX idx_folders_center_parent ON folders (center_id, parent_folder_id);

-- GIN (jsonb_path_ops — @>-only, compact) on exercise content so the file-detail
-- linked-locations resolver (AC13) finds exercises whose content references a
-- knowledge file via a JSONB containment query instead of a per-load seq scan.
-- The 4.4b picker writes the stable reference {"knowledgeFileId": "<uuid>"} at
-- the section level; the resolver queries content @> that shape.
CREATE INDEX idx_exercises_content_gin ON exercises USING gin (content jsonb_path_ops);

-- Per-center storage ceiling (AC1/AC12). 500 MiB free default (524288000 bytes,
-- NOT 500 MB decimal). READ-ONLY in 4.4a — Epic 9 owns the plan model + write
-- path that raises it. `centers` is a global no-RLS table (see GO-1 note in the
-- Settings service); the ceiling is enforced per-center in the FileService.
ALTER TABLE centers
    ADD COLUMN storage_limit_bytes bigint NOT NULL DEFAULT 524288000;

-- FU-3-5-C — session materials may now point at a Knowledge Hub file (the
-- indexed FK side of the AC13 linked-locations resolver). Nullable so existing
-- link-only materials are untouched; SET NULL so a removed file doesn't cascade
-- away the material row. Widen the kind CHECK from ('link') to include 'file'.
ALTER TABLE session_materials
    ADD COLUMN file_id uuid REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE session_materials
    DROP CONSTRAINT session_materials_kind_check;
ALTER TABLE session_materials
    ADD CONSTRAINT session_materials_kind_check CHECK (kind IN ('link', 'file'));
CREATE INDEX idx_session_materials_file ON session_materials (file_id);

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders FORCE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;

-- Four-policy tenant grid, identical to exercises/classes. UPDATE carries
-- USING + WITH CHECK so a tenant cannot reparent a row into another center.

CREATE POLICY folders_select ON folders
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY folders_insert ON folders
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY folders_update ON folders
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY folders_delete ON folders
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY files_select ON files
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY files_insert ON files
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY files_update ON files
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY files_delete ON files
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

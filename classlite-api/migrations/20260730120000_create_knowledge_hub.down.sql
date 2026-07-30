-- Down: reverse create_knowledge_hub cleanly (exact inverse, reverse order).

-- session_materials: drop the file link + restore the original kind CHECK.
-- file-kind rows are removed BEFORE the link-only CHECK is restored — otherwise
-- ADD CONSTRAINT CHECK (kind IN ('link')) validates existing rows and errors on
-- any kind='file' row the up migration allowed.
DROP INDEX IF EXISTS idx_session_materials_file;
DELETE FROM session_materials WHERE kind = 'file';
ALTER TABLE session_materials
    DROP COLUMN file_id;
ALTER TABLE session_materials
    DROP CONSTRAINT session_materials_kind_check;
ALTER TABLE session_materials
    ADD CONSTRAINT session_materials_kind_check CHECK (kind IN ('link'));

-- exercises GIN + centers ceiling.
DROP INDEX IF EXISTS idx_exercises_content_gin;
ALTER TABLE centers
    DROP COLUMN storage_limit_bytes;

-- files before folders (files.folder_id → folders). Policies + indexes drop
-- with the tables.
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS folders;

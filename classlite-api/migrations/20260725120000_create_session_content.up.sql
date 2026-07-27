-- Migration: create_session_content
-- Story 3.5 — three session-scoped content tables: session_notes,
-- session_materials, session_exercises. Each carries its OWN center_id
-- (denormalized from the parent session) so the 4-policy RLS grid and the
-- null-guard tests anchor on a local column, never a join to sessions.
--
-- session_id is ON DELETE CASCADE: when a session row is hard-deleted its
-- content goes with it (unlike sessions.class_id RESTRICT — content has no
-- history-preservation requirement). author_id is ON DELETE SET NULL so a
-- note survives the deletion of the user who wrote it.
--
-- Materials are LINK-ONLY this story (R2 presign is finalized in a later
-- story); kind defaults to 'link' with a CHECK a future migration widens to
-- include 'file'. session_exercises are lightweight, in-session, ungraded
-- entries — NOT the Epic 5/6 assignments entity; no FK to a global exercise.

CREATE TABLE session_notes (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id   uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    session_id  uuid        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    body        text        NOT NULL,
    author_id   uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session_materials (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id   uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    session_id  uuid        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    title       text        NOT NULL,
    url         text        NOT NULL,
    kind        text        NOT NULL DEFAULT 'link' CHECK (kind IN ('link')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session_exercises (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id    uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    session_id   uuid        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    title        text        NOT NULL,
    instructions text,
    link         text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One composite index per table serving BOTH the RLS predicate (center_id)
-- and the session_id list filter in a single index (Winston fold — not two
-- single-column indexes).
CREATE INDEX idx_session_notes_center_session     ON session_notes (center_id, session_id);
CREATE INDEX idx_session_materials_center_session  ON session_materials (center_id, session_id);
CREATE INDEX idx_session_exercises_center_session  ON session_exercises (center_id, session_id);

ALTER TABLE session_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE session_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_materials FORCE ROW LEVEL SECURITY;
ALTER TABLE session_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_exercises FORCE ROW LEVEL SECURITY;

-- Four-policy tenant grid, identical to sessions. UPDATE carries USING +
-- WITH CHECK so a tenant cannot reparent a row to another center.

CREATE POLICY session_notes_select ON session_notes
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY session_notes_insert ON session_notes
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY session_notes_update ON session_notes
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY session_notes_delete ON session_notes
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY session_materials_select ON session_materials
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY session_materials_insert ON session_materials
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY session_materials_update ON session_materials
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY session_materials_delete ON session_materials
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY session_exercises_select ON session_exercises
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY session_exercises_insert ON session_exercises
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY session_exercises_update ON session_exercises
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY session_exercises_delete ON session_exercises
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

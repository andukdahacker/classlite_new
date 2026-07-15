-- Migration: create_terms
-- Story 2.5b — tenant-scoped academic term calendar. Owner-managed.
--
-- Mirrors the class_templates.up.sql 4-policy RLS pattern (Winston-B2 +
-- John ACCEPT compromise). Terms are tenant-scoped only — no system-seed
-- dual-scope. `start_date <= end_date` invariant enforced at DB level
-- so the API layer only has to reject same-day inputs.

CREATE TABLE terms (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id     uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    name          text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    start_date    date        NOT NULL,
    end_date      date        NOT NULL,
    session_count integer,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (start_date <= end_date)
);

CREATE INDEX idx_terms_center_id ON terms (center_id, start_date DESC);

ALTER TABLE terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE terms FORCE ROW LEVEL SECURITY;

-- Four policies per Winston-B2 (mirror class_templates.up.sql:29-55):
CREATE POLICY terms_select ON terms
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY terms_insert ON terms
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY terms_update ON terms
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY terms_delete ON terms
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

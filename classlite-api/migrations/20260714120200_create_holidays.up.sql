-- Migration: create_holidays
-- Story 2.5b — tenant-scoped public holidays / breaks. Owner-managed.
-- Same 4-policy RLS pattern as terms + class_templates.

CREATE TABLE holidays (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id  uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    date       date        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_holidays_center_id ON holidays (center_id, date);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays FORCE ROW LEVEL SECURITY;

CREATE POLICY holidays_select ON holidays
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY holidays_insert ON holidays
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY holidays_update ON holidays
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY holidays_delete ON holidays
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

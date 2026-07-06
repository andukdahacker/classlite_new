-- Migration: create_class_templates
-- Story 2.2 — dual-scope (system seed + tenant-owned) template catalog.
--
-- center_id IS NULL denotes a system seed (readable by every authenticated
-- tenant); center_id = <caller> denotes a tenant-owned custom template. Four
-- RLS policies (SELECT/INSERT/UPDATE/DELETE) with WITH CHECK on UPDATE close
-- Winston-W-B1's hostile-tenant reparent-to-tenantB-or-NULL attack surface.

CREATE TABLE class_templates (
    id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id      uuid          REFERENCES centers (id) ON DELETE CASCADE,
    name           text          NOT NULL,
    target_band    numeric(3,1)  NOT NULL CHECK (target_band >= 1.0 AND target_band <= 9.0),
    primary_skill  text          NOT NULL CHECK (primary_skill IN
                                     ('writing','speaking','listening','reading','listening_reading','all_skills')),
    session_count  integer       NOT NULL CHECK (session_count BETWEEN 1 AND 100),
    color          text,
    created_at     timestamptz   NOT NULL DEFAULT now()
);

-- Partial index — system seeds don't need it (NULL center_id).
CREATE INDEX idx_class_templates_center_id
    ON class_templates (center_id)
    WHERE center_id IS NOT NULL;

ALTER TABLE class_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_templates FORCE ROW LEVEL SECURITY;

-- Four policies per Winston-W-B1:
--
-- (1) SELECT — dual-scope: caller sees system seeds AND their own tenant rows.
CREATE POLICY class_templates_select ON class_templates
    FOR SELECT
    USING (center_id IS NULL
        OR center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- (2) INSERT — tenant-only: user cannot plant `center_id = NULL` system-seed
--     rows (Murat-M-B2 R1 discharge). Seed migration bypasses this policy via
--     temporary NO FORCE ROW LEVEL SECURITY window.
CREATE POLICY class_templates_insert ON class_templates
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- (3) UPDATE — tenant-scoped USING + WITH CHECK. Tenants CANNOT update system
--     seeds (USING excludes NULL rows) and CANNOT reparent their own row to
--     another tenant or to NULL (WITH CHECK enforces destination scope).
CREATE POLICY class_templates_update ON class_templates
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- (4) DELETE — tenant-scoped. System seeds are superuser-only by design.
CREATE POLICY class_templates_delete ON class_templates
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

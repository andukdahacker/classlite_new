-- Migration: create_enrollments
-- Story 3.4.5 — the student↔class linkage table (keystone extracted from Epic
-- 7 Story 7.3). Ships the table VERBATIM to the 7.3 spec (epic-07.md:152) so
-- 7.3 consumes it instead of recreating it. This story only ever WRITES
-- status='active'; the withdrawn/transferred transitions + enrollment_history +
-- the People-Management console stay in 7.3. The full status CHECK ships now so
-- 7.3's transitions need no migration.
--
-- FK policy:
--   center_id → centers ON DELETE CASCADE (a purged center takes its rows).
--   class_id  → classes ON DELETE CASCADE (a purged class takes its enrollments).
--   student_id → users  NO ACTION (default) — preserve enrollment history if a
--     user row is ever removed; matches the classes.teacher_id precedent.
--
-- updated_at DEFAULT now() fires on INSERT only (no trigger — matches the
-- classes convention, 20260719120000). Any future UPDATE (7.3 withdraw/transfer)
-- must SET updated_at = now() explicitly.

CREATE TABLE enrollments (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id     uuid          NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    student_id    uuid          NOT NULL REFERENCES users (id),
    class_id      uuid          NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    enrolled_at   timestamptz   NOT NULL DEFAULT now(),
    withdrawn_at  timestamptz,
    status        text          NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active','withdrawn','transferred')),
    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now()
);

-- Roster read path (GET /api/classes/{id}/enrollments) — center_id + class_id.
CREATE INDEX idx_enrollments_center_class   ON enrollments (center_id, class_id);
-- Future center-wide student list (Story 7.2) — additive, per AC1/T1.
CREATE INDEX idx_enrollments_center_student ON enrollments (center_id, student_id);
-- AC4 double-enrollment guard — a student may hold at most ONE active enrollment
-- per class, while historical withdrawn/transferred rows may coexist (so a
-- future 7.3 re-enrollment after withdrawal is possible).
CREATE UNIQUE INDEX uq_enrollments_active   ON enrollments (class_id, student_id)
                                            WHERE status = 'active';

ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments FORCE ROW LEVEL SECURITY;

-- Four-policy tenant grid identical to classes/sessions. No dual-scope — no
-- system-seeded enrollments. UPDATE carries USING + WITH CHECK so a tenant
-- cannot reparent a row to another center.
CREATE POLICY enrollments_select ON enrollments
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY enrollments_insert ON enrollments
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY enrollments_update ON enrollments
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY enrollments_delete ON enrollments
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

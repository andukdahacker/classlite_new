-- Migration: create_classes
-- Story 2.2 — center-scoped classes table. Story 3.1 owns the full class
-- lifecycle; this migration ships only what spawn needs.
--
-- classes_teacher_mutex CHECK constraint (Winston-W-S3): teacher_id and
-- pending_teacher_email are mutually exclusive. Prevents Epic 7's
-- claim-the-class reconciliation from leaving pending_teacher_email
-- populated after flipping teacher_id.

CREATE TABLE classes (
    id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id              uuid          NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    -- ON DELETE SET NULL preserves audit history and unblocks seed rollback
    -- (C1-03 review fix — default NO ACTION made the seed down-migration fail
    -- after any spawn, creating a rollback deadlock in prod).
    template_id            uuid          REFERENCES class_templates (id) ON DELETE SET NULL,
    name                   text          NOT NULL,
    target_band            numeric(3,1),
    primary_skill          text          CHECK (primary_skill IN
                                             ('writing','speaking','listening','reading','listening_reading','all_skills')),
    session_count          integer,
    status                 text          NOT NULL DEFAULT 'upcoming'
                                            CHECK (status IN ('upcoming','active','paused','ended')),
    teacher_id             uuid          REFERENCES users (id),
    pending_teacher_email  text,
    start_date             date,
    created_at             timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT classes_teacher_mutex CHECK (teacher_id IS NULL OR pending_teacher_email IS NULL)
);

CREATE INDEX idx_classes_center_id     ON classes (center_id);
CREATE INDEX idx_classes_teacher_id    ON classes (teacher_id)            WHERE teacher_id IS NOT NULL;
CREATE INDEX idx_classes_pending_email ON classes (pending_teacher_email) WHERE pending_teacher_email IS NOT NULL;

ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes FORCE ROW LEVEL SECURITY;

-- Four policies (Winston-W-B1). No dual-scope — no system-seeded classes.
CREATE POLICY classes_select ON classes
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY classes_insert ON classes
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY classes_update ON classes
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY classes_delete ON classes
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

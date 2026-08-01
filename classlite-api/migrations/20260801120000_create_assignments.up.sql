-- Story 5.1 (AC1,4,6,18,20). Assignments: a teacher binds an exercise to a class
-- with a deadline. RLS-scoped on center_id (verbatim 4-policy FORCE grid — matches
-- the enrollments/exercises convention, 20260722120000 / 20260727120000).
--
-- updated_at DEFAULT now() fires on INSERT only (no trigger — matches the
-- classes/enrollments/exercises convention). Every UpdateAssignment* query MUST
-- SET updated_at = now() explicitly.
--
-- FK conventions: center_id/class_id → ON DELETE CASCADE; exercise_id → NO ACTION
-- (an exercise with assignments is FR-23-locked from delete anyway, AC15);
-- created_by → users NO ACTION to preserve authorship history (classes.teacher_id
-- precedent). late_penalty is a flat scalar (D1: decision-neutral — a future
-- per-tier schedule is an additive JSONB/table, not a rename of this column).

CREATE TABLE assignments (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id        uuid          NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    exercise_id      uuid          NOT NULL REFERENCES exercises (id),
    class_id         uuid          NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    created_by       uuid          REFERENCES users (id),
    status           text          NOT NULL DEFAULT 'open'
                                      CHECK (status IN ('open','closed')),
    deadline_at      timestamptz   NOT NULL,
    hard_deadline_at timestamptz,
    instructions     text,
    late_penalty     numeric(3,1)  NOT NULL DEFAULT 0 CHECK (late_penalty >= 0),
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT assignments_hard_deadline_coherent
        CHECK (hard_deadline_at IS NULL OR hard_deadline_at >= deadline_at)
);

CREATE INDEX idx_assignments_center_class    ON assignments (center_id, class_id);
CREATE INDEX idx_assignments_center_exercise ON assignments (center_id, exercise_id);

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY assignments_select ON assignments
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY assignments_insert ON assignments
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY assignments_update ON assignments
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY assignments_delete ON assignments
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

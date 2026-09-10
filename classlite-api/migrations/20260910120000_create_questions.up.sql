-- Migration: create_questions
-- Story 7.4a — the anchored Q&A question table. A question always originates
-- from a student attempt on an assignment; the service derives exercise_id +
-- class_id server-side from the assignment (D3, SEC-7) — the client never sets
-- them. class_id makes teacher-binding (classes.teacher_id), shared-scope
-- (active enrollments in class_id), and teacher "own questions" (classes taught)
-- all well-defined.
--
-- anchor model (D2): exercise items carry NO stable id (positional JSONB), so
-- anchor_ref is a positional path ({sectionIndex, questionGroupIndex,
-- questionIndex} and/or {sectionIndex, charStart, charEnd}) captured verbatim,
-- plus a denormalized anchor_excerpt snapshot that survives an exercise edit.
--   anchor_type='item'     ⇒ anchor_ref NOT NULL (a positional path)
--   anchor_type='exercise' ⇒ anchor_ref NULL (whole-exercise question)
-- The coupling is a CHECK so a malformed anchor cannot be stored.
--
-- FK policy:
--   center_id  → centers  ON DELETE CASCADE (a purged center takes its rows).
--   exercise_id/class_id/student_id → RESTRICT (AC1) — a question pins its
--     anchor targets; the parents cannot be hard-deleted out from under it.
--
-- Q&A is a MUTABLE domain — questions.status flips open→resolved — so this is
-- the STANDARD 4-policy FORCE-RLS grid (mirror enrollments 20260722120000), NOT
-- the append-only audit_logs REVOKE lock. updated_at DEFAULT now() fires on
-- INSERT only; any future status UPDATE must SET updated_at = now() explicitly.

CREATE TABLE questions (
    id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id      uuid          NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    exercise_id    uuid          NOT NULL REFERENCES exercises (id) ON DELETE RESTRICT,
    class_id       uuid          NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
    student_id     uuid          NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    anchor_type    text          NOT NULL CHECK (anchor_type IN ('item','exercise')),
    anchor_ref     jsonb,
    anchor_excerpt text,
    content        text          NOT NULL,
    status         text          NOT NULL DEFAULT 'open'
                                     CHECK (status IN ('open','resolved')),
    created_at     timestamptz   NOT NULL DEFAULT now(),
    updated_at     timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT questions_anchor_ref_coupling
        CHECK (
            (anchor_type = 'exercise' AND anchor_ref IS NULL)
            OR
            (anchor_type = 'item' AND anchor_ref IS NOT NULL)
        )
);

-- Teacher console read path — RLS-filtered composite (PERF-2). center_id +
-- class_id is the teacher's own-classes scope.
CREATE INDEX idx_questions_center_class   ON questions (center_id, class_id);
-- Student own-questions scope.
CREATE INDEX idx_questions_center_student ON questions (center_id, student_id);
-- ?unanswered=true / ?status= filter + count.
CREATE INDEX idx_questions_class_status   ON questions (class_id, status);

ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions FORCE ROW LEVEL SECURITY;

-- Four-policy tenant grid identical to enrollments/classes. UPDATE carries
-- USING + WITH CHECK so a tenant cannot reparent a row to another center.
CREATE POLICY questions_select ON questions
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY questions_insert ON questions
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY questions_update ON questions
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY questions_delete ON questions
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

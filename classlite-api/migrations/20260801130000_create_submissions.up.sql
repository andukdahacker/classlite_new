-- Story 5.1 (AC7,9,11,12,14,18,19,20). Submissions: a student's attempt at an
-- assignment. RLS-scoped on center_id (verbatim 4-policy FORCE grid). Carries a
-- JSONB content payload + schema_version (GO-7; DEFAULT 1 is load-bearing — the
-- migrate-on-read ladder rejects version < 1).
--
-- updated_at DEFAULT now() fires on INSERT only (no trigger). Every write query
-- (SaveSubmissionProgress / SubmitSubmission) MUST SET updated_at = now() explicitly.
--
-- assignment_id FK is ON DELETE RESTRICT (D-fold #20 / Winston): a teacher cannot
-- delete an assignment (or class→assignment chain) out from under in-flight or
-- graded work; the service surfaces this as a typed 409. center_id/student_id keep
-- their standard conventions (CASCADE / NO ACTION). Submissions are NOT
-- soft-deletable in v1 (D7 — no deleted_at; plain UNIQUE(assignment_id, student_id)
-- is the grading audit trail). started_at is server-authoritative and set once.
-- ai_processing / graded are PROVISIONED states Epic 6 drives; 5.1 has no path
-- into them (the service permits only in_progress → submitted).

CREATE TABLE submissions (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id       uuid          NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    assignment_id   uuid          NOT NULL REFERENCES assignments (id) ON DELETE RESTRICT,
    student_id      uuid          NOT NULL REFERENCES users (id),
    status          text          NOT NULL DEFAULT 'in_progress'
                                     CHECK (status IN ('in_progress','submitted','ai_processing','graded')),
    content         jsonb         NOT NULL DEFAULT '{}',
    schema_version  integer       NOT NULL DEFAULT 1,
    is_late         boolean       NOT NULL DEFAULT false,
    applied_penalty numeric(3,1)  NOT NULL DEFAULT 0,
    started_at      timestamptz   NOT NULL DEFAULT now(),
    submitted_at    timestamptz,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_submissions_assignment_student UNIQUE (assignment_id, student_id)
);

CREATE INDEX idx_submissions_center_assignment ON submissions (center_id, assignment_id);
CREATE INDEX idx_submissions_status_created_at  ON submissions (status, created_at);

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions FORCE ROW LEVEL SECURITY;

CREATE POLICY submissions_select ON submissions
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY submissions_insert ON submissions
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY submissions_update ON submissions
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY submissions_delete ON submissions
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Migration: create_auto_grade_results
-- Story 6.4a (AC8/AC9 · D2/D9). The MUTABLE working table for objective auto-grading.
-- A submission is auto-marked the instant a student submits (SubmissionService.Submit,
-- synchronous, pure engine — no Gemini). The provisional result + per-answer teacher
-- overrides live HERE, RLS-scoped, while the submission stays status='submitted'. On
-- release (POST /release) the definitive grade is APPENDED to the immutable grades
-- ledger and the submission flips submitted → graded — so this table never holds the
-- released grade, only the pre-release working state (D2: grades-at-release-only, no
-- grade_releases table, no grades migration).
--
-- 4-policy FORCE RLS grid on center_id (verbatim from submissions, NOT the append-only
-- grades 2-policy grid): this table is UPDATEd in place by the teacher override path, so
-- it needs UPDATE + DELETE policies grades deliberately omits. FORCE so the owning
-- migration/superuser role is also subject to the policies.
--
-- submission_id is UNIQUE + ON DELETE RESTRICT: exactly one working row per submission
-- (the submit hook writes it once), and the row pins its submission against deletion
-- (mirrors grades — a working row must outlive a submission-delete attempt). center_id
-- ON DELETE RESTRICT mirrors grades (the tenant cannot be dropped out from under a
-- grade-adjacent row). answers is a typed []AutoGradeAnswer JSONB (GO-7 — never
-- map[string]interface{}); it holds the per-question breakdown the teacher reviews.

CREATE TABLE auto_grade_results (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id    uuid          NOT NULL UNIQUE REFERENCES submissions (id) ON DELETE RESTRICT,
    center_id        uuid          NOT NULL REFERENCES centers (id) ON DELETE RESTRICT,
    raw_score        integer       NOT NULL,
    max_score        integer       NOT NULL,
    percentage       numeric       NOT NULL,
    provisional_band numeric(2,1)  NOT NULL,
    answers          jsonb         NOT NULL,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now()
);

-- Every read is tenant-scoped; submission_id already has a UNIQUE index for the
-- by-submission lookup, so this composite just fronts the RLS center predicate.
CREATE INDEX idx_auto_grade_results_center_submission
    ON auto_grade_results (center_id, submission_id);

ALTER TABLE auto_grade_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_grade_results FORCE ROW LEVEL SECURITY;

CREATE POLICY auto_grade_results_select ON auto_grade_results
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY auto_grade_results_insert ON auto_grade_results
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY auto_grade_results_update ON auto_grade_results
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY auto_grade_results_delete ON auto_grade_results
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- D9 partial index: the immutability trigger (next migration) probes
-- EXISTS(released grade for this submission) on every working-row UPDATE, and the
-- student reader contract is "latest grade released_at IS NOT NULL". A partial index
-- on the released rows keeps both O(1).
CREATE INDEX idx_grades_submission_released
    ON grades (submission_id) WHERE released_at IS NOT NULL;

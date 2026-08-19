-- Migration: create_grades
-- Story 6.1 (AC1/AC2). Append-only grades ledger — the Epic-6 keystone inherited
-- by 5-5b/6.2/6.3/6.4. Mirrors the audit_logs append-only RLS idiom (SELECT +
-- INSERT policies only, REVOKE UPDATE/DELETE/TRUNCATE from classlite_app): a grade
-- is NEVER updated or deleted. A revision is a NEW row (version = N+1, AC6); a
-- deferred release (6.4) will be a NEW row in a future grade_releases event table
-- (D1) — NOT an UPDATE here. NO deleted_at: an append-only ledger is not
-- soft-deletable (Murat B5); the soft-delete convention (SEC-9) does not apply.
--
-- released_at is NULLABLE (D1). The keystone reader contract is
--   released ⇔ latest grade version has released_at IS NOT NULL
-- NEVER "a grade row exists" and NEVER submission.status = 'graded'. Writing (6.1)
-- sets released_at = now() at INSERT (grade + release atomic, AC4). Because the
-- table is append-only, 6.4's stored-then-released flow stays additive without a
-- migration to this table.
--
-- UNIQUE(submission_id, version) makes revise-by-new-row race-safe (Winston/Murat
-- B3): two concurrent revises both computing version = N+1 → the loser hits 23505,
-- which the handler maps to a 409 retry. submission_id FK is ON DELETE RESTRICT
-- (Murat B5) — the ledger must outlive a submission-delete attempt; combined with
-- the immutability trigger (AC3) a graded submission cannot be deleted.

CREATE TABLE grades (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id    uuid          NOT NULL REFERENCES submissions (id) ON DELETE RESTRICT,
    center_id        uuid          NOT NULL REFERENCES centers (id) ON DELETE RESTRICT,
    graded_by        uuid          NOT NULL REFERENCES users (id),
    version          integer       NOT NULL DEFAULT 1,
    criterion_scores jsonb         NOT NULL,
    overall_band     numeric(2,1)  NOT NULL,
    comments         jsonb         NOT NULL DEFAULT '[]'::jsonb,
    feedback         text,
    released_at      timestamptz,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_grades_submission_version UNIQUE (submission_id, version)
);

-- Read index for current_grades + version lookups (center_id first: every read is
-- tenant-scoped; version DESC serves both DISTINCT ON and MAX(version)).
CREATE INDEX idx_grades_center_submission_version
    ON grades (center_id, submission_id, version DESC);

ALTER TABLE grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE grades FORCE ROW LEVEL SECURITY;

-- Read isolation: rows only visible inside their owning tenant. Null/unset GUC →
-- NULLIF(...,'')::uuid is NULL → predicate is NULL → zero rows (fail-closed).
CREATE POLICY grades_select ON grades
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Append-only: INSERT allowed only when tenant context matches. USING and
-- WITH CHECK are SEPARATE — forgetting WITH CHECK would let a tenant write rows
-- attributed to another center_id (Murat B5). No UPDATE/DELETE policy = immutable.
CREATE POLICY grades_insert ON grades
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Defense in depth at the privilege layer (the default schema GRANT in
-- 20260601110000_create_app_role gave UPDATE/DELETE on all tables; clamp them back
-- so the append-only ledger cannot be mutated even if a policy is later added).
REVOKE UPDATE, DELETE, TRUNCATE ON grades FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON grades FROM classlite_app;

-- current_grades: the single source of "which grade row is current" so 5-5b/6.2/
-- 6.3 do not each hand-roll "highest version wins". DISTINCT ON picks the top
-- version per submission.
--
-- security_invoker = true is LOAD-BEARING: without it a view runs RLS as its OWNER
-- (the migration/superuser role), which BYPASSES grades RLS and would leak every
-- tenant's current grade through the view. With security_invoker the base-table
-- policies are evaluated as the querying role (classlite_app) under its tenant GUC.
CREATE VIEW current_grades WITH (security_invoker = true) AS
SELECT DISTINCT ON (submission_id)
    id, submission_id, center_id, graded_by, version, criterion_scores,
    overall_band, comments, feedback, released_at, created_at
FROM grades
ORDER BY submission_id, version DESC;

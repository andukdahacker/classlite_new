-- Migration: create_exercises
-- Story 4.1 — the center-scoped exercise LIBRARY (s15). This is NOT the
-- lightweight in-session `session_exercises` table (Story 3.5) — that is a
-- child of a session with no `content`/`schema_version`. This library entity
-- carries a typed JSONB `content` blob + a companion `schema_version` column
-- (GO-7 / architecture §JSONB), full CRUD (SOFT-delete via `deleted_at`), and
-- Duplicate. Never FK session_exercises to this table.
--
-- FK policy:
--   center_id  → centers ON DELETE CASCADE (a purged center takes its rows).
--   created_by → users NO ACTION (default) — preserve authorship history if a
--     user row is ever removed; matches the classes.teacher_id precedent.
--
-- Soft-delete: `deleted_at` nullable. Every read filters `deleted_at IS NULL`;
-- the archive/restore UI is Epic 10. The row is recoverable, never destroyed
-- (teacher-authored exercises are multi-hour assets — party-mode ruling).
--
-- content DEFAULT is the empty v1 shell. The service ALWAYS materializes the
-- full shell (incl. FR-22-default settings) on create — the column default is a
-- belt for any future raw insert path.
--
-- updated_at DEFAULT now() fires on INSERT only (no trigger — matches the
-- classes/enrollments convention). Every UpdateExercise query MUST
-- `SET updated_at = now()` explicitly.
--
-- exercise_code_counters is the monotonic per-(center,skill) source for the
-- server-generated `EX-<L><NNN>` code. A counter (not derive-from-rows) is
-- gap-tolerant and never reuses a retired code under soft/hard delete + retry
-- storms (Winston #1). UNIQUE(center_id, code) is the belt-and-suspenders guard.

CREATE TABLE exercises (
    id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id      uuid          NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    created_by     uuid          NOT NULL REFERENCES users (id),
    code           text          NOT NULL,
    title          text          NOT NULL,
    description    text,
    skill          text          NOT NULL
                                     CHECK (skill IN ('reading','listening','writing','speaking','grammar','vocabulary','general')),
    tags           text[]        NOT NULL DEFAULT '{}',
    target_band    numeric(2,1),
    content        jsonb         NOT NULL DEFAULT '{"sections":[]}',
    schema_version integer       NOT NULL DEFAULT 1,
    deleted_at     timestamptz,
    created_at     timestamptz   NOT NULL DEFAULT now(),
    updated_at     timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT exercises_center_code_unique UNIQUE (center_id, code)
);

CREATE TABLE exercise_code_counters (
    center_id  uuid    NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    skill      text    NOT NULL,
    next_seq   integer NOT NULL DEFAULT 0,
    PRIMARY KEY (center_id, skill)
);

-- Composite index serving BOTH the RLS predicate (center_id) and the
-- teacher-scope list filter (created_by) in one index.
CREATE INDEX idx_exercises_center_created_by ON exercises (center_id, created_by);
-- GIN index for the single-tag membership filter. The query uses the
-- array-containment operator (tags @> ARRAY[tag]) so this GIN index is actually
-- usable — the scalar `tag = ANY(tags)` form is NOT GIN-indexable (seq-scans).
CREATE INDEX idx_exercises_tags ON exercises USING gin (tags);

ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises FORCE ROW LEVEL SECURITY;
ALTER TABLE exercise_code_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_code_counters FORCE ROW LEVEL SECURITY;

-- Four-policy tenant grid, identical to classes/enrollments. No dual-scope —
-- no system-seeded exercises. UPDATE carries USING + WITH CHECK so a tenant
-- cannot reparent a row to another center.

CREATE POLICY exercises_select ON exercises
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY exercises_insert ON exercises
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY exercises_update ON exercises
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY exercises_delete ON exercises
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Same grid on the counter table — the ON CONFLICT upsert INSERTs then UPDATEs
-- inside the caller's tenant tx, so both WITH CHECK arms must hold.
CREATE POLICY exercise_code_counters_select ON exercise_code_counters
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY exercise_code_counters_insert ON exercise_code_counters
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY exercise_code_counters_update ON exercise_code_counters
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY exercise_code_counters_delete ON exercise_code_counters
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

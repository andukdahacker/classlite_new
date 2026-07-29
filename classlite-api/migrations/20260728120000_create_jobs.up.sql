-- Migration: create_jobs
-- Story 4.3a — the durable async job queue the product has deferred to
-- "Epic 4.3" (deferred-work.md, internal/test/workers/harness.go:30-38). A
-- teacher enqueues an AI generation; the dispatcher claims a row with
-- SELECT … FOR UPDATE SKIP LOCKED, re-establishes tenant context from the
-- row's center_id (the async equivalent of GO-1 / SEC-6), calls Gemini, and
-- writes a typed result fragment. Epic 6 reuses this same table for
-- ai_grade_* jobs by registering a new handler — hence `type` stays `text`,
-- NOT a second enum (architecture.md:486).
--
-- center_id is the SOLE tenant trust anchor (R3/A7, scored BLOCK 9): the
-- worker reads it from the row and SET LOCALs it before any handler DB op; a
-- payload center_id is logged as a discrepancy and ignored. RLS is keyed on
-- it with the exercises null-guard grid (0 rows when app.current_tenant_id is
-- unset), so a worker that forgets SET LOCAL fails closed, never leaks.
--
-- job_status is the shared enum (architecture.md:307). next_attempt_at drives
-- the retry backoff schedule (30/60/120s) and the re-claim predicate; it is
-- compared against a bound clock.Now() parameter (never SQL now()) so the
-- MockClock retry tests are deterministic (BC-2).

CREATE TYPE job_status AS ENUM ('pending', 'processing', 'complete', 'failed');

CREATE TABLE jobs (
    id                    uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id             uuid       NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    -- created_by is the enqueuing user; the poll (GetJobByID) is scoped to it so a
    -- job's AI result is readable only by its creator (not every center member —
    -- incl. students). Nullable + ON DELETE SET NULL: production enqueue always
    -- sets it, and GetJobByID's created_by filter fails closed (NULL never matches
    -- a real user id → 404). Story 4.3a code review 2026-07-29 (D4).
    created_by            uuid       REFERENCES users (id) ON DELETE SET NULL,
    type                  text       NOT NULL,
    status                job_status NOT NULL DEFAULT 'pending',
    params                jsonb      NOT NULL,
    params_schema_version integer    NOT NULL DEFAULT 1,
    result                jsonb,
    result_schema_version integer,
    error_details         text,
    retry_count           integer    NOT NULL DEFAULT 0,
    max_retries           integer    NOT NULL DEFAULT 3,
    next_attempt_at       timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    started_at            timestamptz,
    completed_at          timestamptz
);

-- Serves both the RLS predicate (center_id) is NOT the hot path here; the
-- claim loop scans by (status, created_at) to find the oldest ready job.
CREATE INDEX idx_jobs_status_created_at ON jobs (status, created_at);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;

-- Four-policy tenant grid, identical to exercises/classes. UPDATE carries
-- USING + WITH CHECK so a tenant cannot reparent a row to another center.
CREATE POLICY jobs_select ON jobs
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY jobs_insert ON jobs
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY jobs_update ON jobs
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY jobs_delete ON jobs
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

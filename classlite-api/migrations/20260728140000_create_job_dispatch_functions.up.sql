-- Migration: create_job_dispatch_functions
-- Story 4.3a — cross-tenant readiness discovery for the production dispatcher.
--
-- The dispatcher is INFRASTRUCTURE: it must find the next ready job (and stuck
-- jobs) across ALL tenants, but the per-job PROCESSING then runs under the RLS-
-- enforcing classlite_app role with the tenant SET LOCAL from the claimed row
-- (SEC-6). These SECURITY DEFINER functions are the minimal RLS-bypass surface:
-- they return ONLY center_ids (never job data), so the dispatcher can then open
-- a tenant-scoped tx and claim/sweep under normal RLS. search_path is pinned so
-- the definer's privileges cannot be hijacked via a shadowed relation/function.
--
-- Unit tests do NOT use these — the harness drives ProcessOnce/SweepStuckJobs
-- with the tenant already set, so the RLS-scoped claim/sweep queries suffice and
-- stay deterministic. These functions exist purely for the main.go worker loop.

CREATE FUNCTION next_ready_job_center(p_now timestamptz)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT center_id
    FROM jobs
    WHERE status = 'pending'
      AND (next_attempt_at IS NULL OR next_attempt_at <= p_now)
    ORDER BY created_at, id
    LIMIT 1;
$$;

CREATE FUNCTION stuck_job_centers(p_threshold timestamptz)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT DISTINCT center_id
    FROM jobs
    WHERE status = 'processing'
      AND started_at IS NOT NULL
      AND started_at < p_threshold;
$$;

GRANT EXECUTE ON FUNCTION next_ready_job_center(timestamptz) TO classlite_app;
GRANT EXECUTE ON FUNCTION stuck_job_centers(timestamptz) TO classlite_app;

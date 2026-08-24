-- Migration: add_ai_grade_speaking_inflight_unique_index
-- Story 6.3b (D9) — enqueue idempotency for the AI speaking-grade job.
--
-- The SPEAKING twin of uq_jobs_ai_grade_inflight (6.2a). A double-click / retry /
-- multi-tab must NOT mint two ai_grade_speaking jobs + two -1 job_deduction rows for
-- the same submission (the refund path covers only FAILURES — two *successful* jobs
-- both keep their charge, so the second deduct is a permanent, un-refunded money bug).
-- This partial unique index makes at most one ai_grade_speaking job IN FLIGHT
-- (pending/processing) per submission: the enqueue InsertJob hits a 23505 on THIS
-- index, which rolls the whole enqueue tx back — the same-tx InsertJobDeduction
-- included, so there is zero second deduct — and the handler returns the EXISTING
-- in-flight job (AC1/D9). A re-run AFTER a completed or failed run is allowed (status
-- no longer pending/processing → outside the partial predicate).
--
-- A SEPARATE index (not a broadened writing predicate — D9): the two index names are
-- distinct so the enqueue's isInflightIndexViolation reconcile can tell a speaking
-- 23505 from a writing one and pick the matching twin query. Additive only: no
-- column/schema change. The index expression reads params->>'submissionId', which the
-- 6.3b enqueue always sets; a non-ai_grade_speaking job never matches the predicate, so
-- the partial index is inert for every other job type.
CREATE UNIQUE INDEX uq_jobs_ai_grade_speaking_inflight
    ON jobs ((params->>'submissionId'))
    WHERE type = 'ai_grade_speaking' AND status IN ('pending', 'processing');

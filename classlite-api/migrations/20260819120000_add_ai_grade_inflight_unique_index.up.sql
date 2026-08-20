-- Migration: add_ai_grade_inflight_unique_index
-- Story 6.2a (D6) — enqueue idempotency for the AI writing-grade job.
--
-- A double-click / retry / multi-tab must NOT mint two ai_grade_writing jobs +
-- two -1 job_deduction rows for the same submission (the refund path only covers
-- FAILURES — two *successful* jobs both keep their charge, so the second deduct is
-- a permanent, un-refunded money bug). This partial unique index makes at most one
-- ai_grade_writing job IN FLIGHT (pending/processing) per submission: the enqueue
-- InsertJob hits a 23505 on this index, which rolls the whole enqueue tx back — the
-- same-tx InsertJobDeduction included, so there is zero second deduct — and the
-- handler returns the EXISTING in-flight job (AC1/D6). A re-run AFTER a completed or
-- failed run is allowed (status no longer pending/processing → outside the partial
-- predicate).
--
-- Additive only: no column/schema change. The index expression reads the
-- submissionId out of the jobs.params jsonb (params->>'submissionId'), which the
-- 6.2a enqueue always sets; other job types have no such key (or it is null), so a
-- NULL index key never conflicts — the partial index is inert for every non-
-- ai_grade_writing job.
CREATE UNIQUE INDEX uq_jobs_ai_grade_inflight
    ON jobs ((params->>'submissionId'))
    WHERE type = 'ai_grade_writing' AND status IN ('pending', 'processing');

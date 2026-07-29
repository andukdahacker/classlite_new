-- Story 4.3a — durable job queue. Every statement is RLS-scoped on center_id;
-- the dispatcher SET LOCALs the tenant from the CLAIMED row's center_id before
-- any of these run (SEC-6). ClaimNextJob binds @now (clock.Now(), never SQL
-- now()) so MockClock backoff tests are deterministic (BC-2). center_id comes
-- straight from tc.CenterID on insert (GO-1); the RLS WITH CHECK rejects a spoof.

-- name: InsertJob :one
-- Enqueue: status/retry_count/max_retries take their column defaults
-- (pending / 0 / 3). Called inside the same tx as the -1 job_deduction (AC1).
-- created_by is the enqueuing user; the poll (GetJobByID) scopes reads to it.
INSERT INTO jobs (id, center_id, created_by, type, params, params_schema_version)
VALUES (gen_random_uuid(), @center_id, @created_by, @type, @params, @params_schema_version)
RETURNING id, center_id, created_by, type, status, params, params_schema_version, result,
          result_schema_version, error_details, retry_count, max_retries,
          next_attempt_at, created_at, started_at, completed_at;

-- name: GetJobByID :one
-- RLS-scoped + creator-scoped poll read (AC2 / D4). A row in another tenant
-- returns pgx.ErrNoRows via RLS; a row created by a DIFFERENT user in the same
-- tenant returns pgx.ErrNoRows via the created_by filter — both map to 404
-- JOB_NOT_FOUND (no oracle: "not yours" is indistinguishable from "doesn't
-- exist"). @created_by is the caller's user id; a NULL created_by row (test-only
-- raw inserts) never matches a real user id, so the filter fails closed.
SELECT id, center_id, created_by, type, status, params, params_schema_version, result,
       result_schema_version, error_details, retry_count, max_retries,
       next_attempt_at, created_at, started_at, completed_at
FROM jobs
WHERE id = @id AND created_by = @created_by;

-- name: ClaimNextJob :one
-- Atomically claim the oldest ready job and mark it 'processing'. The inner
-- SELECT FOR UPDATE SKIP LOCKED guarantees no two workers grab the same row
-- (AC3). "Ready" = pending AND (never scheduled OR its backoff has elapsed) —
-- @now is the injected clock (BC-2), so a rescheduled retry only re-claims once
-- MockClock has advanced past next_attempt_at.
UPDATE jobs
SET status = 'processing', started_at = @now
WHERE id = (
    SELECT id FROM jobs
    WHERE status = 'pending'
      AND (next_attempt_at IS NULL OR next_attempt_at <= @now)
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING id, center_id, created_by, type, status, params, params_schema_version, result,
          result_schema_version, error_details, retry_count, max_retries,
          next_attempt_at, created_at, started_at, completed_at;

-- name: MarkJobComplete :execrows
-- Terminal success: store the typed result fragment + its schema version (AC4).
-- Guarded on status='processing' so a job the 5-min stuck-sweep already failed +
-- refunded cannot be flipped back to 'complete' by a slow-but-alive worker (that
-- would deliver content AND keep the refund = free generation). 0 rows affected
-- means the job was already swept — the worker must treat that as a no-op.
UPDATE jobs
SET status = 'complete', result = @result, result_schema_version = @result_schema_version,
    completed_at = @now, error_details = NULL
WHERE id = @id AND status = 'processing';

-- name: MarkJobFailedTerminal :execrows
-- Terminal failure (max-retries exhausted / invalid_ai_response / stuck-sweep).
-- next_attempt_at cleared so the row is never re-claimed; the refund is inserted
-- in the SAME tx by RefundJob (AC7). Guarded on status='processing' so the
-- worker's terminal write and the stuck-sweep's terminal write cannot both take
-- effect on the same row (RefundJob is idempotent regardless). 0 rows = already
-- terminal; the caller skips the refund on this path.
UPDATE jobs
SET status = 'failed', error_details = @error_details, completed_at = @now,
    next_attempt_at = NULL
WHERE id = @id AND status = 'processing';

-- name: RescheduleJob :exec
-- Transient failure with retries remaining (AC5): bump retry_count, requeue as
-- pending, and schedule the next attempt at @next_attempt_at (@now + backoff).
-- started_at is cleared so a stuck-sweep never mistakes a waiting retry for a
-- wedged in-flight job. NO refund on this path. Guarded on status='processing'
-- so a job the stuck-sweep already failed + refunded is never resurrected to
-- 'pending' and re-run for free. 0 rows affected = already swept (no-op).
UPDATE jobs
SET status = 'pending', retry_count = retry_count + 1, error_details = @error_details,
    next_attempt_at = @next_attempt_at, started_at = NULL
WHERE id = @id AND status = 'processing';

-- name: FindStuckProcessingJobs :many
-- The 5-minute stuck sweep (AC7): jobs wedged in 'processing' since before
-- @threshold (@now - StuckJobTimeout, bound via the injected clock). Returns just
-- the id so the sweep can mark-failed + refund each under its tenant context.
SELECT id, center_id FROM jobs
WHERE status = 'processing'
  AND started_at IS NOT NULL
  AND started_at < @threshold
ORDER BY started_at;

-- Story 3.4 — sessions queries. Recurrence is materialized on create
-- (CreateSession is called once per generated occurrence, all sharing one
-- recurrence_group_id). The scope mutations (Update/Cancel/Delete …InScope)
-- carry the R19 contract in SQL: a `starts_at >= @now_floor` term is ANDed onto
-- EVERY mutation so past/completed occurrences are immutable under every scope
-- (protects 3.5 attendance from retroactive rewrite).
--
-- Scope WHERE (the "Apply to…" selector), driven by @scope:
--   this   → id = @target_id
--   future → recurrence_group_id = @group_id AND starts_at >= @target_starts_at
--   all    → recurrence_group_id = @group_id
-- …all AND @now_floor. The service pre-rejects a past 'this' target (422) and
-- re-reads the target's updated_at for the optimistic guard (409) before these
-- run; the whole scope op is one atomic tx.

-- name: CreateSession :one
-- One row per generated occurrence. center_id is set DIRECTLY from tc.CenterID
-- (never a trigger). ends_at is derived (starts_at + duration) by the service.
INSERT INTO sessions (
    id, center_id, class_id, topic, starts_at, ends_at,
    recurrence_tz, status, recurrence_group_id, recurrence_pattern
)
VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9)
RETURNING id, center_id, class_id, topic, starts_at, ends_at, recurrence_tz,
          status, cancelled_at, recurrence_group_id, recurrence_pattern, created_at, updated_at;

-- name: GetSessionByID :one
-- RLS-scoped single session + denormalized class name/color + the class's
-- teacher_id (the service enforces teacher-scope against it → 404, never RLS).
SELECT s.id, s.center_id, s.class_id, s.topic, s.starts_at, s.ends_at, s.recurrence_tz,
       s.status, s.cancelled_at, s.recurrence_group_id, s.recurrence_pattern,
       s.created_at, s.updated_at,
       c.name AS class_name, c.color AS class_color, c.teacher_id AS class_teacher_id
FROM sessions s
JOIN classes c ON c.id = s.class_id
WHERE s.id = $1;

-- name: LockSession :one
-- Row-lock the mutation target BEFORE the guard re-read so the optimistic check
-- is atomic: a concurrent stale writer blocks here until the first tx commits,
-- then re-reads the bumped updated_at and 409s instead of silently losing the
-- update (CR-3-4 P4). Returns the id so pgx.ErrNoRows still maps to 404.
SELECT id FROM sessions WHERE id = $1 FOR UPDATE;

-- name: ListSessionsByRange :many
-- Half-open [from, to) on starts_at (a session that straddles `to` is included
-- iff starts_at < to). Optional class filter (@class_id) and teacher predicate
-- (@teacher_id — owner/admin pass NULL to bypass; teacher passes their id so a
-- cross-teacher class is ABSENT, not hidden). One indexed query + JOIN (PERF-2).
SELECT s.id, s.center_id, s.class_id, s.topic, s.starts_at, s.ends_at, s.recurrence_tz,
       s.status, s.cancelled_at, s.recurrence_group_id, s.recurrence_pattern,
       s.created_at, s.updated_at,
       c.name AS class_name, c.color AS class_color, c.teacher_id AS class_teacher_id
FROM sessions s
JOIN classes c ON c.id = s.class_id
WHERE s.starts_at >= sqlc.arg('from_ts')
  AND s.starts_at <  sqlc.arg('to_ts')
  AND (sqlc.narg('class_id')::uuid IS NULL OR s.class_id = sqlc.narg('class_id')::uuid)
  AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id')::uuid)
ORDER BY s.starts_at ASC;

-- name: ListSessionsByClass :many
-- Per-class session list for the class-detail Sessions tab (half-open range).
SELECT s.id, s.center_id, s.class_id, s.topic, s.starts_at, s.ends_at, s.recurrence_tz,
       s.status, s.cancelled_at, s.recurrence_group_id, s.recurrence_pattern,
       s.created_at, s.updated_at,
       c.name AS class_name, c.color AS class_color, c.teacher_id AS class_teacher_id
FROM sessions s
JOIN classes c ON c.id = s.class_id
WHERE s.class_id = sqlc.arg('class_id')
  AND s.starts_at >= sqlc.arg('from_ts')
  AND s.starts_at <  sqlc.arg('to_ts')
ORDER BY s.starts_at ASC;

-- name: GetSessionSeriesCounts :one
-- Scope-UI count oracle for GET /{id}: total in the group, upcoming (LIVE
-- future — a mutating scope only touches these) and completed (starts_at < now).
-- Cancelled rows are excluded from `upcoming` so the "Apply to…" confirmation
-- doesn't overstate how many occurrences a scope will affect (CR-3-4 P7).
SELECT
    count(*)                                            AS total,
    count(*) FILTER (WHERE starts_at >= sqlc.arg('now_ts') AND status <> 'cancelled') AS upcoming,
    count(*) FILTER (WHERE starts_at <  sqlc.arg('now_ts')) AS completed
FROM sessions
WHERE recurrence_group_id = sqlc.arg('group_id');

-- name: UpdateSessionsInScope :many
-- Scope-driven, past-immutable, in-place field edit. ends_at shifts with
-- starts_at to preserve each row's own duration unless duration_minutes is set.
UPDATE sessions
SET topic     = COALESCE(sqlc.narg('topic'), topic),
    class_id  = COALESCE(sqlc.narg('class_id')::uuid, class_id),
    starts_at = COALESCE(sqlc.narg('starts_at'), starts_at),
    ends_at   = CASE
        WHEN sqlc.narg('duration_minutes')::int IS NOT NULL
            THEN COALESCE(sqlc.narg('starts_at'), starts_at) + make_interval(mins => sqlc.narg('duration_minutes')::int)
        ELSE COALESCE(sqlc.narg('starts_at'), starts_at) + (ends_at - starts_at)
    END,
    updated_at = sqlc.arg('now_floor')
WHERE starts_at >= sqlc.arg('now_floor')
  AND (
        (sqlc.arg('scope') = 'this'   AND id = sqlc.arg('target_id'))
     OR (sqlc.arg('scope') = 'future' AND recurrence_group_id = sqlc.narg('group_id')::uuid AND starts_at >= sqlc.arg('target_starts_at'))
     OR (sqlc.arg('scope') = 'all'    AND recurrence_group_id = sqlc.narg('group_id')::uuid)
  )
RETURNING id;

-- name: CancelSessionsInScope :many
-- Scope-driven cancel-in-series. KEEPS rows (FR-17): status='cancelled' +
-- cancelled_at set (honors sessions_cancelled_coupling). Past-immutable floor.
UPDATE sessions
SET status = 'cancelled',
    cancelled_at = sqlc.arg('now_floor'),
    updated_at = sqlc.arg('now_floor')
WHERE starts_at >= sqlc.arg('now_floor')
  AND status <> 'cancelled'
  AND (
        (sqlc.arg('scope') = 'this'   AND id = sqlc.arg('target_id'))
     OR (sqlc.arg('scope') = 'future' AND recurrence_group_id = sqlc.narg('group_id')::uuid AND starts_at >= sqlc.arg('target_starts_at'))
     OR (sqlc.arg('scope') = 'all'    AND recurrence_group_id = sqlc.narg('group_id')::uuid)
  )
RETURNING id;

-- name: DeleteSessionsInScope :many
-- Scope-driven hard-delete of NON-completed rows only (past-immutable floor).
DELETE FROM sessions
WHERE starts_at >= sqlc.arg('now_floor')
  AND (
        (sqlc.arg('scope') = 'this'   AND id = sqlc.arg('target_id'))
     OR (sqlc.arg('scope') = 'future' AND recurrence_group_id = sqlc.narg('group_id')::uuid AND starts_at >= sqlc.arg('target_starts_at'))
     OR (sqlc.arg('scope') = 'all'    AND recurrence_group_id = sqlc.narg('group_id')::uuid)
  )
RETURNING id;

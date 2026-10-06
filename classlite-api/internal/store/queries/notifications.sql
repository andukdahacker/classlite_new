-- Story 10.1a — notifications queries. RLS-scoped on center_id (tenant tx).
-- center_id is passed EXPLICITLY on every write (GO-1); the RLS INSERT policy's
-- WITH CHECK rejects a spoofed value. Reads filter archived_at IS NULL at the
-- QUERY layer (SEC-9 Story 3.3 amendment — a policy-level filter would make the
-- archive UPDATE fall out of its own SELECT USING set). The read/archive verbs
-- gate on (id, user_id) ONLY — never read_at IS NULL — so a 2nd mark-read is a
-- 200 no-op, not a 404 (the idempotency-vs-404 trap, AC5).

-- name: InsertNotification :one
-- Single-recipient insert (grade_released, question_asked, payment_failed,
-- enrollment_changed, storage_threshold). center_id straight from tc.CenterID.
INSERT INTO notifications (center_id, user_id, type, title, body, link, metadata)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, center_id, user_id, type, title, body, link, metadata, read_at, archived_at, created_at;

-- name: FanoutNotificationToActiveStudents :execrows
-- Fan-out insert for assignment.created / schedule.changed — one row per ACTIVE
-- enrolled student of a class, via a single server-side INSERT … SELECT off the
-- enrollment rows (PERF-2; never per-student N+1, never a Go-materialized
-- multi-row insert that hits the 65535-param cliff). Withdrawn/transferred
-- enrollments (status != 'active') are excluded — a row for them is a
-- wrong-audience bug (AC10). An empty class inserts zero rows (no mis-join).
INSERT INTO notifications (center_id, user_id, type, title, body, link, metadata)
SELECT @center_id::uuid, e.student_id, @type::notification_type,
       @title::text, @body::text, @link::text, @metadata::jsonb
FROM enrollments e
WHERE e.class_id = @class_id::uuid AND e.status = 'active';

-- name: ListInboxForUser :many
-- Active-queue read (AC3): the caller's OWN non-archived rows, newest-first with
-- an id tie-break. Optional type filter (narg → absent = all) + unread_only.
-- center_id + user_id are both predicates (RLS scopes center; user_id scopes to
-- the caller — role is NOT a read filter, DD5).
SELECT id, center_id, user_id, type, title, body, link, metadata, read_at, archived_at, created_at
FROM notifications
WHERE center_id = @center_id
  AND user_id = @user_id
  AND archived_at IS NULL
  AND (sqlc.narg('type')::text IS NULL OR type::text = sqlc.narg('type')::text)
  AND (@unread_only::bool = false OR read_at IS NULL)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: CountInboxForUser :one
-- meta.total for the paginated active queue (same WHERE as ListInboxForUser,
-- minus pagination).
SELECT count(*)::bigint
FROM notifications
WHERE center_id = @center_id
  AND user_id = @user_id
  AND archived_at IS NULL
  AND (sqlc.narg('type')::text IS NULL OR type::text = sqlc.narg('type')::text)
  AND (@unread_only::bool = false OR read_at IS NULL);

-- name: CountUnreadForUser :one
-- Lightweight badge COUNT (AC4) — single indexed read over
-- idx_notifications_user_active, no row payload.
SELECT count(*)::bigint
FROM notifications
WHERE center_id = @center_id AND user_id = @user_id
  AND read_at IS NULL AND archived_at IS NULL;

-- name: MarkNotificationRead :one
-- Caller-scoped mark-read (AC5). Gated on (id, user_id) ONLY — NOT read_at IS
-- NULL — so a 2nd read on an already-read row still returns the row (200 no-op),
-- while a row owned by someone else returns 0 rows (pgx.ErrNoRows → 404
-- non-disclosure). RLS scopes center_id.
UPDATE notifications
SET read_at = @read_at
WHERE id = @id AND user_id = @user_id
RETURNING id, center_id, user_id, type, title, body, link, metadata, read_at, archived_at, created_at;

-- name: ArchiveNotification :one
-- Caller-scoped archive (AC5). Same (id, user_id) gate → 0 rows cross-user → 404.
-- Archiving removes the row from the active queue AND the unread count.
UPDATE notifications
SET archived_at = @archived_at
WHERE id = @id AND user_id = @user_id
RETURNING id, center_id, user_id, type, title, body, link, metadata, read_at, archived_at, created_at;

-- name: MarkAllReadForUser :execrows
-- Caller-scoped mark-all-read (DD5 service method; the mark-all-read UI ships in
-- 10-1b). Stamps every unread, non-archived row for the caller — archived_at IS NULL
-- keeps it consistent with the active-queue semantics every other verb maintains
-- (an archived row is out of the active queue and must not be touched).
UPDATE notifications
SET read_at = @read_at
WHERE center_id = @center_id AND user_id = @user_id AND read_at IS NULL AND archived_at IS NULL;

-- name: GetCenterOwnerContact :one
-- The owner's user_id + email + display name for the storage/payment owner row +
-- email (DD3/DD4). center_members is RLS-scoped to the tenant tx; users has no
-- RLS. pgx.ErrNoRows when a center has no owner (a handled best-effort skip).
SELECT u.id AS user_id, u.email, u.full_name
FROM center_members cm
JOIN users u ON u.id = cm.user_id
WHERE cm.center_id = @center_id AND cm.role = 'owner' AND cm.archived_at IS NULL
ORDER BY cm.created_at
LIMIT 1;

-- name: ListCenterOwnerAdminUserIDs :many
-- owner + admin recipients for enrollment.changed (operational signal is shared;
-- billing is not — AC7). RLS-scoped to the tenant tx.
SELECT user_id
FROM center_members
WHERE center_id = @center_id AND role IN ('owner', 'admin') AND archived_at IS NULL
ORDER BY created_at;

-- name: GetAssignmentNotificationContext :one
-- Denormalized DD1b display fields for grade_released / assignment_created,
-- resolved at WRITE time (the only cheap moment). RLS-scoped (invisible → ErrNoRows).
SELECT a.class_id, a.deadline_at, c.name AS class_name, ex.title AS exercise_title
FROM assignments a
JOIN classes c   ON c.id = a.class_id
JOIN exercises ex ON ex.id = a.exercise_id
WHERE a.id = @assignment_id;

-- name: GetGradeNotificationContext :one
-- grade_released: resolve the recipient student + denormalized display fields from
-- a submission id in one join (DD3 recipient + DD1b metadata). RLS-scoped.
SELECT s.student_id, s.assignment_id, a.class_id,
       c.name AS class_name, ex.title AS exercise_title
FROM submissions s
JOIN assignments a ON a.id = s.assignment_id
JOIN classes c     ON c.id = a.class_id
JOIN exercises ex  ON ex.id = a.exercise_id
WHERE s.id = @submission_id;

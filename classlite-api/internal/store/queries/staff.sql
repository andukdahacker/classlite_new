-- Story 7.1a — staff roster read model + archive write. Every query runs inside
-- a SET LOCAL app.current_tenant_id tx so RLS tenant-scopes center_members,
-- classes, and sessions; users + refresh_tokens are global but only read for a
-- userId already proven to be a center member (AC18).

-- name: ListStaffMembers :many
-- The staff roster (AC1/D3/D5/D6/D11/D16). One row per center_members row of
-- @center_id with role IN ('admin','teacher'), joined to users. Owners are
-- EXCLUDED (D3/D11 — single-owner-per-center invariant: excluding owners =
-- excluding the one acting owner; co-owner management lives in Settings).
--
-- Per-row aggregates are LATERAL scalar subqueries keyed on u.id, so a teacher
-- with N classes × M sessions yields the true SUM and appears EXACTLY ONCE (no
-- JOIN row-multiplication — the fan-out invariant):
--   classes_assigned              = COUNT(classes WHERE teacher_id = u.id)
--   next_seven_days_session_count = COUNT(status='scheduled' sessions of u's
--     classes with starts_at in the HALF-OPEN window [@now, @now + 7 days)).
--     @now is a BOUND arg (D16) — NEVER SQL now(); the fake clock drives the
--     AC7 boundary reds. Reuses ListSessionsByRange's half-open convention.
--   last_active_at                = MAX(refresh_tokens.created_at) for u.id,
--     else NULL (D6 — proxy for last login/refresh).
-- heavy = next_seven_days_session_count >= @heavy_threshold. Both the threshold
-- and the window width (@load_window_days) are BOUND args fed from the Go
-- constants HeavyLoadThresholdSessionsPerWeek / LoadWindowDays (CQ-3 — one
-- source of truth, no SQL/Go literal drift). status is DERIVED: 'archived' iff
-- archived_at IS NOT NULL, else 'active' (D4).
SELECT
    u.id                                                                     AS user_id,
    u.full_name                                                              AS name,
    u.email                                                                  AS email,
    u.avatar_url                                                             AS avatar_url,
    cm.role                                                                  AS role,
    (CASE WHEN cm.archived_at IS NOT NULL THEN 'archived' ELSE 'active' END)::text AS status,
    ca.classes_assigned::bigint                                              AS classes_assigned,
    ld.next_seven_days_session_count::bigint                                 AS next_seven_days_session_count,
    (ld.next_seven_days_session_count >= sqlc.arg('heavy_threshold')::bigint) AS heavy,
    la.last_active_at                                                        AS last_active_at
FROM center_members cm
JOIN users u ON u.id = cm.user_id
LEFT JOIN LATERAL (
    SELECT count(*) AS classes_assigned
    FROM classes c
    WHERE c.teacher_id = u.id
) ca ON true
LEFT JOIN LATERAL (
    SELECT count(*) AS next_seven_days_session_count
    FROM sessions s
    JOIN classes c ON c.id = s.class_id
    WHERE c.teacher_id = u.id
      AND s.status = 'scheduled'
      AND s.starts_at >= sqlc.arg('now')
      AND s.starts_at <  sqlc.arg('now') + make_interval(days => sqlc.arg('load_window_days')::int)
) ld ON true
LEFT JOIN LATERAL (
    SELECT max(rt.created_at)::timestamptz AS last_active_at
    FROM refresh_tokens rt
    WHERE rt.user_id = u.id
) la ON true
WHERE cm.center_id = sqlc.arg('center_id')
  AND cm.role IN ('admin', 'teacher')
ORDER BY u.full_name ASC, u.id ASC;

-- name: GetStaffMember :one
-- Single staff member of @center_id with role admin/teacher (B4/B5/AC5).
-- pgx.ErrNoRows for a non-member / student / owner → drives 404 STAFF_NOT_FOUND
-- (existence non-disclosure: an owner and a stranger both look "not found"
-- across the boundary). Cross-tenant reads return no row (RLS on center_members).
SELECT
    u.id            AS user_id,
    u.full_name     AS name,
    u.email         AS email,
    u.avatar_url    AS avatar_url,
    u.language_pref AS language_pref,
    cm.role         AS role,
    (CASE WHEN cm.archived_at IS NOT NULL THEN 'archived' ELSE 'active' END)::text AS status
FROM center_members cm
JOIN users u ON u.id = cm.user_id
WHERE cm.center_id = sqlc.arg('center_id')
  AND cm.user_id = sqlc.arg('user_id')
  AND cm.role IN ('admin', 'teacher');

-- name: ListPendingStaffInvites :many
-- Unaccepted staff invites for @center_id (AC1/D3) — accepted_at IS NULL, role
-- IN ('admin','teacher'). Owners never appear. class_id surfaces as the FE's
-- pendingClassId; name is nullable.
SELECT id, name, email, role, class_id, expires_at, created_at
FROM invites
WHERE center_id = sqlc.arg('center_id')
  AND accepted_at IS NULL
  AND role IN ('admin', 'teacher')
ORDER BY created_at DESC, id DESC;

-- name: ArchiveCenterMember :execrows
-- Soft-archive (D4/AC14/AC28). WHERE archived_at IS NULL makes a double-archive
-- a 0-row no-op → the service maps 0 rows to 409 STAFF_ALREADY_ARCHIVED. RLS
-- scopes the write to the tenant, so a cross-tenant archive is a 0-row no-op
-- (the row is invisible under the attacker's GUC) — AC17 write-isolation.
UPDATE center_members
SET archived_at = now()
WHERE center_id = sqlc.arg('center_id')
  AND user_id = sqlc.arg('user_id')
  AND archived_at IS NULL;

-- name: CountClassesByTeacher :one
-- The D17c archive "ghost": how many classes a teacher still owns at archive
-- time, so the archive response can carry assignedClassCount for the UI warn
-- (classes are NOT auto-unassigned — out of scope). Tenant-scoped via RLS.
SELECT count(*)::bigint AS classes_assigned
FROM classes
WHERE teacher_id = sqlc.arg('teacher_id');

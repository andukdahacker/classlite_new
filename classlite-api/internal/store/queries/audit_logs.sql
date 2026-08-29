-- name: InsertAuditLog :one
INSERT INTO audit_logs (center_id, user_id, action, entity_type, entity_id, changes, ip_address)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, center_id, user_id, action, entity_type, entity_id, changes, ip_address, created_at;

-- name: ListAuditLogsByEntity :many
SELECT id, center_id, user_id, action, entity_type, entity_id, changes, ip_address, created_at
FROM audit_logs
WHERE center_id = $1
  AND entity_type = $2
  AND entity_id = $3
ORDER BY created_at DESC;

-- name: ListAuditLogsByUser :many
-- Story 7.1a (D9/D15) — the staff-detail recentActivity block: newest-first
-- audit rows about @user_id, capped by @row_limit. Reads the audit_logs table
-- (column `action`, NOT auth_audit_logs.`event`). The member's activity is the
-- UNION of two keyings (D1 review resolution):
--   • actions the member PERFORMED  → user_id = @user_id (D9), and
--   • Owner staff-actions performed ON the member → entity_id = @user_id AND
--     entity_type = 'center_member' (D15 — these rows are keyed to the acting
--     Owner's user_id, so a user_id-only filter would drop them entirely).
-- No dedicated index exists yet — the LIMIT keeps the scan cheap for the small
-- N a detail view shows; add an index only if EXPLAIN flags it on a large table.
SELECT id, center_id, user_id, action, entity_type, entity_id, changes, ip_address, created_at
FROM audit_logs
WHERE center_id = sqlc.arg('center_id')
  AND (
        user_id = sqlc.arg('user_id')
     OR (entity_id = sqlc.arg('user_id') AND entity_type = 'center_member')
      )
ORDER BY created_at DESC
LIMIT sqlc.arg('row_limit');

-- name: ListAuditLogsByCenter :many
SELECT id, center_id, user_id, action, entity_type, entity_id, changes, ip_address, created_at
FROM audit_logs
WHERE center_id = $1
  AND entity_type = $2
  AND created_at >= $3
  AND created_at < $4
ORDER BY created_at DESC;

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

-- name: ListAuditLogsByCenter :many
SELECT id, center_id, user_id, action, entity_type, entity_id, changes, ip_address, created_at
FROM audit_logs
WHERE center_id = $1
  AND entity_type = $2
  AND created_at >= $3
  AND created_at < $4
ORDER BY created_at DESC;

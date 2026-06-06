-- name: InsertAuthAuditLog :exec
INSERT INTO auth_audit_logs (user_id, event, entity_type, entity_id, changes, ip_address)
VALUES ($1, $2, $3, $4, $5, $6);

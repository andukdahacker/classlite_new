-- name: InsertAuthAuditLog :exec
-- Story 1.6 — actor_user_id distinguishes "the user this event is about"
-- (user_id) from "the user who triggered it" (actor_user_id). For
-- self-initiated events (registration, login) actor stays NULL. For
-- force-logout, actor = Owner; subject (user_id) = target.
INSERT INTO auth_audit_logs (user_id, event, entity_type, entity_id, changes, ip_address, actor_user_id)
VALUES ($1, $2, $3, $4, $5, $6, $7);

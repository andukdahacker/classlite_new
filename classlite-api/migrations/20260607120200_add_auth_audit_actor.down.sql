DROP INDEX IF EXISTS idx_auth_audit_logs_actor_user_id;
ALTER TABLE auth_audit_logs DROP COLUMN actor_user_id;

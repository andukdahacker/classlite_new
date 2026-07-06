-- Rollback: create_template_sessions

DROP POLICY IF EXISTS template_sessions_delete ON template_sessions;
DROP POLICY IF EXISTS template_sessions_update ON template_sessions;
DROP POLICY IF EXISTS template_sessions_insert ON template_sessions;
DROP POLICY IF EXISTS template_sessions_select ON template_sessions;

DROP TRIGGER IF EXISTS trg_sync_template_sessions_center_id ON template_sessions;
DROP FUNCTION IF EXISTS sync_template_sessions_center_id();

DROP INDEX IF EXISTS idx_template_sessions_template_id;
DROP TABLE IF EXISTS template_sessions;

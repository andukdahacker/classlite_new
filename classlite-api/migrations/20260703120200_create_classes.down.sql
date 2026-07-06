-- Rollback: create_classes

DROP POLICY IF EXISTS classes_delete ON classes;
DROP POLICY IF EXISTS classes_update ON classes;
DROP POLICY IF EXISTS classes_insert ON classes;
DROP POLICY IF EXISTS classes_select ON classes;

DROP INDEX IF EXISTS idx_classes_pending_email;
DROP INDEX IF EXISTS idx_classes_teacher_id;
DROP INDEX IF EXISTS idx_classes_center_id;

DROP TABLE IF EXISTS classes;

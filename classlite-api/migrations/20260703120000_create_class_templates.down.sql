-- Rollback: create_class_templates

DROP POLICY IF EXISTS class_templates_delete ON class_templates;
DROP POLICY IF EXISTS class_templates_update ON class_templates;
DROP POLICY IF EXISTS class_templates_insert ON class_templates;
DROP POLICY IF EXISTS class_templates_select ON class_templates;

DROP INDEX IF EXISTS idx_class_templates_center_id;
DROP TABLE IF EXISTS class_templates;

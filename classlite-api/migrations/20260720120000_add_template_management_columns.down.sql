-- Reverse add_template_management_columns.

ALTER TABLE class_templates
    DROP COLUMN deleted_at,
    DROP COLUMN updated_at;

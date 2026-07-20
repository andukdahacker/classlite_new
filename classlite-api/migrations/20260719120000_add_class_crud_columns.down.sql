-- Down migration: add_class_crud_columns
-- Reverses the up exactly — drop the CHECK first, then each column in reverse
-- order. Restores the Story 2.2 partial classes shape.

ALTER TABLE classes
    DROP CONSTRAINT classes_capacity_positive,
    DROP COLUMN color,
    DROP COLUMN end_date,
    DROP COLUMN updated_at,
    DROP COLUMN due_dates_enabled,
    DROP COLUMN capacity,
    DROP COLUMN description;

-- Reverse add_template_session_duration. The CHECK constraint drops with the column.

ALTER TABLE template_sessions
    DROP COLUMN duration_minutes;

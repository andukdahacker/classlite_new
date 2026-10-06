-- Story 9.4 — reverse the notification_settings column add.
ALTER TABLE users
    DROP COLUMN notification_settings;

-- Migration: add_template_session_duration
-- Story 3.3 — per-session duration on template_sessions (epic AC2 "durations").
--
-- Nullable integer minutes with a CHECK bound (5–600). The 17 Story 2.2 seed
-- session rows stay NULL — nullability is intentional (a template session need
-- not declare a duration). New pair; never edits the 2.2 migration (WF-2).

ALTER TABLE template_sessions
    ADD COLUMN duration_minutes integer
        CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 600);

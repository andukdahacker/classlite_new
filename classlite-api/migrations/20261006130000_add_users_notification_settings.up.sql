-- Story 9.4 (AC12 / D2 / D15) — per-user notification preferences as a typed
-- jsonb (GO-7: schemaVersion-stamped, never map[string]interface{}). The
-- canonical v1 set is a small fixed boolean group, all defaulted true so every
-- pre-existing row backfills to "opted in". The live consumer (inbox event
-- routing) lands in Epic 10, which treats these persisted values as
-- authoritative; 9.4 only persists them (UI disabled-with-note per D15).
--
-- users is GLOBAL / no-RLS, so no policy change accompanies this column.
ALTER TABLE users
    ADD COLUMN notification_settings jsonb NOT NULL
        DEFAULT '{"schemaVersion":1,"emailOnSubmission":true,"emailOnQuestion":true,"emailOnAnnouncement":true}'::jsonb;

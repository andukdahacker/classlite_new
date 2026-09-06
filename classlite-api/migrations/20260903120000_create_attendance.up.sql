-- Migration: create_attendance
-- Story 3.5b — per-session attendance recording. Exactly one row per
-- (session, student) via UNIQUE (session_id, student_id); recording is an UPSERT
-- (INSERT … ON CONFLICT DO UPDATE). Mirrors the enrollments/sessions 4-policy
-- tenant RLS grid on center_id.
--
-- FK policy (D3/D10):
--   center_id  → centers  ON DELETE CASCADE (a purged center takes its rows).
--   session_id → sessions ON DELETE CASCADE (attendance has no history value once
--     the session is gone — unlike sessions.class_id RESTRICT).
--   student_id → users    NO ACTION (default) — matches enrollments.student_id.
--   marked_by  → users    ON DELETE RESTRICT, NOT NULL — a deleted teacher must
--     never orphan or cascade attendance rows (the on-row audit trail, D10).
--
-- updated_at DEFAULT now() fires on INSERT only (no trigger — matches the
-- enrollments/classes convention). The UPSERT's DO UPDATE MUST set
-- updated_at = now() explicitly (ON CONFLICT does not re-fire the default).

CREATE TABLE attendance (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id   uuid          NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    session_id  uuid          NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    student_id  uuid          NOT NULL REFERENCES users (id),
    status      text          NOT NULL CHECK (status IN ('present','late','absent')),
    marked_by   uuid          NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at  timestamptz   NOT NULL DEFAULT now(),
    updated_at  timestamptz   NOT NULL DEFAULT now(),
    -- Exactly one attendance row per student per session (D3). The ON CONFLICT
    -- target the UPSERT depends on.
    CONSTRAINT uq_attendance_session_student UNIQUE (session_id, student_id)
);

-- Roster read path (GET /api/sessions/{id}/attendance) — center_id + session_id.
CREATE INDEX idx_attendance_center_session ON attendance (center_id, session_id);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance FORCE ROW LEVEL SECURITY;

-- Four-policy tenant grid identical to enrollments/sessions. No dual-scope — no
-- system-seeded attendance. UPDATE carries USING + WITH CHECK so a tenant cannot
-- reparent a row to another center.
CREATE POLICY attendance_select ON attendance
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY attendance_insert ON attendance
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY attendance_update ON attendance
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY attendance_delete ON attendance
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Migration: create_student_notes
-- Story 7.2a (D7) — teacher/staff notes on a student. Net-new table (zero prior
-- hits in .go/.sql). Soft-delete via deleted_at per the user-authored-content
-- convention (feedback_soft_delete_user_authored_content) — a note is NEVER
-- hard-deleted in v1; restore/archive UI is deferred. Mirrors the
-- enrollments/attendance 4-policy tenant RLS grid on center_id.
--
-- D8 — the attachments jsonb column ships forward-compatible (defaults '[]') but
-- NO R2 presign wiring and NO @mention parse this story (FU-7-2-A / FU-7-2-B).
--
-- FK policy:
--   center_id  → centers ON DELETE CASCADE (a purged center takes its notes).
--   student_id → users   NO ACTION (default) — matches enrollments/attendance.
--   author_id  → users   ON DELETE RESTRICT, NOT NULL — a deleted staff author
--     must never orphan the note's authorship trail (mirrors attendance.marked_by).
--
-- created_at DEFAULT clock_timestamp() (NOT now()) is deliberate: notes are a
-- chronological log and the list orders by created_at ASC. now() returns the
-- transaction start time, so two notes written in one tx tie and cannot be
-- ordered deterministically; clock_timestamp() advances within a tx, keeping the
-- log strictly orderable. updated_at DEFAULT now() fires on INSERT only (no
-- trigger); flag toggle + soft-delete MUST set updated_at = now() explicitly.

CREATE TABLE student_notes (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id   uuid          NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    student_id  uuid          NOT NULL REFERENCES users (id),
    author_id   uuid          NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    content     text          NOT NULL,
    flagged     boolean       NOT NULL DEFAULT false,
    attachments jsonb         NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz   NOT NULL DEFAULT clock_timestamp(),
    updated_at  timestamptz   NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

-- Chronological note-list read path (GET /api/students/{id}/notes) —
-- center_id + student_id, created_at for the ASC ordering.
CREATE INDEX idx_student_notes_center_student
    ON student_notes (center_id, student_id, created_at);

ALTER TABLE student_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_notes FORCE ROW LEVEL SECURITY;

-- Four-policy tenant grid identical to enrollments/attendance. UPDATE carries
-- USING + WITH CHECK so a tenant cannot reparent a note to another center. The
-- soft-delete UPDATE (SET deleted_at) rides the UPDATE policy; note rows are
-- never hard-deleted in v1 but the DELETE policy ships for grid symmetry.
CREATE POLICY student_notes_select ON student_notes
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY student_notes_insert ON student_notes
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY student_notes_update ON student_notes
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY student_notes_delete ON student_notes
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Migration: create_enrollment_history
-- Story 7.3a (AC5/AC6/AC8 · R17) — the NET-NEW immutable enrollment audit trail.
-- One row per Add/Transfer/Withdraw, written in the SAME tx as the enrollment
-- state change. Immutability is enforced at the PRIVILEGE layer — the exact
-- audit_logs idiom (Story 1.3b, 20260603000000): ENABLE+FORCE RLS, a SELECT
-- tenant-isolation policy + a FOR INSERT WITH CHECK policy ONLY (no UPDATE/DELETE
-- policy), plus a REVOKE UPDATE,DELETE,TRUNCATE from PUBLIC + classlite_app. This
-- is NOT a trigger — the log is UNCONDITIONALLY append-only (contrast the
-- conditional submission_immutable_after_release trigger, Story 6.1).
--
-- FK policy (intentional divergence from enrollments' class CASCADE):
--   center_id     → centers CASCADE      (a purged center takes its history).
--   student_id    → users   NO ACTION    (block a user hard-delete while history refs it).
--   from/to_class_id → classes NO ACTION  (nullable) — NO ACTION is RESTRICT: unlike
--     enrollments.class_id (which CASCADEs), a class hard-delete is BLOCKED while any
--     history row references it, so the audit trail can never be silently cascaded
--     away. In practice classes are soft-deleted, so this rarely fires; it is the
--     belt that guarantees an audit table never loses a since-referenced class.
--   performed_by  → users   NO ACTION    (nullable) — NULL for system/genesis rows.

CREATE TABLE enrollment_history (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id      uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    student_id     uuid        NOT NULL REFERENCES users (id),
    action         text        NOT NULL CHECK (action IN ('add','transfer','withdraw')),
    from_class_id  uuid        REFERENCES classes (id),
    to_class_id    uuid        REFERENCES classes (id),
    effective_date date        NOT NULL,
    note           text,
    performed_by   uuid        REFERENCES users (id),
    performed_at   timestamptz NOT NULL DEFAULT now(),
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- Read path (GET /api/enrollments/history) — newest-first center-scoped timeline.
CREATE INDEX idx_enrollment_history_center_performed
    ON enrollment_history (center_id, performed_at DESC);
-- Per-student history filter (?student_id=) + the unassigned/history joins.
CREATE INDEX idx_enrollment_history_center_student
    ON enrollment_history (center_id, student_id);

ALTER TABLE enrollment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_history FORCE ROW LEVEL SECURITY;

-- Read isolation: rows only visible inside their owning tenant.
CREATE POLICY enrollment_history_select ON enrollment_history
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Append-only: INSERT allowed only when tenant context matches. NO update/delete
-- policy — history is immutable.
CREATE POLICY enrollment_history_insert ON enrollment_history
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Defense in depth — the default schema GRANT (20260601110000_create_app_role)
-- handed UPDATE/DELETE to classlite_app on all tables; clamp them back so the
-- application role cannot mutate or wipe enrollment history at the privilege layer
-- (SQLSTATE 42501 — a hard error, not a silent 0-rows).
REVOKE UPDATE, DELETE, TRUNCATE ON enrollment_history FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON enrollment_history FROM classlite_app;

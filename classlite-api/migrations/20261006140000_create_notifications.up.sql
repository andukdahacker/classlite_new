-- Migration: create_notifications
-- Story 10.1a — the tenant-isolated notifications table + the seven ruled domain
-- triggers' write target. ONE row per recipient per event (fan-out expands to N
-- rows at write time). The in-app inbox is always-on (D4 — notification_settings
-- are EMAIL gates, not read here).
--
-- i18n (DD1): the FE renders display text from `type` + `metadata`; `title`/`body`
-- hold a server-rendered English snapshot (the email channel + a degraded
-- fallback, never the primary UI source). `metadata` is the typed per-type struct
-- (DD1b, GO-7 schemaVersion) carrying actor + authoritative resource ids.
--
-- "archive" is `archived_at` — there is NO `deleted_at` (DD1). The active-queue
-- read filters `archived_at IS NULL` (SEC-9's soft-delete filter lives in the
-- read QUERY, not the SELECT policy — the Story 3.3 amendment: a policy-level
-- filter would make the archive UPDATE itself fall out of the USING set).
--
-- Q&A/enrollments precedent: notifications are a MUTABLE domain (read_at /
-- archived_at flip), so this is the STANDARD 4-policy FORCE-RLS grid (mirror
-- questions 20260910120000), NOT the append-only audit_logs REVOKE lock.
--
-- Enum reversibility (Winston): down.sql drops the enum. A later deferred trigger
-- that revives (e.g. question.answered) needs `ALTER TYPE notification_type ADD
-- VALUE` — which cannot run inside a tx on older PG and whose values can't be
-- removed. Heads-up so a future migration doesn't wedge.

CREATE TYPE notification_type AS ENUM (
    'grade_released',
    'assignment_created',
    'enrollment_changed',
    'question_asked',
    'schedule_changed',
    'payment_failed',
    'storage_threshold'
);

CREATE TABLE notifications (
    id          uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id   uuid              NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    user_id     uuid              NOT NULL REFERENCES users (id)   ON DELETE CASCADE,
    type        notification_type NOT NULL,
    title       text              NOT NULL,
    body        text              NOT NULL,
    link        text              NOT NULL,
    metadata    jsonb             NOT NULL DEFAULT '{}',
    read_at     timestamptz,
    archived_at timestamptz,
    created_at  timestamptz       NOT NULL DEFAULT now()
);

-- RLS-prefixed composite (PERF-2): serves BOTH the unread count
-- (WHERE center_id, user_id, read_at IS NULL) and the active list
-- (WHERE center_id, user_id, archived_at IS NULL ORDER BY created_at DESC).
CREATE INDEX idx_notifications_user_active
    ON notifications (center_id, user_id, read_at, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

-- Four-policy tenant grid identical to questions/enrollments. UPDATE carries
-- USING + WITH CHECK so a tenant cannot reparent a row to another center.
CREATE POLICY notifications_select ON notifications
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY notifications_insert ON notifications
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY notifications_update ON notifications
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY notifications_delete ON notifications
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

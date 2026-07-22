-- Migration: create_sessions
-- Story 3.4 — center-scoped sessions table (greenfield; the architecture
-- pre-named only `recurrence_group_id`). Recurrence is MATERIALIZED on create
-- into N concrete rows sharing one recurrence_group_id — no stored RRULE.
--
-- Coupling CHECKs pin the two invariants a bad write would otherwise slip
-- through silently:
--   sessions_recurrence_coupling — a row is either fully one-off
--     (group_id NULL AND pattern NULL) or fully recurring (both set); never half.
--   sessions_cancelled_coupling  — status='cancelled' iff cancelled_at is set.
--
-- class_id is ON DELETE RESTRICT (Winston fold): a class with taught sessions
-- can never be hard-deleted out from under its session history. center_id is
-- set DIRECTLY from tc.CenterID on insert (NOT via the template_sessions
-- trigger — sessions have no parent-plan trigger).

CREATE TABLE sessions (
    id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id            uuid          NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    class_id             uuid          NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
    topic                varchar(200),
    starts_at            timestamptz   NOT NULL,
    ends_at              timestamptz   NOT NULL,
    -- Capture the authoring IANA zone now; single-TZ *rendering* stays v1, but
    -- discarding the source zone is the irreversible mistake (Winston fold).
    recurrence_tz        text          NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    status               text          NOT NULL DEFAULT 'scheduled'
                                          CHECK (status IN ('scheduled','cancelled')),
    cancelled_at         timestamptz,
    recurrence_group_id  uuid,
    recurrence_pattern   text          CHECK (recurrence_pattern IS NULL
                                              OR recurrence_pattern IN ('daily','weekly','custom')),
    created_at           timestamptz   NOT NULL DEFAULT now(),
    updated_at           timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT sessions_time_order CHECK (ends_at > starts_at),
    CONSTRAINT sessions_recurrence_coupling CHECK ((recurrence_group_id IS NULL) = (recurrence_pattern IS NULL)),
    CONSTRAINT sessions_cancelled_coupling CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

CREATE INDEX idx_sessions_center_id          ON sessions (center_id);
CREATE INDEX idx_sessions_class_id           ON sessions (class_id);
CREATE INDEX idx_sessions_recurrence_group_id ON sessions (recurrence_group_id)
                                              WHERE recurrence_group_id IS NOT NULL;
-- The date-range list predicate (center_id + starts_at) — PERF-2, one indexed
-- query, no N+1.
CREATE INDEX idx_sessions_center_starts_at   ON sessions (center_id, starts_at);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

-- Four-policy tenant grid identical to classes. No dual-scope — no
-- system-seeded sessions. UPDATE carries USING + WITH CHECK so a tenant cannot
-- reparent a row to another center.
CREATE POLICY sessions_select ON sessions
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY sessions_insert ON sessions
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY sessions_update ON sessions
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY sessions_delete ON sessions
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

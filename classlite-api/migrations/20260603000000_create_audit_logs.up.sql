-- Migration: create_audit_logs
-- Creates append-only audit_logs table with tenant RLS isolation
-- and a composite index optimised for per-tenant entity timeline queries.

CREATE TABLE audit_logs (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id    uuid        NOT NULL REFERENCES centers (id) ON DELETE RESTRICT,
    user_id      uuid        NOT NULL REFERENCES users   (id) ON DELETE RESTRICT,
    action       text        NOT NULL,
    entity_type  text        NOT NULL,
    entity_id    uuid        NOT NULL,
    changes      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    ip_address   text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_center_entity_created
    ON audit_logs (center_id, entity_type, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- Read isolation: rows only visible inside their owning tenant.
CREATE POLICY audit_logs_tenant_isolation ON audit_logs
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Append-only: INSERT allowed only when tenant context matches.
-- No UPDATE or DELETE policies — audit history is immutable.
CREATE POLICY audit_logs_tenant_insert ON audit_logs
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Defense in depth — even if a future policy is added or RLS is misconfigured,
-- the application role cannot mutate or wipe audit history at the privilege layer.
-- (The default schema GRANT in 20260601110000_create_app_role gave UPDATE/DELETE
-- to classlite_app on all tables; this REVOKE clamps them back for audit_logs.)
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM classlite_app;

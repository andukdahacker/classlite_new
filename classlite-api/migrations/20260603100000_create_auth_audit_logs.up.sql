-- Migration: create_auth_audit_logs
-- Pre-tenant audit table for auth events (registration, email verification, resend).
-- These events happen before a user joins any center, so the existing center-scoped
-- audit_logs table + AuditService cannot record them. Story 1.4 AC13 / Option D.

CREATE TABLE auth_audit_logs (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        REFERENCES users (id),
    action      text        NOT NULL,
    entity_type text        NOT NULL,
    entity_id   uuid,
    changes     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    ip_address  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_audit_logs_user_created ON auth_audit_logs (user_id, created_at DESC);

-- Append-only defense in depth (mirrors Story 1.3b's audit_logs pattern).
-- The non-superuser application role cannot mutate or wipe audit history.
REVOKE UPDATE, DELETE, TRUNCATE ON auth_audit_logs FROM classlite_app;

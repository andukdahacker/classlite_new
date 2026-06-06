-- Migration: Story 1.5 Task 1 — login_attempts.
--
-- DB-backed login lockout counter (vs. in-memory) so the lockout survives
-- Railway dyno restarts. Pre-tenant table (login happens before tenant
-- context), so NOT RLS-protected — same rationale as auth_audit_logs.
--
-- The composite index on (email_norm, attempted_at DESC) services both
-- CountFailedLoginAttemptsSince and LastFailedLoginAttempt without a sort.
--
-- DELETE is intentionally permitted: AC7 resets the counter on a
-- successful login. UPDATE/TRUNCATE remain revoked for append-only-ish
-- defense in depth, matching the auth_audit_logs pattern.

CREATE TABLE login_attempts (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email_norm   text        NOT NULL,
    attempted_at timestamptz NOT NULL DEFAULT now(),
    success      boolean     NOT NULL,
    ip_address   text
);

CREATE INDEX idx_login_attempts_email_time
    ON login_attempts (email_norm, attempted_at DESC);

REVOKE UPDATE, TRUNCATE ON login_attempts FROM classlite_app;

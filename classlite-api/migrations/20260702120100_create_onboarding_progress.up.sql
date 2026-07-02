-- Migration: create_onboarding_progress
-- Story 2.1 — persistent onboarding wizard state per user.
--
-- No RLS — scoped by user_id, not center_id (these are pre-tenant-context
-- operations). Isolation enforced at the service layer via user_id filter,
-- mirroring email_verifications (see 20260601120000_create_auth_tables §4).
-- Compensation for the missing RLS is a J15 grid at
-- internal/test/onboarding_progress_rls_test.go (AC9) + a handler-integration
-- cross-user isolation test with three attack-vector subtests (AC10).

CREATE TABLE onboarding_progress (
    user_id      uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    current_step text        NOT NULL
        CHECK (current_step IN ('persona', 'center', 'template', 'spawn', 'solo_first_class', 'done')),
    payload      jsonb       NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

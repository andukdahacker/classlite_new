-- Migration: Story 1.5 Task 1 — rename auth_audit_logs.action → event.
--
-- The Story 1.5 ATDD invariants (and the broader auth_audit_logs semantics —
-- an *event* log, not a CRUD action log) align on the name 'event'. Story
-- 1.4 callsites (user.registered, user.email_verified, user.verification_resent)
-- are updated in the same commit so the suite stays green across this rename.
--
-- Note: this rename only touches the PRE-tenant auth_audit_logs table. The
-- tenant-scoped audit_logs table (Story 1.3b) keeps its `action` column —
-- that is a CRUD action log, not an event log.

ALTER TABLE auth_audit_logs RENAME COLUMN action TO event;

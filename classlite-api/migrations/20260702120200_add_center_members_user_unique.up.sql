-- Migration: add_center_members_user_unique
-- Story 2.1 — DB-level enforcement of the "one center per user in v1"
-- invariant surfaced by POST /api/centers as 409 USER_ALREADY_HAS_CENTER.
-- The application-layer pre-check is the suspenders; this index is the belt
-- that closes the concurrent double-post race window.
--
-- Pre-flight audit — run before applying in any env:
--   SELECT user_id, COUNT(*) FROM center_members GROUP BY user_id HAVING COUNT(*) > 1;
-- Non-empty result = there's an existing user with >1 membership.
-- Resolve by hand (typically a dev test fixture from Story 1.6 invite-accept)
-- before running this migration. R50 (migration rollback drops data, score 6)
-- guarantees a failed migration is safer than a coerced one.
--
-- LOCKING / PRODUCTION-READINESS NOTE (added by /code-review 2-1):
-- The bare `CREATE UNIQUE INDEX` below takes ACCESS EXCLUSIVE on
-- center_members for the duration of the build — safe now (Epic 2 opens the
-- wizard flow; center_members is effectively empty at first-ship), but a
-- foot-gun once the table has any row count. Story 2.1 ships this form
-- because golang-migrate's postgres driver wraps every migration in a
-- transaction, and `CREATE INDEX CONCURRENTLY` cannot run inside a tx —
-- fixing that requires either a driver-level transaction-off flag or
-- splitting this into a manual-DDL follow-up. See deferred-work.md
-- (code review of story-2-1, 2026-07-02) for the CONCURRENTLY migration
-- plan to run BEFORE center_members has meaningful production row counts.

CREATE UNIQUE INDEX idx_center_members_user_id
    ON center_members (user_id);

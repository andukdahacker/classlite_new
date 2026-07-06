-- Migration: add_invites_center_email_unique
-- Story 2.2 — partial unique index enforces per-center-per-email invite
-- dedup at the DB layer (belt) alongside the ClassService.Spawn app-layer
-- dedup (suspenders). Partial (`WHERE accepted_at IS NULL`) so a re-invite
-- AFTER a prior invite was accepted still succeeds.
--
-- Pre-flight audit — run before applying:
--   SELECT center_id, LOWER(email), COUNT(*) FROM invites
--   WHERE accepted_at IS NULL GROUP BY 1, 2 HAVING COUNT(*) > 1;
-- Non-empty result = duplicate active invites. Resolve manually (usually
-- test fixtures from Story 1.6). NEVER swallow via ON CONFLICT DO NOTHING.
--
-- Naming — no `_unique` suffix per Amelia-A-S4 (mirrors Story 2.1's
-- idx_center_members_user_id shape).

CREATE UNIQUE INDEX idx_invites_center_email_active
    ON invites (center_id, LOWER(email))
    WHERE accepted_at IS NULL;

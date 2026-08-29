-- Migration: add_center_members_archived_at
-- Story 7.1a (D4) — staff status is DERIVED, not an enum column. A nullable
-- archived_at timestamp is the soft-archive marker: `active` = row exists &
-- archived_at IS NULL, `archived` = archived_at IS NOT NULL. Mirrors the
-- repo's soft-delete convention (no hard delete of a member). Un-archive UI
-- is deferred (7-1b/later); only the column + set-path ship here.
--
-- RLS is UNCHANGED — the added column rides the existing center_id policy
-- grid (center_members_tenant_isolation / center_members_tenant_insert). No
-- data backfill: a pre-existing member is `active` (archived_at defaults NULL).

ALTER TABLE center_members ADD COLUMN archived_at timestamptz;

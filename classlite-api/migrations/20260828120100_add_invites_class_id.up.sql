-- Migration: add_invites_class_id
-- Story 7.1a (D7) — an invite may optionally carry a target class so that,
-- on acceptance by a `teacher`, the new member is auto-assigned to it
-- (classes.teacher_id, mutex-honored). Nullable FK → classes(id).
--
-- ON DELETE SET NULL: if the target class is hard-deleted before the invite
-- is accepted, the invite simply loses its auto-assign target rather than
-- blocking the class delete or leaving a dangling FK. Accept-time code
-- ALSO re-validates the class in-tenant under the accept-tx GUC (D13c) — the
-- FK bypasses RLS, so a stale/cross-moved class_id must be re-checked before
-- any UpdateClass write; the FK alone is not the tenant guard.
--
-- RLS is UNCHANGED — the added column rides the existing invites center_id
-- policy grid. No data backfill (existing invites have class_id NULL = no
-- auto-assign, the prior behavior).

ALTER TABLE invites ADD COLUMN class_id uuid REFERENCES classes (id) ON DELETE SET NULL;

-- Reverses 20260717120000_add_role_check_center_members.up.sql.
-- IF EXISTS guards keep the DROP idempotent if the up.sql half-applied
-- (e.g. crash between the two ADD CONSTRAINTs).

ALTER TABLE center_members DROP CONSTRAINT IF EXISTS center_members_role_check;
ALTER TABLE invites        DROP CONSTRAINT IF EXISTS invites_role_check;

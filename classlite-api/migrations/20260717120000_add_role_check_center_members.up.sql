-- Migration: add_role_check_center_members
-- Story 2.6 (AC1) — FR-9 role ladder materialized at the DB write-side.
-- Closes FU-2-1-B by adding CHECK (role IN ('owner','admin','teacher','student'))
-- to BOTH role-carrying tables (center_members, invites). Prior to this
-- migration nothing prevented INSERT ... role='root'; the shared
-- internal/model/roles.go IsValidRole helper is the application-side
-- suspenders, this CHECK is the belt.
--
-- Pre-flight assertion is a GATE, not a comment [Winston-STRONG-2, party-mode
-- review 2026-07-17]. The DO $$ blocks below RAISE if any row carries a
-- non-canonical role — the migration then aborts inside its own transaction
-- (golang-migrate wraps each file in a tx), so the CHECK is either added
-- against a clean table or the deploy fails loudly at migrate time instead
-- of at the first constraint-violating INSERT.
--
-- To pre-audit before applying in any env:
--   SELECT DISTINCT role FROM center_members;
--   SELECT DISTINCT role FROM invites;
-- Anything outside the four-role set must be normalized by hand (Story 1.5
-- shipped register/login/oauth-callback all constrained to owner|admin|
-- teacher|student, so a rogue value would only exist from a dev fixture).

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM center_members
        WHERE role NOT IN ('owner', 'admin', 'teacher', 'student')
    ) THEN
        RAISE EXCEPTION
            'center_members contains non-canonical role values; abort constraint add';
    END IF;
END $$;

ALTER TABLE center_members
    ADD CONSTRAINT center_members_role_check
    CHECK (role IN ('owner', 'admin', 'teacher', 'student'));

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM invites
        WHERE role NOT IN ('owner', 'admin', 'teacher', 'student')
    ) THEN
        RAISE EXCEPTION
            'invites contains non-canonical role values; abort constraint add';
    END IF;
END $$;

ALTER TABLE invites
    ADD CONSTRAINT invites_role_check
    CHECK (role IN ('owner', 'admin', 'teacher', 'student'));

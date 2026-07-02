-- Migration: add_users_persona
-- Story 2.1 — adds users.persona (nullable) with a CHECK constraint
-- restricting values to the three persona strings surfaced by the
-- onboarding wizard.

ALTER TABLE users
    ADD COLUMN persona text
        CHECK (persona IS NULL OR persona IN ('operator', 'founder', 'solo_teacher'));

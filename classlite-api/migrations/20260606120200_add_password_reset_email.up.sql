-- Migration: Story 1.5 Task 1 — denormalize email on password_resets.
--
-- Closes deferred-work W5 by letting the ATDD anti-enumeration test verify
-- the unknown-email path created NO row via a direct WHERE email = $1 query
-- (previously impossible without joining users, which the service writes
-- never created in the unknown-email case anyway).
--
-- Nullable for backfill safety; the service-layer write sets it on every
-- new row created in Story 1.5+.

ALTER TABLE password_resets ADD COLUMN email text;
CREATE INDEX idx_password_resets_email ON password_resets (email);

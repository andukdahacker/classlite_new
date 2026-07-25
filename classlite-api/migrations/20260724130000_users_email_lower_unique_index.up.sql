-- Story 2.7 code review (D3) — make users.email uniqueness case-insensitive.
--
-- The original idx_users_email was UNIQUE(email) on the raw string, so a
-- mixed-case account (e.g. an OAuth-created "Bob@X.com") did NOT collide with a
-- lowercased "bob@x.com". The bulk importer lowercases every address before
-- lookup, so GetUserByEmail could miss such an account and CreateUser would then
-- mint a duplicate users row for the same person. A functional unique index on
-- LOWER(email) enforces one account per address regardless of stored case, and
-- GetUserByEmail is switched to LOWER(email) = LOWER($1) in the same change.
--
-- If a pre-existing data set already contains case-duplicate emails this index
-- build will fail loudly (correct — the duplicates must be reconciled first).
DROP INDEX IF EXISTS idx_users_email;
CREATE UNIQUE INDEX idx_users_email ON users (LOWER(email));

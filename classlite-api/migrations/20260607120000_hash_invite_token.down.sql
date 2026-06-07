-- Down migration: restore invites.token (plaintext).
-- WARNING: the original raw tokens are unrecoverable after the up
-- migration. This down exists for migration-round-trip CI (R50);
-- production rollback would invalidate all in-flight invites.

ALTER TABLE invites ADD COLUMN token text;
-- Placeholder sentinel so the NOT NULL constraint holds. Any existing
-- invite becomes unredeemable after a down migration in prod.
UPDATE invites SET token = '__rollback_invalidated__' WHERE token IS NULL;
ALTER TABLE invites ALTER COLUMN token SET NOT NULL;
CREATE UNIQUE INDEX idx_invites_token ON invites (token);
DROP INDEX idx_invites_token_hash;
ALTER TABLE invites DROP COLUMN token_hash;

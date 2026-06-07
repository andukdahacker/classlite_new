-- Migration: hash_invite_token
-- Story 1.6 — replace invites.token (plaintext) with invites.token_hash
-- (sha256-hex). The raw token only ever exists in transit (HTTP body,
-- outgoing email body) and is reconstructable only by its bearer.
--
-- One-way migration: down recreates the `token` column but cannot rehydrate
-- the original raw tokens (they were never stored after this migration ran).
-- Production rollback would invalidate all in-flight invites — see
-- _bmad-output/implementation-artifacts/deferred-work.md.

ALTER TABLE invites ADD COLUMN token_hash text;
-- Idempotent backfill: if any invites exist with a non-null token column,
-- compute the sha256 so the migration is replayable in environments where
-- a partial rollout left rows behind.
UPDATE invites SET token_hash = encode(sha256(token::bytea), 'hex')
    WHERE token IS NOT NULL AND token_hash IS NULL;
ALTER TABLE invites ALTER COLUMN token_hash SET NOT NULL;
CREATE UNIQUE INDEX idx_invites_token_hash ON invites (token_hash);
DROP INDEX idx_invites_token;
ALTER TABLE invites DROP COLUMN token;

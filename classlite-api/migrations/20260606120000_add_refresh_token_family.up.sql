-- Migration: Story 1.5 Task 1 — refresh_tokens.remember_me + unique constraint.
--
-- Why remember_me: rotation must preserve the original session's TTL window
-- (7d default vs 30d Remember Me). Storing the kind on the row is the only
-- correct way — the raw token has no provenance once rotated.
--
-- Why a named UNIQUE CONSTRAINT (vs. the existing UNIQUE INDEX): a constraint
-- is a documented invariant of the table schema, surfaced in pg_constraint
-- and sqlc output, where duplicate token hashes are a serialization
-- invariant violation we want to fail loudly on. We attach the existing
-- idx_refresh_tokens_token_hash (a unique index since story 1.3) as the
-- backing index, so we don't double-index the column.

ALTER TABLE refresh_tokens
    ADD COLUMN remember_me boolean NOT NULL DEFAULT false;

ALTER TABLE refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_unique
    UNIQUE USING INDEX idx_refresh_tokens_token_hash;

-- Reverse Story 1.5 Task 1 — drop the constraint (which drops the backing
-- index), recreate the index under its original name to keep history clean,
-- then drop the remember_me column.

ALTER TABLE refresh_tokens
    DROP CONSTRAINT IF EXISTS refresh_tokens_token_hash_unique;

CREATE UNIQUE INDEX idx_refresh_tokens_token_hash ON refresh_tokens (token_hash);

ALTER TABLE refresh_tokens
    DROP COLUMN IF EXISTS remember_me;

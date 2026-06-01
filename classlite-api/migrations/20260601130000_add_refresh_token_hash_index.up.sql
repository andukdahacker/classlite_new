-- Add unique index on refresh_tokens.token_hash for point lookups
-- and to prevent duplicate token hashes (security invariant).
CREATE UNIQUE INDEX idx_refresh_tokens_token_hash ON refresh_tokens (token_hash);

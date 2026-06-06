-- Rename password_resets.token -> token_hash so the column stores
-- sha256(rawToken) instead of plaintext. Storing the raw value let any
-- DB dump / replica leak hijack an unused reset link directly.
--
-- The application layer hashes incoming tokens before lookup; the raw
-- token only ever exists in transit (HTTP body) and in the outgoing
-- email body.
ALTER TABLE password_resets RENAME COLUMN token TO token_hash;

-- Reverse of 20260724130000 — restore the case-sensitive unique index.
DROP INDEX IF EXISTS idx_users_email;
CREATE UNIQUE INDEX idx_users_email ON users (email);

DROP INDEX IF EXISTS idx_password_resets_email;
ALTER TABLE password_resets DROP COLUMN IF EXISTS email;

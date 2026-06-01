-- Reverse migration: drop all auth tables in dependency order.

DROP TABLE IF EXISTS invites;
DROP TABLE IF EXISTS password_resets;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS email_verifications;
DROP TABLE IF EXISTS center_members;
DROP TABLE IF EXISTS centers;
DROP TABLE IF EXISTS users;

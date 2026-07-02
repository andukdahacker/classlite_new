-- Migration: add_users_persona (down)

ALTER TABLE users DROP COLUMN IF EXISTS persona;

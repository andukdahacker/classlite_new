-- Migration: add_center_members_user_unique (down)

DROP INDEX IF EXISTS idx_center_members_user_id;

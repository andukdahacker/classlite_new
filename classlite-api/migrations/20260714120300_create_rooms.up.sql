-- Migration: create_rooms
-- Story 2.5b — tenant-scoped physical rooms catalog. Owner-managed.
--
-- Same 4-policy RLS pattern as terms + holidays. Additional: UNIQUE index
-- on `(center_id, LOWER(name))` enforces AC6 case-insensitive uniqueness
-- at the DB layer. Service maps SQLSTATE 23505 → RoomNameTakenError →
-- handler emits HTTP 409 ROOM_NAME_TAKEN.

CREATE TABLE rooms (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id   uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    description text        CHECK (description IS NULL OR length(description) <= 240),
    capacity    integer     NOT NULL CHECK (capacity BETWEEN 1 AND 500),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rooms_center_id ON rooms (center_id);
CREATE UNIQUE INDEX idx_rooms_center_name_ci
    ON rooms (center_id, LOWER(name));

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms FORCE ROW LEVEL SECURITY;

CREATE POLICY rooms_select ON rooms
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY rooms_insert ON rooms
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY rooms_update ON rooms
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY rooms_delete ON rooms
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

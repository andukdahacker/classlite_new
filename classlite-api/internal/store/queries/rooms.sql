-- Story 2.5b — rooms queries.
-- All queries run under RLS (rooms_select is tenant-scoped). AC6
-- UNIQUE(center_id, LOWER(name)) is enforced at index level — INSERT +
-- UPDATE raise SQLSTATE 23505 on case-insensitive duplicates; the service
-- catches *pgconn.PgError with Code=="23505" and maps to RoomNameTakenError.

-- name: ListRoomsByTenant :many
SELECT id, center_id, name, description, capacity, created_at
FROM rooms
ORDER BY name ASC, id ASC;

-- name: GetRoomByID :one
SELECT id, center_id, name, description, capacity, created_at
FROM rooms
WHERE id = $1;

-- name: CreateRoom :one
INSERT INTO rooms (id, center_id, name, description, capacity)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, center_id, name, description, capacity, created_at;

-- name: UpdateRoom :one
-- Partial update. description is the only nullable column — handler passes
-- through null via clear_fields to force NULL (mirrors centers.sql).
UPDATE rooms
SET name        = COALESCE(sqlc.narg('name'),     name),
    description = CASE
        WHEN 'description' = ANY(sqlc.arg('clear_fields')::text[]) THEN NULL
        ELSE COALESCE(sqlc.narg('description'), description)
    END,
    capacity    = COALESCE(sqlc.narg('capacity'), capacity)
WHERE id = $1
RETURNING id, center_id, name, description, capacity, created_at;

-- name: DeleteRoom :execrows
-- Story 3.2 planted marker (AC7): a future `sessions_rooms` FK will require
-- rejecting deletion of in-use rooms with 409 ROOM_IN_USE. v1 ships
-- unconditional delete.
DELETE FROM rooms
WHERE id = $1;

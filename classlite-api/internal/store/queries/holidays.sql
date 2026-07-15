-- Story 2.5b — holidays queries.
-- All queries run under RLS (holidays_select is tenant-scoped).

-- name: ListHolidaysByTenant :many
SELECT id, center_id, name, date, created_at
FROM holidays
ORDER BY date ASC, id ASC;

-- name: GetHolidayByID :one
SELECT id, center_id, name, date, created_at
FROM holidays
WHERE id = $1;

-- name: CreateHoliday :one
INSERT INTO holidays (id, center_id, name, date)
VALUES ($1, $2, $3, $4)
RETURNING id, center_id, name, date, created_at;

-- name: UpdateHoliday :one
-- Partial update; both name + date are NOT NULL columns so no clear_fields.
UPDATE holidays
SET name = COALESCE(sqlc.narg('name'), name),
    date = COALESCE(sqlc.narg('date'), date)
WHERE id = $1
RETURNING id, center_id, name, date, created_at;

-- name: DeleteHoliday :execrows
DELETE FROM holidays
WHERE id = $1;

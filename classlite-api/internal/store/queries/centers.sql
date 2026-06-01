-- name: GetCenterByID :one
SELECT id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at
FROM centers
WHERE id = $1;

-- name: CreateCenter :one
INSERT INTO centers (name, short_code)
VALUES ($1, $2)
RETURNING id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at;

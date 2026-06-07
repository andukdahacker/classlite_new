-- name: GetCenterByID :one
SELECT id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at
FROM centers
WHERE id = $1;

-- name: CreateCenter :one
INSERT INTO centers (name, short_code)
VALUES ($1, $2)
RETURNING id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at;

-- name: GetCenterByShortCode :one
-- Story 1.6 — used by HandleGoogleCallback to resolve a subdomain slug
-- to a center for the tenant-binding check (AC3). `centers` is a global
-- table (no RLS), so this runs from the unscoped session safely.
SELECT id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at
FROM centers
WHERE short_code = $1;

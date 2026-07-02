-- name: GetCenterByID :one
SELECT id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at
FROM centers
WHERE id = $1;

-- name: CreateCenter :one
INSERT INTO centers (name, short_code)
VALUES ($1, $2)
RETURNING id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at;

-- name: CreateCenterFull :one
-- Story 2.1 — INSERT with a pre-generated id (Task 7.2 flow: NewID() runs
-- BEFORE SET LOCAL app.current_tenant_id, so the tx-first-tenant-scoped-write
-- pattern works even if `centers` later gains RLS).
INSERT INTO centers (id, name, short_code, brand_color, logo_url)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at;

-- name: GetCenterByShortCode :one
-- Story 1.6 — used by HandleGoogleCallback to resolve a subdomain slug
-- to a center for the tenant-binding check (AC3). `centers` is a global
-- table (no RLS), so this runs from the unscoped session safely.
--
-- Case-insensitive lookup: Host headers can arrive mixed-case (RFC 3986
-- §3.2.2 says the host part is case-insensitive) and stored short_codes
-- may have any case. LOWER() on both sides keeps the comparison stable
-- regardless of how the operator seeded the row. A functional index
-- on (LOWER(short_code)) would speed this up if it ever becomes hot.
SELECT id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at
FROM centers
WHERE LOWER(short_code) = LOWER($1);

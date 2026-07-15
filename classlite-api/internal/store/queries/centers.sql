-- name: GetCenterByID :one
SELECT id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at, contact_email
FROM centers
WHERE id = $1;

-- name: CreateCenter :one
INSERT INTO centers (name, short_code)
VALUES ($1, $2)
RETURNING id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at, contact_email;

-- name: CreateCenterFull :one
-- Story 2.1 — INSERT with a pre-generated id (Task 7.2 flow: NewID() runs
-- BEFORE SET LOCAL app.current_tenant_id, so the tx-first-tenant-scoped-write
-- pattern works even if `centers` later gains RLS).
INSERT INTO centers (id, name, short_code, brand_color, logo_url)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at, contact_email;

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
SELECT id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at, contact_email
FROM centers
WHERE LOWER(short_code) = LOWER($1);

-- name: GetCenterByIDInTenant :one
-- Story 2-5a — Settings Profile tab fetch. Handler already asserts
-- {id} == tc.CenterID before calling; this method is the canonical read
-- from the settings service. `centers` is global-no-RLS, so tenant scope
-- is enforced at the handler layer (belt) and by passing tc.CenterID as
-- the parameter here (suspenders), per Winston-S3 fold.
SELECT id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at, contact_email
FROM centers
WHERE id = $1;

-- name: UpdateCenter :one
-- Story 2-5a — Settings Profile tab partial update. sqlc.narg() emits
-- pgtype.Text for text columns so "field absent" (Valid: false) is
-- distinct from "field cleared to empty string". COALESCE picks the
-- existing column value when the arg is Valid=false, so callers can
-- omit fields safely. shortCode is intentionally NOT updatable (AC3
-- read-only decision — changing it would break existing class codes).
--
-- D4 (2026-07-15 code review): the `clear_fields` text[] parameter carries
-- the wire-side "explicit null" signal for nullable columns. A field name
-- in the array forces that column to NULL, overriding both the COALESCE
-- and the caller's absent-narg. Handler translates JSON `null` on
-- contact_email / brand_color / logo_url into a membership add here.
-- Non-nullable columns (name, timezone) are not in the whitelist — the
-- handler rejects a null request for those with 422 before this query.
UPDATE centers
SET name          = COALESCE(sqlc.narg('name'),          name),
    contact_email = CASE
        WHEN 'contact_email' = ANY(sqlc.arg('clear_fields')::text[]) THEN NULL
        ELSE COALESCE(sqlc.narg('contact_email'), contact_email)
    END,
    brand_color   = CASE
        WHEN 'brand_color'   = ANY(sqlc.arg('clear_fields')::text[]) THEN NULL
        ELSE COALESCE(sqlc.narg('brand_color'),   brand_color)
    END,
    logo_url      = CASE
        WHEN 'logo_url'      = ANY(sqlc.arg('clear_fields')::text[]) THEN NULL
        ELSE COALESCE(sqlc.narg('logo_url'),      logo_url)
    END,
    timezone      = COALESCE(sqlc.narg('timezone'), timezone)
WHERE id = $1
RETURNING id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at, contact_email;

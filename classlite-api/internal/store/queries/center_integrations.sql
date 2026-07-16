-- Story 2.5c — center_integrations queries.
-- All queries run under RLS (center_integrations_select / _insert / _update
-- / _delete are tenant-scoped). UPSERT triggers UPDATE policy which enforces
-- WITH CHECK per AC6 — cross-tenant reparent-to-tenantB attempts are
-- rejected at the DB layer.
--
-- Encrypted token bytea columns never round-trip decrypted through sqlc;
-- see internal/service/integration_crypto.go for Seal/Open.

-- name: GetIntegration :one
SELECT id, center_id, provider, access_token_encrypted, refresh_token_encrypted,
       scope, expires_at, created_at, updated_at
FROM center_integrations
WHERE center_id = $1 AND provider = $2;

-- name: UpsertIntegration :one
-- Atomic upsert: initial connect INSERTs, reconnect (existing row) UPDATEs.
-- ON CONFLICT (center_id, provider) matches the UNIQUE index. UPDATE branch
-- refreshes tokens + scope + expires_at; created_at is preserved from the
-- original insert.
-- P7 fix (2026-07-16 code review): `(xmax = 0) AS was_inserted` — Postgres
-- idiom for distinguishing INSERT from ON CONFLICT UPDATE. xmax is the
-- deleting-tx id; for a fresh INSERT it's 0, for an UPDATE it's the current
-- tx id. Callers use this to record real pre-state in audit rows so a
-- reconnect doesn't look like a first-connect.
INSERT INTO center_integrations (
    center_id, provider, access_token_encrypted, refresh_token_encrypted,
    scope, expires_at
)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (center_id, provider) DO UPDATE
SET access_token_encrypted  = EXCLUDED.access_token_encrypted,
    refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
    scope                   = EXCLUDED.scope,
    expires_at              = EXCLUDED.expires_at,
    updated_at              = now()
RETURNING id, center_id, provider, access_token_encrypted, refresh_token_encrypted,
          scope, expires_at, created_at, updated_at, (xmax = 0) AS was_inserted;

-- name: DeleteIntegration :many
-- P6 fix (2026-07-16 code review): returns the deleted row's id (empty
-- slice on no-op) so Disconnect's audit LogWithinTx call references the
-- integration id (matching Connect's audit entity_id) instead of the
-- center id. `:many` keeps the sqlc-generated signature ergonomic —
-- callers check len==0 for "row already absent".
DELETE FROM center_integrations
WHERE center_id = $1 AND provider = $2
RETURNING id;

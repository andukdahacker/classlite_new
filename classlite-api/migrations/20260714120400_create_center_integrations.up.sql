-- Migration: create_center_integrations
-- Story 2.5c — per-center OAuth integrations catalog. First cross-tenant
-- OAuth token storage in the codebase. Provider column is CHECK-constrained
-- to the shipped set (google_meet only in v1); FU-2-5-D / FU-2-5-E amend
-- when Drive / Zoom ship.
--
-- UNIQUE (center_id, provider): one integration row per center per
-- provider — one Google account per center in v1 (multi-account v2+).
--
-- Tokens land encrypted at rest via AES-GCM sealed-box format (nonce
-- prepended; see internal/service/integration_crypto.go). Only the crypto
-- module ever touches plaintext.
--
-- Full 4-policy RLS per Winston-B2 + John ACCEPT — UPDATE policy carries
-- WITH CHECK explicitly to close the reparent-to-tenantB attack surface
-- (mirrors class_templates.up.sql:44-50 and rooms.up.sql:33-36).

CREATE TABLE center_integrations (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id               uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    provider                text        NOT NULL CHECK (provider IN ('google_meet')),
    access_token_encrypted  bytea       NOT NULL,
    refresh_token_encrypted bytea       NOT NULL,
    scope                   text        NOT NULL,
    expires_at              timestamptz NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (center_id, provider)
);

CREATE INDEX idx_center_integrations_center_id ON center_integrations (center_id);

ALTER TABLE center_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE center_integrations FORCE ROW LEVEL SECURITY;

CREATE POLICY center_integrations_select ON center_integrations
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY center_integrations_insert ON center_integrations
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY center_integrations_update ON center_integrations
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY center_integrations_delete ON center_integrations
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

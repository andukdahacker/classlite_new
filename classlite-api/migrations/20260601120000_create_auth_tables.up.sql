-- Migration: create_auth_tables
-- Creates core auth tables: users, centers, center_members,
-- email_verifications, refresh_tokens, password_resets, invites.
-- Enables RLS on tenant-scoped tables with null-safe policies.

-- ============================================================
-- 1. users (global — no RLS)
-- ============================================================
CREATE TABLE users (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email           text        NOT NULL,
    password_hash   text,
    full_name       text        NOT NULL,
    email_verified  boolean     NOT NULL DEFAULT false,
    avatar_url      text,
    language_pref   text        NOT NULL DEFAULT 'vi',
    google_id       text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_email     ON users (email);
CREATE UNIQUE INDEX idx_users_google_id ON users (google_id) WHERE google_id IS NOT NULL;

-- ============================================================
-- 2. centers (global — no RLS)
-- ============================================================
CREATE TABLE centers (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    text        NOT NULL,
    short_code              text        NOT NULL,
    brand_color             text,
    logo_url                text,
    timezone                text        NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    google_meet_connected   boolean     NOT NULL DEFAULT false,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_centers_short_code ON centers (short_code);

-- ============================================================
-- 3. center_members (RLS-enabled)
-- ============================================================
CREATE TABLE center_members (
    user_id     uuid        NOT NULL REFERENCES users (id),
    center_id   uuid        NOT NULL REFERENCES centers (id),
    role        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, center_id)
);

CREATE INDEX idx_center_members_center_id ON center_members (center_id);

ALTER TABLE center_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE center_members FORCE ROW LEVEL SECURITY;

CREATE POLICY center_members_tenant_isolation ON center_members
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY center_members_tenant_insert ON center_members
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ============================================================
-- 4. email_verifications (no RLS — scoped by user_id, not center_id)
--    These are pre-tenant-context operations. Isolation enforced
--    at the service layer, not via RLS.
-- ============================================================
CREATE TABLE email_verifications (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users (id),
    token       text        NOT NULL,
    expires_at  timestamptz NOT NULL,
    verified_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_email_verifications_token ON email_verifications (token);

-- ============================================================
-- 5. refresh_tokens
-- ============================================================
CREATE TABLE refresh_tokens (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users (id),
    token_hash  text        NOT NULL,
    family_id   uuid        NOT NULL,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user_id    ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_family_id  ON refresh_tokens (family_id);

-- ============================================================
-- 6. password_resets
-- ============================================================
CREATE TABLE password_resets (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users (id),
    token       text        NOT NULL,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_password_resets_token ON password_resets (token);

-- ============================================================
-- 7. invites (RLS-enabled)
-- ============================================================
CREATE TABLE invites (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id   uuid        NOT NULL REFERENCES centers (id),
    inviter_id  uuid        NOT NULL REFERENCES users (id),
    email       text        NOT NULL,
    name        text,
    role        text        NOT NULL,
    token       text        NOT NULL,
    expires_at  timestamptz NOT NULL,
    accepted_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_invites_token     ON invites (token);
CREATE INDEX idx_invites_center_id        ON invites (center_id);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites FORCE ROW LEVEL SECURITY;

CREATE POLICY invites_tenant_isolation ON invites
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY invites_tenant_insert ON invites
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

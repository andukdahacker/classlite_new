-- Migration: create_template_sessions
-- Story 2.2 — session plan rows for class templates.
--
-- Denormalized `center_id` column (nullable, mirrors parent's tenancy for
-- RLS locality). Kept in sync with parent via a BEFORE INSERT OR UPDATE OF
-- template_id trigger — the trigger's post-execute value is re-checked by
-- WITH CHECK on the RLS UPDATE policy (Murat-M-B1 load-bearing R1 discharge).
--
-- Filed FU-2-2-A for a periodic drift audit.

CREATE TABLE template_sessions (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id    uuid         NOT NULL REFERENCES class_templates (id) ON DELETE CASCADE,
    center_id      uuid         REFERENCES centers (id),
    session_order  integer      NOT NULL,
    title          text         NOT NULL,
    description    text,
    created_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_template_sessions_template_id ON template_sessions (template_id);

-- Trigger: copy parent's center_id into template_sessions.center_id at
-- INSERT or when template_id changes on UPDATE. Runs SECURITY DEFINER so the
-- parent lookup bypasses the caller's RLS scope — otherwise an attacker
-- planting a session under another tenant's parent template would trip on
-- the RLS SELECT (parent invisible → NULL result → WITH CHECK rejection),
-- but the same rejection surfaces via WITH CHECK anyway. SECURITY DEFINER
-- makes the trigger deterministic and avoids the "parent looks NULL because
-- RLS made it invisible" foot-gun for future maintainers.
CREATE OR REPLACE FUNCTION sync_template_sessions_center_id()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
BEGIN
    SELECT center_id INTO NEW.center_id
    FROM class_templates
    WHERE id = NEW.template_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_template_sessions_center_id
    BEFORE INSERT OR UPDATE OF template_id ON template_sessions
    FOR EACH ROW
    EXECUTE FUNCTION sync_template_sessions_center_id();

ALTER TABLE template_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_sessions FORCE ROW LEVEL SECURITY;

-- Same four-policy shape as class_templates (dual-scope on read, tenant-only
-- on write). WITH CHECK on INSERT + UPDATE closes the parent-mismatch attack
-- vector once the trigger has run.
CREATE POLICY template_sessions_select ON template_sessions
    FOR SELECT
    USING (center_id IS NULL
        OR center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY template_sessions_insert ON template_sessions
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY template_sessions_update ON template_sessions
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY template_sessions_delete ON template_sessions
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

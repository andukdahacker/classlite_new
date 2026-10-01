-- Migration: create_center_resource_baselines
-- Story 9.2a (AC21/D13 — FU-9-1-GRANDFATHER, carry-in P2) — the per-(center, resource_class)
-- high-water baseline captured at the moment enforcement arms. 9-1a shipped only the plain
-- `currentCount >= planMax` gate and deferred the softer "remove some, then re-add up to the
-- prior high-water level" refinement to the arming story. With a baseline row present the
-- Check* gates block a create iff `currentCount >= max(planMax, high_water_count)` — a
-- downgraded-then-trimmed center can re-add up to where it was, never above. currentCount is
-- ALWAYS a live COUNT under the lock (never a stored counter — the 9-1a D20 rule); this table
-- stores only the frozen ceiling, not a running count.
--
-- resource_class reuses the billing_service advisory-lock namespace (seat=1, class=2,
-- enrollment=3). PK (center_id, resource_class): one baseline per resource per center. RLS
-- tenant-scoped (SELECT/INSERT/UPDATE — an arm re-capture may raise the ceiling).

CREATE TABLE center_resource_baselines (
    center_id        uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    resource_class   smallint    NOT NULL,
    high_water_count integer     NOT NULL,
    captured_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (center_id, resource_class)
);

ALTER TABLE center_resource_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE center_resource_baselines FORCE ROW LEVEL SECURITY;

CREATE POLICY center_resource_baselines_select ON center_resource_baselines
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY center_resource_baselines_insert ON center_resource_baselines
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY center_resource_baselines_update ON center_resource_baselines
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

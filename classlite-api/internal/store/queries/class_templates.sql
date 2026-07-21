-- Story 2.2 + 3.3 — class_templates queries.
--
-- All queries run under RLS. The class_templates_select policy is dual-scope
-- (system seeds visible to every tenant + own tenant's rows), and the
-- INSERT/UPDATE/DELETE policies are tenant-scoped-only. GetTemplateByID
-- returns pgx.ErrNoRows when the caller can't see the row (RLS invisibility),
-- which the service maps to model.NotFoundError → 404 TEMPLATE_NOT_FOUND.
--
-- Story 3.3 soft-delete (SEC-9 amendment, Ducdo 2026-07-20): the SELECT RLS
-- policy stays 2.2 tenant-scope-only; the `deleted_at IS NULL` hide-filter lives
-- in the read queries below (List/GetByID). A policy-level filter would make the
-- soft-delete UPDATE illegal for the tenant role (PG rejects a non-owner UPDATE
-- whose new row falls out of the SELECT policy). usedCount is a per-row
-- correlated COUNT over classes.template_id — RLS auto-scopes classes to the
-- caller's tenant, so a shared system seed reports each tenant's own count
-- (PERF-2: one SQL aggregate, no N+1 Go loop).

-- name: ListAccessibleTemplates :many
-- System seeds first (by insertion order — deterministic via seed migration),
-- then center-owned custom templates by created_at DESC. Sort key
-- `(center_id IS NOT NULL) ASC` puts NULL center_ids first. `id ASC` is the
-- final tiebreaker so seed rows (which share migration timestamp) sort
-- deterministically across runs (C1-01 review fix). Soft-deleted rows excluded.
SELECT ct.id, ct.center_id, ct.name, ct.target_band, ct.primary_skill,
       ct.session_count, ct.color, ct.created_at,
       (SELECT count(*) FROM classes c WHERE c.template_id = ct.id) AS used_count
FROM class_templates ct
WHERE ct.deleted_at IS NULL
ORDER BY (ct.center_id IS NOT NULL) ASC, ct.created_at DESC, ct.id ASC;

-- name: GetTemplateByID :one
-- RLS handles scope — invisible template returns pgx.ErrNoRows. Soft-deleted
-- rows are excluded here (query-level SEC-9 filter) so a deleted id → 404.
SELECT ct.id, ct.center_id, ct.name, ct.target_band, ct.primary_skill,
       ct.session_count, ct.color, ct.created_at,
       (SELECT count(*) FROM classes c WHERE c.template_id = ct.id) AS used_count
FROM class_templates ct
WHERE ct.id = $1 AND ct.deleted_at IS NULL;

-- name: CreateCustomTemplate :one
-- Caller runs under SET LOCAL app.current_tenant_id → RLS INSERT WITH CHECK
-- constrains center_id to the caller's tenant.
INSERT INTO class_templates (id, center_id, name, target_band, primary_skill, session_count, color)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, center_id, name, target_band, primary_skill, session_count, color, created_at;

-- name: UpdateTemplate :one
-- Full scalar update (Story 3.3 AC4). session_count is DERIVED by the service
-- (len(sessions)) and passed in. RLS UPDATE policy scopes to the tenant; a
-- system seed (center_id NULL) or cross-tenant row matches 0 rows → ErrNoRows
-- (the service's pre-fetch already distinguishes seed-403 from cross-tenant-404).
-- `deleted_at IS NULL` guard keeps an archived row un-editable.
UPDATE class_templates
SET name = $2, target_band = $3, primary_skill = $4, session_count = $5,
    color = $6, updated_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING id, center_id, name, target_band, primary_skill, session_count, color, created_at, updated_at;

-- name: SoftDeleteTemplate :one
-- Sets deleted_at (Story 3.3 AC4 soft delete). RLS DELETE... this is an UPDATE
-- so the UPDATE policy scopes it to the tenant. Idempotent on `deleted_at IS NULL`
-- so a second delete → ErrNoRows. RETURNING id lets the service detect a no-op.
UPDATE class_templates
SET deleted_at = now(), updated_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING id;

-- name: DeleteTemplateSessionsByTemplateID :exec
-- Clears a template's session set for the PUT full-replace path. RLS scopes to
-- the tenant; the parent template's tenant-ownership was already verified.
DELETE FROM template_sessions WHERE template_id = $1;

-- name: CreateTemplateSession :one
-- BEFORE trigger `sync_template_sessions_center_id` copies parent's
-- center_id into row.center_id before WITH CHECK evaluates; callers pass
-- NULL for the row's own center_id and let the trigger reconcile.
-- Story 3.3 adds duration_minutes (nullable).
INSERT INTO template_sessions (id, template_id, center_id, session_order, title, description, duration_minutes)
VALUES ($1, $2, NULL, $3, $4, $5, $6)
RETURNING id, template_id, center_id, session_order, title, description, duration_minutes, created_at;

-- name: ListTemplateSessionsByTemplateID :many
-- Ordered by session_order so the wizard can render the plan predictably.
-- Story 3.3 returns duration_minutes for the detail view + picker preview.
SELECT id, template_id, center_id, session_order, title, description, duration_minutes, created_at
FROM template_sessions
WHERE template_id = $1
ORDER BY session_order ASC;

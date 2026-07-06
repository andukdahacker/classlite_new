-- Story 2.2 — class_templates queries.
--
-- All queries run under RLS. The class_templates_select policy is dual-scope
-- (system seeds visible to every tenant + own tenant's rows), and the
-- INSERT/UPDATE/DELETE policies are tenant-scoped-only. GetTemplateByID
-- returns pgx.ErrNoRows when the caller can't see the row (RLS invisibility),
-- which the service maps to model.NotFoundError → 404 TEMPLATE_NOT_FOUND.

-- name: ListAccessibleTemplates :many
-- System seeds first (by insertion order — deterministic via seed migration),
-- then center-owned custom templates by created_at DESC. Sort key
-- `(center_id IS NOT NULL) ASC` puts NULL center_ids first. `id ASC` is the
-- final tiebreaker so seed rows (which share migration timestamp) sort
-- deterministically across runs (C1-01 review fix — was `created_at ASC` which
-- put oldest custom templates first, contradicting AC1's DESC contract).
SELECT id, center_id, name, target_band, primary_skill, session_count, color, created_at
FROM class_templates
ORDER BY (center_id IS NOT NULL) ASC, created_at DESC, id ASC;

-- name: GetTemplateByID :one
-- RLS handles scope — invisible template returns pgx.ErrNoRows.
SELECT id, center_id, name, target_band, primary_skill, session_count, color, created_at
FROM class_templates
WHERE id = $1;

-- name: CreateCustomTemplate :one
-- Caller runs under SET LOCAL app.current_tenant_id → RLS INSERT WITH CHECK
-- constrains center_id to the caller's tenant.
INSERT INTO class_templates (id, center_id, name, target_band, primary_skill, session_count, color)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, center_id, name, target_band, primary_skill, session_count, color, created_at;

-- name: CreateTemplateSession :one
-- BEFORE trigger `sync_template_sessions_center_id` copies parent's
-- center_id into row.center_id before WITH CHECK evaluates; callers pass
-- NULL for the row's own center_id and let the trigger reconcile.
INSERT INTO template_sessions (id, template_id, center_id, session_order, title, description)
VALUES ($1, $2, NULL, $3, $4, $5)
RETURNING id, template_id, center_id, session_order, title, description, created_at;

-- name: ListTemplateSessionsByTemplateID :many
-- Ordered by session_order so the wizard can render the plan predictably.
SELECT id, template_id, center_id, session_order, title, description, created_at
FROM template_sessions
WHERE template_id = $1
ORDER BY session_order ASC;

-- Migration: add_template_management_columns
-- Story 3.3 — template CRUD lifecycle columns on class_templates.
--
-- Adds `updated_at` (mutation audit timestamp, symmetric with classes) and
-- `deleted_at` (soft-delete marker — DELETE /api/templates/{id} sets this
-- instead of hard-deleting so spawned classes keep their template_id
-- provenance and the "used N times" history survives).
--
-- SEC-9 (query-level, not policy-level): soft-deleted rows are hidden by an
-- `AND deleted_at IS NULL` predicate in the read QUERIES (ListAccessibleTemplates,
-- GetTemplateByID), NOT in the SELECT RLS policy. Rationale — under PostgreSQL
-- RLS a non-owner UPDATE is rejected when the new row would fall out of the
-- SELECT policy's USING set ("new row violates row-level security policy"), so a
-- policy-level `deleted_at IS NULL` filter makes the soft-delete UPDATE itself
-- impossible for the tenant role. Query-level filtering hides deleted rows on
-- every read while leaving the tenant-scoped write policies intact. See the
-- SEC-9 amendment in docs/project-context.md and the story Change Log.
-- Never editing the 2.2 migration (WF-2) — this is a new pair.

ALTER TABLE class_templates
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN deleted_at timestamptz;

-- Migration: add_class_crud_columns
-- Story 3.1 — completes the DELIBERATELY PARTIAL classes table shipped by
-- Story 2.2. Adds the columns the full class lifecycle + CRUD needs:
--   description, capacity, due_dates_enabled, updated_at, end_date, color.
--
-- Notes:
--   • due_dates_enabled ships OFF by default (AC3) — enabling is an explicit PATCH.
--   • updated_at DEFAULT now() fires on INSERT only. Every UpdateClass /
--     UpdateClassStatus query MUST `SET updated_at = now()` explicitly in the
--     query body (no trigger — keeps the write path greppable).
--   • end_date carries NO cross-field validation in 3.1 (may precede start;
--     independent of due_dates_enabled) — deliberate.
--   • classes_capacity_positive CHECK is REQUIRED (AC1): capacity > 0 when set.
--   • Columns only — RLS policies and indexes from 20260703120200 are unaffected.
--   • Never edit the 2.2 create_classes migration (WF-2).

ALTER TABLE classes
    ADD COLUMN description       text,
    ADD COLUMN capacity          integer,
    ADD COLUMN due_dates_enabled boolean     NOT NULL DEFAULT false,
    ADD COLUMN updated_at        timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN end_date          date,
    ADD COLUMN color             text,
    ADD CONSTRAINT classes_capacity_positive CHECK (capacity IS NULL OR capacity > 0);

-- Rollback: seed_class_templates
--
-- Delete by fixed UUID only — user-added rows (different UUIDs) are unaffected.
-- template_sessions rows cascade through class_templates FK on the delete.

ALTER TABLE class_templates    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE template_sessions  NO FORCE ROW LEVEL SECURITY;

DELETE FROM class_templates WHERE id IN (
    '11111111-2222-3333-4444-555555555501',
    '11111111-2222-3333-4444-555555555502',
    '11111111-2222-3333-4444-555555555503',
    '11111111-2222-3333-4444-555555555504',
    '11111111-2222-3333-4444-555555555505'
);

ALTER TABLE template_sessions  FORCE ROW LEVEL SECURITY;
ALTER TABLE class_templates    FORCE ROW LEVEL SECURITY;

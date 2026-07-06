-- Migration: seed_class_templates
-- Story 2.2 — five pre-built IELTS templates + 17 seed sessions.
--
-- Uses temporary NO FORCE ROW LEVEL SECURITY window (Amelia-A-B2 +
-- Winston-W-B2 fix) instead of SESSION AUTHORIZATION classlite (fragile in
-- Railway prod). ON CONFLICT (id) DO NOTHING makes re-runs idempotent.
--
-- C1-16 review policy — SEEDS ARE IMMUTABLE. `DO NOTHING` deliberately drops
-- content updates on the same UUID: if a future story needs to fix a typo in
-- a seed session title, ship a new migration that (a) DELETEs the old row
-- by fixed UUID then (b) INSERTs a new row with a NEW UUID. Do NOT convert
-- this to `DO UPDATE` — every tenant caches these UUIDs and mid-flight
-- content swaps cause confusing diffs in wizard drafts and audit trails.
--
-- Deterministic UUIDs (11111111-2222-3333-4444-5555555555XX) allow test
-- suites to reference specific seed rows. Down migration deletes by fixed
-- UUID only — user-added rows are untouched.

ALTER TABLE class_templates    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE template_sessions  NO FORCE ROW LEVEL SECURITY;

INSERT INTO class_templates (id, center_id, name, target_band, primary_skill, session_count, color) VALUES
    ('11111111-2222-3333-4444-555555555501', NULL, 'Writing Bootcamp 6.5',            6.5, 'writing',           12, '#f59e0b'),
    ('11111111-2222-3333-4444-555555555502', NULL, 'Speaking Mastery 7+',             7.0, 'speaking',          12, '#3b82f6'),
    ('11111111-2222-3333-4444-555555555503', NULL, 'Foundation Listening + Reading',  5.5, 'listening_reading', 10, '#10b981'),
    ('11111111-2222-3333-4444-555555555504', NULL, 'Starter Band 5.5 All Skills',     5.5, 'all_skills',         8, '#8b5cf6'),
    ('11111111-2222-3333-4444-555555555505', NULL, 'Academic Reading 6.5',            6.5, 'reading',           10, '#14b8a6')
ON CONFLICT (id) DO NOTHING;

-- Seed sessions — 17 rows across the 5 templates. Session titles are
-- starter-kit stubs; full syllabus is deferred to FU-2-2-D (Epic 4).
-- Deterministic UUIDs so re-runs stay idempotent.
INSERT INTO template_sessions (id, template_id, session_order, title, description) VALUES
    -- Writing Bootcamp 6.5 (4 rows)
    ('22222222-2222-3333-4444-555555555511', '11111111-2222-3333-4444-555555555501', 0, 'Task 1 structure',              'Diagram, chart and process breakdowns.'),
    ('22222222-2222-3333-4444-555555555512', '11111111-2222-3333-4444-555555555501', 1, 'Task 2 argument essays',        'Building 4-paragraph opinion structures.'),
    ('22222222-2222-3333-4444-555555555513', '11111111-2222-3333-4444-555555555501', 2, 'Coherence & cohesion drills',   'Linkers and referencing exercises.'),
    ('22222222-2222-3333-4444-555555555514', '11111111-2222-3333-4444-555555555501', 3, 'Full mock test',                'Timed Writing Task 1 + Task 2.'),
    -- Speaking Mastery 7+ (4 rows)
    ('22222222-2222-3333-4444-555555555521', '11111111-2222-3333-4444-555555555502', 0, 'Part 1 warm-ups',               'Fluency-first everyday topics.'),
    ('22222222-2222-3333-4444-555555555522', '11111111-2222-3333-4444-555555555502', 1, 'Part 2 cue card fluency',       'Two-minute long-turn structure.'),
    ('22222222-2222-3333-4444-555555555523', '11111111-2222-3333-4444-555555555502', 2, 'Part 3 abstract answers',       'Extended discussion techniques.'),
    ('22222222-2222-3333-4444-555555555524', '11111111-2222-3333-4444-555555555502', 3, 'Full mock speaking',            'Timed 3-part Speaking simulation.'),
    -- Foundation Listening + Reading (3 rows)
    ('22222222-2222-3333-4444-555555555531', '11111111-2222-3333-4444-555555555503', 0, 'Listening section walkthrough', 'Sections 1-4 question types.'),
    ('22222222-2222-3333-4444-555555555532', '11111111-2222-3333-4444-555555555503', 1, 'Reading skimming + scanning',   'Speed reading techniques.'),
    ('22222222-2222-3333-4444-555555555533', '11111111-2222-3333-4444-555555555503', 2, 'Multi-section timing drill',    'Integrated LR timed practice.'),
    -- Starter Band 5.5 All Skills (3 rows)
    ('22222222-2222-3333-4444-555555555541', '11111111-2222-3333-4444-555555555504', 0, 'Diagnostic + goal setting',     'Baseline assessment and study plan.'),
    ('22222222-2222-3333-4444-555555555542', '11111111-2222-3333-4444-555555555504', 1, 'Grammar refresh',               'Core tense + conditional review.'),
    ('22222222-2222-3333-4444-555555555543', '11111111-2222-3333-4444-555555555504', 2, 'Vocabulary sprint',             'Band 5.5 lexical resource push.'),
    -- Academic Reading 6.5 (3 rows)
    ('22222222-2222-3333-4444-555555555551', '11111111-2222-3333-4444-555555555505', 0, 'Skimming for main ideas',       'Passage overview techniques.'),
    ('22222222-2222-3333-4444-555555555552', '11111111-2222-3333-4444-555555555505', 1, 'T/F/NG identification drills',  'Distinguishing false vs not given.'),
    ('22222222-2222-3333-4444-555555555553', '11111111-2222-3333-4444-555555555505', 2, 'Full-passage timed practice',   'Complete 3-passage simulation.')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE template_sessions  FORCE ROW LEVEL SECURITY;
ALTER TABLE class_templates    FORCE ROW LEVEL SECURITY;

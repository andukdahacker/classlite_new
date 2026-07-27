-- Reverse of 20260725120000_create_session_content.up.sql — drop policies,
-- then tables, in reverse creation order.

DROP POLICY IF EXISTS session_exercises_delete ON session_exercises;
DROP POLICY IF EXISTS session_exercises_update ON session_exercises;
DROP POLICY IF EXISTS session_exercises_insert ON session_exercises;
DROP POLICY IF EXISTS session_exercises_select ON session_exercises;

DROP POLICY IF EXISTS session_materials_delete ON session_materials;
DROP POLICY IF EXISTS session_materials_update ON session_materials;
DROP POLICY IF EXISTS session_materials_insert ON session_materials;
DROP POLICY IF EXISTS session_materials_select ON session_materials;

DROP POLICY IF EXISTS session_notes_delete ON session_notes;
DROP POLICY IF EXISTS session_notes_update ON session_notes;
DROP POLICY IF EXISTS session_notes_insert ON session_notes;
DROP POLICY IF EXISTS session_notes_select ON session_notes;

DROP TABLE IF EXISTS session_exercises;
DROP TABLE IF EXISTS session_materials;
DROP TABLE IF EXISTS session_notes;

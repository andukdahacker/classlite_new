-- Down: create_student_notes (Story 7.2a D7). Reverses the up exactly —
-- policies + table drop (policies and the index fall with the table, but the
-- explicit DROP POLICY keeps the reversal readable and order-safe).

DROP POLICY IF EXISTS student_notes_delete ON student_notes;
DROP POLICY IF EXISTS student_notes_update ON student_notes;
DROP POLICY IF EXISTS student_notes_insert ON student_notes;
DROP POLICY IF EXISTS student_notes_select ON student_notes;

DROP TABLE IF EXISTS student_notes;

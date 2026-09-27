-- Story 8.4a — global search (GET /api/search) SQL family (D2/D5/D7/D9/D10/D11).
-- ONE set-based :many per category (classes/students/exercises/assignments/files);
-- no per-hit subtitle lookup, no N+1 (PERF-2/R-5). Every query runs inside the
-- service's SET LOCAL app.current_tenant_id tx so RLS tenant-scopes each table
-- (GO-1/PERF-1); the explicit center_id predicate also keeps the tenant index
-- usable alongside the trigram GIN.
--
-- MATCHING (D2/D9): immutable_unaccent(<label>) ILIKE immutable_unaccent(@pattern)
-- filters via the functional gin_trgm_ops index; ORDER BY similarity(...) DESC
-- ranks the filtered rows. Both sides are unaccented so "Nguyen" matches "Nguyễn".
-- @pattern is the caller-escaped '%q%' (LIKE metacharacters neutralized in Go, D7);
-- @q is the RAW query bound only into similarity() (Murat B6). immutable_unaccent
-- leaves the '%'/'_'/'\' bytes untouched, so the escaped wildcards survive the wrap.
--
-- SCOPE (D5): two nullable nargs derived by service.searchScope —
--   @teacher_narg  NULL ⇒ owner/admin center-wide; set ⇒ teacher owns the resource.
--   @student_user  NULL ⇒ not a student; set ⇒ the student's active enrollment.
-- A student runs ONLY SearchClasses + SearchAssignments (the other three return
-- empty in the service — never sent NULL/NULL, R-2). LIMIT @result_limit is 6
-- (fetch one extra → hasMore, no second query, D6/Sally C1); the ,id tiebreak makes
-- the slice deterministic (AC4).

-- name: SearchClasses :many
SELECT c.id,
       c.name          AS title,
       c.primary_skill AS primary_skill,
       c.status        AS status
FROM classes c
WHERE c.center_id = sqlc.arg('center_id')
  AND immutable_unaccent(c.name) ILIKE immutable_unaccent(sqlc.arg('pattern'))
  AND (sqlc.narg('teacher_narg')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_narg')::uuid)
  AND (sqlc.narg('student_user')::uuid IS NULL OR EXISTS (
        SELECT 1 FROM enrollments e
        WHERE e.class_id = c.id
          AND e.student_id = sqlc.narg('student_user')::uuid
          AND e.status = 'active'
  ))
ORDER BY similarity(immutable_unaccent(c.name), immutable_unaccent(sqlc.arg('q'))) DESC, c.id ASC
LIMIT sqlc.arg('result_limit');

-- name: SearchStudents :many
-- Students are center_members(role='student', archived_at IS NULL) JOIN users;
-- users is GLOBAL/no-RLS so the center_members gate is what tenant-scopes the name
-- (R-1/Murat B5 — never query users alone). The class-name subtitle is a per-student
-- SCALAR string_agg in a LATERAL (D11/R-4) so a student in N classes is ONE row, not
-- N fan-out rows that would blow the LIMIT slice. Teacher scope: the student must be
-- actively enrolled in one of the teacher's OWN classes, and the subtitle lists only
-- those classes (mirrors students.sql). No @student_user branch — a student never
-- searches students (empty in the service).
SELECT u.id,
       u.full_name AS title,
       cls.class_names AS subtitle
FROM center_members cm
JOIN users u ON u.id = cm.user_id
LEFT JOIN LATERAL (
    -- string_agg returns NULL when the student has no scoped active enrollment;
    -- left uncast so sqlc emits a nil-safe []byte the service maps to *string (a
    -- ::text cast would mislead sqlc into a non-null `string` that crashes on NULL).
    SELECT string_agg(c.name, ', ' ORDER BY c.name) AS class_names
    FROM enrollments e
    JOIN classes c ON c.id = e.class_id
    WHERE e.student_id = u.id
      AND e.status = 'active'
      -- Explicit center_id (belt-and-suspenders, matching every other predicate in
      -- this file) — RLS already tenant-scopes classes, but a multi-center student's
      -- subtitle must never risk listing another center's class names on RLS alone.
      AND c.center_id = sqlc.arg('center_id')
      AND (sqlc.narg('teacher_narg')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_narg')::uuid)
) cls ON true
WHERE cm.center_id = sqlc.arg('center_id')
  AND cm.role = 'student'
  AND cm.archived_at IS NULL
  AND immutable_unaccent(u.full_name) ILIKE immutable_unaccent(sqlc.arg('pattern'))
  AND (sqlc.narg('teacher_narg')::uuid IS NULL OR EXISTS (
        SELECT 1 FROM enrollments e2
        JOIN classes c2 ON c2.id = e2.class_id
        WHERE e2.student_id = u.id
          AND e2.status = 'active'
          AND c2.teacher_id = sqlc.narg('teacher_narg')::uuid
  ))
ORDER BY similarity(immutable_unaccent(u.full_name), immutable_unaccent(sqlc.arg('q'))) DESC, u.id ASC
LIMIT sqlc.arg('result_limit');

-- name: SearchExercises :many
-- Soft-delete filtered (R-7). Teacher scope = created_by. No @student_user branch
-- (a student never searches exercises). subtitle = skill (NOT NULL).
SELECT e.id,
       e.title AS title,
       e.skill AS skill
FROM exercises e
WHERE e.center_id = sqlc.arg('center_id')
  AND e.deleted_at IS NULL
  AND immutable_unaccent(e.title) ILIKE immutable_unaccent(sqlc.arg('pattern'))
  AND (sqlc.narg('teacher_narg')::uuid IS NULL OR e.created_by = sqlc.narg('teacher_narg')::uuid)
ORDER BY similarity(immutable_unaccent(e.title), immutable_unaccent(sqlc.arg('q'))) DESC, e.id ASC
LIMIT sqlc.arg('result_limit');

-- name: SearchAssignments :many
-- Assignments have no own label — the searched title is the JOINed exercises.title,
-- so the trigram index used is idx_exercises_title_trgm THROUGH the join (Murat C3).
-- The join carries `exercises.deleted_at IS NULL` so an assignment whose exercise was
-- soft-deleted never surfaces via a tombstoned title (D10/R-7). class_id → item.classId
-- (the FE deep-link key, D10). Teacher scope = classes.teacher_id; student scope =
-- active enrollment in the assignment's class.
SELECT a.id,
       e.title  AS title,
       e.skill  AS exercise_skill,
       cls.name AS class_name,
       a.class_id AS class_id
FROM assignments a
JOIN exercises e ON e.id = a.exercise_id
JOIN classes cls ON cls.id = a.class_id
WHERE a.center_id = sqlc.arg('center_id')
  AND e.deleted_at IS NULL
  AND immutable_unaccent(e.title) ILIKE immutable_unaccent(sqlc.arg('pattern'))
  AND (sqlc.narg('teacher_narg')::uuid IS NULL OR cls.teacher_id = sqlc.narg('teacher_narg')::uuid)
  AND (sqlc.narg('student_user')::uuid IS NULL OR EXISTS (
        SELECT 1 FROM enrollments e2
        WHERE e2.class_id = a.class_id
          AND e2.student_id = sqlc.narg('student_user')::uuid
          AND e2.status = 'active'
  ))
ORDER BY similarity(immutable_unaccent(e.title), immutable_unaccent(sqlc.arg('q'))) DESC, a.id ASC
LIMIT sqlc.arg('result_limit');

-- name: SearchFiles :many
-- Knowledge Hub files. Soft-delete filtered (R-7). Teacher scope = uploaded_by. No
-- @student_user branch (a student never searches files). subtitle = folder name (or
-- content_type fallback, composed in Go); the FE route key is the SLUG, not the id.
SELECT f.id,
       f.name         AS title,
       f.slug         AS slug,
       f.content_type AS content_type,
       fld.name       AS folder_name
FROM files f
LEFT JOIN folders fld ON fld.id = f.folder_id
WHERE f.center_id = sqlc.arg('center_id')
  AND f.deleted_at IS NULL
  AND immutable_unaccent(f.name) ILIKE immutable_unaccent(sqlc.arg('pattern'))
  AND (sqlc.narg('teacher_narg')::uuid IS NULL OR f.uploaded_by = sqlc.narg('teacher_narg')::uuid)
ORDER BY similarity(immutable_unaccent(f.name), immutable_unaccent(sqlc.arg('q'))) DESC, f.id ASC
LIMIT sqlc.arg('result_limit');

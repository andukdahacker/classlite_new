-- Story 4.1 — exercise library queries. RLS scopes center_id on every
-- statement; center_id is set DIRECTLY from tc.CenterID on insert (never a
-- trigger — GO-1) so the INSERT satisfies the WITH CHECK policy. Every read
-- filters `deleted_at IS NULL` (soft-delete; the archive/restore UI is Epic 10).
--
-- List vs detail split (Winston #2): the list/count pair computes
-- section/question counts in SQL (jsonb_array_length + a lateral aggregate) and
-- NEVER selects the raw `content` blob — the hottest endpoint stays off the
-- per-row unmarshal path. The single-row reads (Get/Create/Update) DO return
-- `content` + `schema_version`; the service runs the full typed dispatch there.
--
-- GO-7 EXCEPTION (Story 4.5, Task 7 — closes FU-4-1-A): the section/question
-- COUNT expressions below (`jsonb_array_length(content->'sections')` and the
-- lateral `->'questionGroups'->'questions'` aggregate) are a SECOND, UN-LADDERED
-- reader of the blob shape — they bypass model.MigrateJSONB and assume the v1
-- layout. That is valid ONLY while every row is v1. This is the one sanctioned
-- exception to GO-7 (shape-dependent SQL over versioned JSONB). See
-- docs/jsonb-schema-migration.md: any such reader must be inventoried when a
-- version bumps.
-- TRIPWIRE: when a v2 RESHAPES sections/questionGroups/questions, these counts
-- silently go wrong. At that point they MUST branch on schema_version or fall
-- back to app-side counting via the laddered ExerciseContent.{Section,Question}Count.
-- The regression guard is exercise_jsonb_count_tripwire_test.go (SQL count ==
-- Go laddered count for v1) — it fails the day the shapes diverge.

-- name: NextExerciseCode :one
-- Monotonic per-(center,skill) sequence for the EX-<L><NNN> code. A counter row
-- (not derive-from-rows) is gap-tolerant and never reuses a retired code under
-- soft/hard delete + retry storms (Winston #1). The ON CONFLICT DO UPDATE is
-- atomic + row-locked per (center_id, skill) pair, so N concurrent creates get N
-- distinct sequences. center_id comes straight from tc.CenterID (GO-1); the RLS
-- WITH CHECK rejects a spoofed value.
INSERT INTO exercise_code_counters (center_id, skill, next_seq)
VALUES (sqlc.arg('center_id'), sqlc.arg('skill'), 1)
ON CONFLICT (center_id, skill)
    DO UPDATE SET next_seq = exercise_code_counters.next_seq + 1
RETURNING next_seq;

-- name: CreateExercise :one
INSERT INTO exercises (
    id, center_id, created_by, code, title, description,
    skill, tags, target_band, content, schema_version
)
VALUES (
    sqlc.arg('id'), sqlc.arg('center_id'), sqlc.arg('created_by'), sqlc.arg('code'),
    sqlc.arg('title'), sqlc.arg('description'), sqlc.arg('skill'), sqlc.arg('tags'),
    sqlc.arg('target_band'), sqlc.arg('content'), sqlc.arg('schema_version')
)
RETURNING id, center_id, created_by, code, title, description, skill, tags,
          target_band, content, schema_version, deleted_at, created_at, updated_at;

-- name: GetExerciseByID :one
-- RLS-scoped; a row in another tenant OR soft-deleted returns pgx.ErrNoRows → 404.
SELECT id, center_id, created_by, code, title, description, skill, tags,
       target_band, content, schema_version, deleted_at, created_at, updated_at
FROM exercises
WHERE id = sqlc.arg('id') AND deleted_at IS NULL;

-- name: ListExercises :many
-- Owner/admin scope (AC8) — ALL center exercises. Optional skill/tag/band
-- filters via sqlc.narg + the ($n IS NULL OR …) idiom. Section/question counts
-- are computed in SQL; the `content` blob is NOT selected (Winston #2). Sorted
-- last-modified-descending (AC2 default). Pagination via LIMIT/OFFSET (XL-2).
SELECT e.id, e.center_id, e.created_by, e.code, e.title, e.description, e.skill,
       e.tags, e.target_band, e.schema_version, e.deleted_at, e.created_at, e.updated_at,
       COALESCE(jsonb_array_length(e.content->'sections'), 0)::int AS section_count,
       (
           SELECT COALESCE(SUM(jsonb_array_length(COALESCE(qg.value->'questions', '[]'::jsonb))), 0)::int
           FROM jsonb_array_elements(COALESCE(e.content->'sections', '[]'::jsonb)) AS s(value)
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.value->'questionGroups', '[]'::jsonb)) AS qg(value)
       ) AS question_count,
       (lk.present IS NOT NULL)::boolean AS locked
FROM exercises e
LEFT JOIN LATERAL (
    -- FR-23 (AC16): cheap lock probe — does ANY assignment on this exercise carry
    -- a submission? Single LATERAL LIMIT 1, never a per-row EXISTS (Winston #2).
    SELECT 1 AS present
    FROM assignments a
    JOIN submissions su ON su.assignment_id = a.id
    WHERE a.exercise_id = e.id
    LIMIT 1
) lk ON true
WHERE e.deleted_at IS NULL
  AND (sqlc.narg('skill')::text IS NULL OR e.skill = sqlc.narg('skill')::text)
  AND (sqlc.narg('tag')::text IS NULL OR e.tags @> ARRAY[sqlc.narg('tag')::text])
  AND (sqlc.narg('target_band')::numeric IS NULL OR e.target_band = sqlc.narg('target_band')::numeric)
ORDER BY e.updated_at DESC, e.id DESC
LIMIT sqlc.arg('page_limit') OFFSET sqlc.arg('page_offset');

-- name: ListExercisesByTeacher :many
-- Teacher scope (AC8) — ONLY exercises the caller authored (created_by = $).
-- Identical filter/sort/pagination shape to ListExercises (kept a reviewed pair
-- so the WHERE clauses never drift — Winston/Murat).
SELECT e.id, e.center_id, e.created_by, e.code, e.title, e.description, e.skill,
       e.tags, e.target_band, e.schema_version, e.deleted_at, e.created_at, e.updated_at,
       COALESCE(jsonb_array_length(e.content->'sections'), 0)::int AS section_count,
       (
           SELECT COALESCE(SUM(jsonb_array_length(COALESCE(qg.value->'questions', '[]'::jsonb))), 0)::int
           FROM jsonb_array_elements(COALESCE(e.content->'sections', '[]'::jsonb)) AS s(value)
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.value->'questionGroups', '[]'::jsonb)) AS qg(value)
       ) AS question_count,
       (lk.present IS NOT NULL)::boolean AS locked
FROM exercises e
LEFT JOIN LATERAL (
    -- FR-23 (AC16): cheap lock probe — does ANY assignment on this exercise carry
    -- a submission? Single LATERAL LIMIT 1, never a per-row EXISTS (Winston #2).
    SELECT 1 AS present
    FROM assignments a
    JOIN submissions su ON su.assignment_id = a.id
    WHERE a.exercise_id = e.id
    LIMIT 1
) lk ON true
WHERE e.deleted_at IS NULL
  AND e.created_by = sqlc.arg('created_by')
  AND (sqlc.narg('skill')::text IS NULL OR e.skill = sqlc.narg('skill')::text)
  AND (sqlc.narg('tag')::text IS NULL OR e.tags @> ARRAY[sqlc.narg('tag')::text])
  AND (sqlc.narg('target_band')::numeric IS NULL OR e.target_band = sqlc.narg('target_band')::numeric)
ORDER BY e.updated_at DESC, e.id DESC
LIMIT sqlc.arg('page_limit') OFFSET sqlc.arg('page_offset');

-- name: CountExercises :one
-- Owner/admin filtered total for pagination meta. IDENTICAL filter predicates to
-- ListExercises so `total`/`totalPages` reflect the filtered set (Murat).
SELECT COUNT(*)::bigint AS total
FROM exercises e
WHERE e.deleted_at IS NULL
  AND (sqlc.narg('skill')::text IS NULL OR e.skill = sqlc.narg('skill')::text)
  AND (sqlc.narg('tag')::text IS NULL OR e.tags @> ARRAY[sqlc.narg('tag')::text])
  AND (sqlc.narg('target_band')::numeric IS NULL OR e.target_band = sqlc.narg('target_band')::numeric);

-- name: CountExercisesByTeacher :one
SELECT COUNT(*)::bigint AS total
FROM exercises e
WHERE e.deleted_at IS NULL
  AND e.created_by = sqlc.arg('created_by')
  AND (sqlc.narg('skill')::text IS NULL OR e.skill = sqlc.narg('skill')::text)
  AND (sqlc.narg('tag')::text IS NULL OR e.tags @> ARRAY[sqlc.narg('tag')::text])
  AND (sqlc.narg('target_band')::numeric IS NULL OR e.target_band = sqlc.narg('target_band')::numeric);

-- name: CountPerSkill :many
-- Per-skill totals for the count-tab strip (AC1). Owner/admin scope (all rows).
-- Honors the tag/band filters (the skill tabs are the skill switcher, so they
-- never self-filter on skill) so a tag filter narrows the strip consistently
-- with the table.
SELECT skill, COUNT(*)::bigint AS total
FROM exercises
WHERE deleted_at IS NULL
  AND (sqlc.narg('tag')::text IS NULL OR tags @> ARRAY[sqlc.narg('tag')::text])
  AND (sqlc.narg('target_band')::numeric IS NULL OR target_band = sqlc.narg('target_band')::numeric)
GROUP BY skill;

-- name: CountPerSkillByTeacher :many
-- Per-skill totals scoped to the caller's own exercises (teacher scope, AC1/AC8).
SELECT skill, COUNT(*)::bigint AS total
FROM exercises
WHERE deleted_at IS NULL AND created_by = sqlc.arg('created_by')
  AND (sqlc.narg('tag')::text IS NULL OR tags @> ARRAY[sqlc.narg('tag')::text])
  AND (sqlc.narg('target_band')::numeric IS NULL OR target_band = sqlc.narg('target_band')::numeric)
GROUP BY skill;

-- name: UpdateExercise :one
-- Full-replace of the mutable fields (CR-3-5-4 documented semantics). `code`
-- stays immutable (server-authoritative). `schema_version` is now stamped to the
-- server-authoritative CURRENT version on every save (Story 4.5 AC1 write-back):
-- the body still cannot smuggle it (the service passes the constant, not a
-- request field), but a row read at an OLDER version is re-marshaled at current
-- and its column advanced in this SAME single UPDATE — no separate eager-rewrite
-- pass. For a v1-at-current row the value is unchanged (byte-identical behavior).
-- Optimistic-concurrency precondition (co-developed for 4.2 autosave): the WHERE
-- binds `updated_at = precondition` so a stale precondition matches 0 rows →
-- pgx.ErrNoRows, which the service maps to 409 CONFLICT (never a silent
-- last-writer-wins clobber). `deleted_at IS NULL` excludes soft-deleted rows.
UPDATE exercises
SET title = sqlc.arg('title'),
    description = sqlc.arg('description'),
    skill = sqlc.arg('skill'),
    tags = sqlc.arg('tags'),
    target_band = sqlc.arg('target_band'),
    content = sqlc.arg('content'),
    schema_version = sqlc.arg('schema_version'),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND deleted_at IS NULL
  AND updated_at = sqlc.arg('precondition_updated_at')
RETURNING id, center_id, created_by, code, title, description, skill, tags,
          target_band, content, schema_version, deleted_at, created_at, updated_at;

-- name: SoftDeleteExercise :one
-- Soft-delete (AC5): stamp deleted_at once. A missing/already-deleted row
-- returns 0 rows (pgx.ErrNoRows) → 404. RETURNING id so the caller can
-- distinguish "deleted now" from "nothing to delete".
UPDATE exercises
SET deleted_at = now()
WHERE id = sqlc.arg('id') AND deleted_at IS NULL
RETURNING id;

-- Story 5.1 FR-23 exercise lock (AC15–17). The guard + the detail payload. Both
-- run inside a tenant tx; the request-path start-submission and exercise-edit
-- paths take pg_advisory_xact_lock(hashtext(exercise_id)) around these to close
-- the create-during-PATCH TOCTOU (D10). NOT the batch-tool xmin path.

-- name: ExerciseIsLocked :one
-- Cheap guard used by the Update/SoftDelete write paths: true iff >= 1 submission
-- exists against any assignment on this exercise (any status, incl. in_progress).
SELECT EXISTS (
    SELECT 1
    FROM assignments a
    JOIN submissions su ON su.assignment_id = a.id
    WHERE a.exercise_id = sqlc.arg('exercise_id')
) AS locked;

-- name: GetExerciseLockedBy :many
-- Detail-only lockedBy payload (AC16/D9): one row per blocking assignment with its
-- class name + a representative attempt state (in_progress if any attempt is
-- in-flight, else submitted). a.created_at is functionally dependent on the grouped
-- PK a.id, so ordering by it is legal.
SELECT a.id AS assignment_id,
       c.name AS class_name,
       CASE WHEN bool_or(su.status = 'in_progress') THEN 'in_progress' ELSE 'submitted' END::text AS attempt_state
FROM assignments a
JOIN classes c ON c.id = a.class_id
JOIN submissions su ON su.assignment_id = a.id
WHERE a.exercise_id = sqlc.arg('exercise_id')
GROUP BY a.id, c.name
ORDER BY a.created_at;

-- name: GetExerciseContentByID :one
-- Internal content/settings read for the submission flow (time-budget math, AC10).
-- NO deleted_at filter: an assignment may reference a since-soft-deleted exercise
-- and the in-flight attempt still needs its time-limit settings.
SELECT content, schema_version, deleted_at
FROM exercises
WHERE id = sqlc.arg('id');

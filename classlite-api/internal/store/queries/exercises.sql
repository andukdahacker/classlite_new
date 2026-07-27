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
       ) AS question_count
FROM exercises e
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
       ) AS question_count
FROM exercises e
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
-- Full-replace of the mutable fields (CR-3-5-4 documented semantics). NEVER
-- touches schema_version or code — both are server-authoritative/immutable
-- (AC4). Optimistic-concurrency precondition (co-developed for 4.2 autosave):
-- the WHERE binds `updated_at = precondition` so a stale precondition matches 0
-- rows → pgx.ErrNoRows, which the service maps to 409 CONFLICT (never a silent
-- last-writer-wins clobber). `deleted_at IS NULL` excludes soft-deleted rows.
UPDATE exercises
SET title = sqlc.arg('title'),
    description = sqlc.arg('description'),
    skill = sqlc.arg('skill'),
    tags = sqlc.arg('tags'),
    target_band = sqlc.arg('target_band'),
    content = sqlc.arg('content'),
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

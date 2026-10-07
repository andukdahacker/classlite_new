-- Story 10.2 — Archive read model. ONE role-scoped, honestly-DB-paginated read
-- over the REVERSED filters of the shipped library/class reads (DD1):
--   - archived exercises ≡ exercises.deleted_at IS NOT NULL  (inverse of
--     exercises.sql:59 `ListExercises`, which filters deleted_at IS NULL)
--   - archived classes   ≡ classes.status='ended' AND ended_at <= @cutoff
--     (the 30-day grace anchored on the 10.2 ended_at column; cf. classes.sql:26)
--
-- Role scope is a SERVICE invariant, NOT RLS (DD5): two teachers in one center
-- share center_id, so RLS does not isolate them — each branch binds its own
-- per-teacher predicate to @teacher_id (NULL = owner/admin center-wide). Both
-- branches ride the existing classes/exercises FORCE-RLS grids for the tenant
-- boundary. A UNION ALL with one outer ORDER BY / LIMIT / OFFSET paginates
-- honestly at the DB (one coherent total), sidestepping the 10-1c two-source
-- pager incoherence. @type_filter ('' | 'exercise' | 'class') gates a branch.

-- name: ListArchive :many
SELECT type, id, title, subtitle, archived_at, class_status, skill, target_band
FROM (
    SELECT 'exercise'::text          AS type,
           e.id                      AS id,
           e.title                   AS title,
           e.code                    AS subtitle,
           e.deleted_at              AS archived_at,
           NULL::text                AS class_status,
           -- skill stays a plain (NOT NULL) text column across the UNION: the
           -- exercise projects its real enum value, the class projects '' (the
           -- class branch below). sqlc infers a UNION column's type/nullability
           -- from the FIRST branch, so a NULL here would have forced an untyped
           -- interface{}; '' is unambiguous because skill is a non-empty CHECK
           -- enum — the service maps '' → null on the wire.
           e.skill                   AS skill,
           e.target_band             AS target_band
    FROM exercises e
    WHERE e.deleted_at IS NOT NULL
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR e.created_by = sqlc.narg('teacher_id')::uuid)
      AND (sqlc.arg('type_filter')::text = '' OR sqlc.arg('type_filter')::text = 'exercise')
    UNION ALL
    SELECT 'class'::text             AS type,
           c.id                      AS id,
           c.name                    AS title,
           ''::text                  AS subtitle,
           c.ended_at                AS archived_at,
           c.status                  AS class_status,
           ''::text                  AS skill,
           NULL::numeric             AS target_band
    FROM classes c
    WHERE c.status = 'ended'
      AND c.ended_at IS NOT NULL
      AND c.ended_at <= sqlc.arg('cutoff')
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id')::uuid)
      AND (sqlc.arg('type_filter')::text = '' OR sqlc.arg('type_filter')::text = 'class')
) archive
ORDER BY archived_at DESC, id DESC
LIMIT sqlc.arg('page_limit') OFFSET sqlc.arg('page_offset');

-- name: CountArchive :one
-- Mirrors the two WHEREs of ListArchive so total/totalPages reflect the honest
-- union (and the active ?type filter).
SELECT count(*)::bigint AS total
FROM (
    SELECT e.id
    FROM exercises e
    WHERE e.deleted_at IS NOT NULL
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR e.created_by = sqlc.narg('teacher_id')::uuid)
      AND (sqlc.arg('type_filter')::text = '' OR sqlc.arg('type_filter')::text = 'exercise')
    UNION ALL
    SELECT c.id
    FROM classes c
    WHERE c.status = 'ended'
      AND c.ended_at IS NOT NULL
      AND c.ended_at <= sqlc.arg('cutoff')
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id')::uuid)
      AND (sqlc.arg('type_filter')::text = '' OR sqlc.arg('type_filter')::text = 'class')
) archive;

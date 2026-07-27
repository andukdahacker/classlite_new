-- Story 3.5 — session content queries (notes, materials, exercises). RLS scopes
-- center_id on every statement; these queries filter on session_id (list) or id
-- (mutate). center_id is set DIRECTLY from tc.CenterID on insert (never a
-- trigger) so the INSERT satisfies the WITH CHECK policy. There is NO
-- `starts_at >= now_floor` term here — content is teacher documentation and is
-- addable on past AND cancelled sessions (unlike the 3.4 scheduling mutations).

-- name: ListSessionNotesBySession :many
SELECT id, center_id, session_id, body, author_id, created_at, updated_at
FROM session_notes
WHERE session_id = $1
ORDER BY created_at ASC;

-- name: CreateSessionNote :one
INSERT INTO session_notes (id, center_id, session_id, body, author_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, center_id, session_id, body, author_id, created_at, updated_at;

-- name: UpdateSessionNote :one
-- RLS scopes center; the (id, session_id) pair guards against editing a note
-- through a sibling session the caller lacks scope on. pgx.ErrNoRows → 404.
UPDATE session_notes
SET body = sqlc.arg('body'),
    updated_at = now()
WHERE id = sqlc.arg('id') AND session_id = sqlc.arg('session_id')
RETURNING id, center_id, session_id, body, author_id, created_at, updated_at;

-- name: DeleteSessionNote :one
-- RETURNING id so a missing row maps to 404 (not a silent 0-row delete).
DELETE FROM session_notes
WHERE id = sqlc.arg('id') AND session_id = sqlc.arg('session_id')
RETURNING id;

-- name: ListSessionMaterialsBySession :many
SELECT id, center_id, session_id, title, url, kind, created_at, updated_at
FROM session_materials
WHERE session_id = $1
ORDER BY created_at ASC;

-- name: CreateSessionMaterial :one
INSERT INTO session_materials (id, center_id, session_id, title, url, kind)
VALUES ($1, $2, $3, $4, $5, 'link')
RETURNING id, center_id, session_id, title, url, kind, created_at, updated_at;

-- name: UpdateSessionMaterial :one
UPDATE session_materials
SET title = sqlc.arg('title'),
    url = sqlc.arg('url'),
    updated_at = now()
WHERE id = sqlc.arg('id') AND session_id = sqlc.arg('session_id')
RETURNING id, center_id, session_id, title, url, kind, created_at, updated_at;

-- name: DeleteSessionMaterial :one
DELETE FROM session_materials
WHERE id = sqlc.arg('id') AND session_id = sqlc.arg('session_id')
RETURNING id;

-- name: ListSessionExercisesBySession :many
SELECT id, center_id, session_id, title, instructions, link, created_at, updated_at
FROM session_exercises
WHERE session_id = $1
ORDER BY created_at ASC;

-- name: CreateSessionExercise :one
INSERT INTO session_exercises (id, center_id, session_id, title, instructions, link)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, center_id, session_id, title, instructions, link, created_at, updated_at;

-- name: UpdateSessionExercise :one
UPDATE session_exercises
SET title = sqlc.arg('title'),
    instructions = sqlc.narg('instructions'),
    link = sqlc.narg('link'),
    updated_at = now()
WHERE id = sqlc.arg('id') AND session_id = sqlc.arg('session_id')
RETURNING id, center_id, session_id, title, instructions, link, created_at, updated_at;

-- name: DeleteSessionExercise :one
DELETE FROM session_exercises
WHERE id = sqlc.arg('id') AND session_id = sqlc.arg('session_id')
RETURNING id;

-- Story 7.2a (D7/D8) — student_notes: staff-authored notes on a student, with
-- flagging + soft-delete (attachments jsonb ships but stays empty — D8). Every
-- query runs inside a SET LOCAL app.current_tenant_id tx so RLS tenant-scopes the
-- rows; the explicit center_id predicate is belt-and-suspenders (mirrors
-- staff.sql / attendance.sql).

-- name: InsertStudentNote :one
-- Create a note (AC12). author_id = caller; flagged defaults false; attachments
-- stays '[]' (D8). center_id comes straight from tc.CenterID (GO-1); the RLS
-- INSERT WITH CHECK rejects a spoofed value.
INSERT INTO student_notes (center_id, student_id, author_id, content, flagged)
VALUES (
    sqlc.arg('center_id'),
    sqlc.arg('student_id'),
    sqlc.arg('author_id'),
    sqlc.arg('content'),
    sqlc.arg('flagged')
)
RETURNING id, center_id, student_id, author_id, content, flagged, attachments,
          created_at, updated_at, deleted_at;

-- name: ListStudentNotes :many
-- Chronological (ASC) non-deleted notes for a student (AC13), joined to users for
-- the author display name so the log renders without a second call.
SELECT
    sn.id, sn.center_id, sn.student_id, sn.author_id, sn.content, sn.flagged,
    sn.attachments, sn.created_at, sn.updated_at, sn.deleted_at,
    au.full_name AS author_name
FROM student_notes sn
JOIN users au ON au.id = sn.author_id
WHERE sn.center_id = sqlc.arg('center_id')
  AND sn.student_id = sqlc.arg('student_id')
  AND sn.deleted_at IS NULL
ORDER BY sn.created_at ASC, sn.id ASC;

-- name: GetStudentNote :one
-- Single non-deleted note for the author-or-owner delete guard (D11/AC14) and
-- flag re-read. pgx.ErrNoRows for a deleted / cross-tenant / unknown note.
SELECT id, center_id, student_id, author_id, content, flagged, attachments,
       created_at, updated_at, deleted_at
FROM student_notes
WHERE center_id = sqlc.arg('center_id')
  AND id = sqlc.arg('note_id')
  AND deleted_at IS NULL;

-- name: SetStudentNoteFlag :one
-- Toggle the flag (AC14). updated_at is set explicitly (no trigger). center_id +
-- deleted_at guard so a cross-tenant or already-deleted note is a no-row no-op
-- (pgx.ErrNoRows → 404 in the service).
UPDATE student_notes
SET flagged = sqlc.arg('flagged'), updated_at = now()
WHERE center_id = sqlc.arg('center_id')
  AND id = sqlc.arg('note_id')
  AND deleted_at IS NULL
RETURNING id, center_id, student_id, author_id, content, flagged, attachments,
          created_at, updated_at, deleted_at;

-- name: SoftDeleteStudentNote :execrows
-- Soft-delete (AC14). WHERE deleted_at IS NULL makes a double-delete a 0-row
-- no-op; RLS + center_id scope the write, so a cross-tenant delete is a 0-row
-- no-op (the row is invisible under the attacker's GUC) — AC15 write-isolation.
UPDATE student_notes
SET deleted_at = now(), updated_at = now()
WHERE center_id = sqlc.arg('center_id')
  AND id = sqlc.arg('note_id')
  AND deleted_at IS NULL;

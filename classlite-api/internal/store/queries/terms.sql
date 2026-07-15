-- Story 2.5b — terms queries.
--
-- All queries run under RLS — the terms_select policy is tenant-scoped, so
-- no WHERE center_id filter is required. Caller MUST have set
-- app.current_tenant_id via TxManager before invoking. `session_count` is
-- nullable at the DB layer (Owner may leave it blank until the schedule is
-- built out per Story 3.x).

-- name: ListTermsByTenant :many
SELECT id, center_id, name, start_date, end_date, session_count, created_at
FROM terms
ORDER BY start_date DESC, id ASC;

-- name: GetTermByID :one
-- RLS handles scope — invisible term returns pgx.ErrNoRows.
SELECT id, center_id, name, start_date, end_date, session_count, created_at
FROM terms
WHERE id = $1;

-- name: CreateTerm :one
-- Caller runs under SET LOCAL app.current_tenant_id → RLS INSERT WITH CHECK
-- constrains center_id to the caller's tenant.
INSERT INTO terms (id, center_id, name, start_date, end_date, session_count)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, center_id, name, start_date, end_date, session_count, created_at;

-- name: UpdateTerm :one
-- Partial update per Amelia-S5 pattern. sqlc.narg emits pgtype.Text /
-- pgtype.Date / pgtype.Int4 so absent (Valid: false) is distinct from
-- explicit set. Amended /bmad-code-review 2-5b Round 1 (2026-07-15) P12 —
-- session_count uses the clear_fields pattern (2-5a rooms.description
-- precedent) so wire-null (`{"sessionCount": null}`) can restore the column
-- to SQL NULL. Absent = no change; nullable narg = set value; clear_fields
-- containing 'session_count' = force NULL.
UPDATE terms
SET name          = COALESCE(sqlc.narg('name'),          name),
    start_date    = COALESCE(sqlc.narg('start_date'),    start_date),
    end_date      = COALESCE(sqlc.narg('end_date'),      end_date),
    session_count = CASE
                      WHEN 'session_count' = ANY(sqlc.arg('clear_fields')::text[]) THEN NULL
                      ELSE COALESCE(sqlc.narg('session_count'), session_count)
                    END
WHERE id = $1
RETURNING id, center_id, name, start_date, end_date, session_count, created_at;

-- name: DeleteTerm :execrows
-- Returns rows-affected so the service can distinguish "no such term" (0)
-- from "successfully deleted" (1). RLS silently returns 0 for out-of-tenant
-- ids, which the service maps to NotFoundError.
DELETE FROM terms
WHERE id = $1;

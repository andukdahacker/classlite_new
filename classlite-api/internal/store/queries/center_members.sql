-- name: GetCenterMemberByUserAndCenter :one
SELECT user_id, center_id, role, created_at
FROM center_members
WHERE user_id = $1 AND center_id = $2;

-- name: CreateCenterMember :one
INSERT INTO center_members (user_id, center_id, role)
VALUES ($1, $2, $3)
RETURNING user_id, center_id, role, created_at;

-- name: ListCenterMembersByCenter :many
SELECT user_id, center_id, role, created_at
FROM center_members
WHERE center_id = $1
ORDER BY created_at;

-- Story 7.4a — anchored Q&A queries. Two net-new tables, questions +
-- question_replies. RLS tenant-scopes every read/write; the ROLE→visibility
-- scoping that RLS cannot express (Q&A is teacher↔student only, Owner/Admin see
-- nothing) lives in the ...ForReader queries below, keyed on a DB-fetched
-- reader role (the service passes center_members.role, SEC-1 — never the JWT).

-- name: CreateQuestion :one
-- Ask path (AC4). exercise_id + class_id are DERIVED server-side from the
-- student's assignment (D3, SEC-7) — the client never sets them. anchor_ref is
-- the positional-path JSONB (NULL for anchor_type='exercise', per the coupling
-- CHECK); anchor_excerpt is the display snapshot (D2). status defaults 'open'.
INSERT INTO questions
    (id, center_id, exercise_id, class_id, student_id, anchor_type, anchor_ref, anchor_excerpt, content, status)
VALUES
    (sqlc.arg('id'), sqlc.arg('center_id'), sqlc.arg('exercise_id'), sqlc.arg('class_id'),
     sqlc.arg('student_id'), sqlc.arg('anchor_type'), sqlc.narg('anchor_ref'), sqlc.narg('anchor_excerpt'),
     sqlc.arg('content'), 'open')
RETURNING id, center_id, exercise_id, class_id, student_id, anchor_type, anchor_ref, anchor_excerpt,
          content, status, created_at, updated_at;

-- name: GetAssignmentForQuestion :one
-- Derive the class + exercise an ask targets, from the assignmentId the request
-- carries (D3). RLS tenant-scopes the read; ErrNoRows (a bogus or cross-tenant
-- assignment) → the service maps QUESTION_TARGET_NOT_FOUND (AC5 non-disclosure).
-- (Assignment lifecycle status is NOT a gate — attempt-ownership + active
-- enrollment suffice for v1; Ducdo D1 2026-09-10.)
SELECT class_id, exercise_id
FROM assignments
WHERE id = sqlc.arg('id');

-- name: StudentOwnsAttempt :one
-- Attempt-ownership gate for the ask path (AC4/AC5): the asking student must own
-- an attempt (submission) on the assignment. RLS tenant-scopes submissions.
SELECT EXISTS (
    SELECT 1 FROM submissions
    WHERE assignment_id = sqlc.arg('assignment_id') AND student_id = sqlc.arg('student_id')
) AS owns;

-- name: GetActiveEnrollmentForQuestion :one
-- Active-enrollment gate for the ask path (AC4) + a general "currently enrolled"
-- probe. Returns the enrollment id, or ErrNoRows if the student holds no active
-- enrollment in the class. (Distinct name from the 3.4.5 GetActiveEnrollment to
-- keep this story's queries self-contained.)
SELECT id FROM enrollments
WHERE class_id = sqlc.arg('class_id') AND student_id = sqlc.arg('student_id') AND status = 'active';

-- name: GetQuestionForAuthz :one
-- Reply/resolve authz read (AC8/AC11). Returns the question + its class's
-- teacher_id so the service can gate on "teaches this class". RLS scopes to the
-- tenant; ErrNoRows → QUESTION_NOT_FOUND. class_teacher_id is nullable (a class
-- with a pending teacher invite has teacher_id NULL).
SELECT q.id, q.center_id, q.exercise_id, q.class_id, q.student_id, q.anchor_type,
       q.anchor_ref, q.anchor_excerpt, q.content, q.status, q.created_at, q.updated_at,
       c.teacher_id AS class_teacher_id
FROM questions q
JOIN classes c ON c.id = q.class_id
WHERE q.id = sqlc.arg('id');

-- name: GetQuestionForReader :one
-- Single-thread read scope (AC6 GET /{id}). Role-scoped:
--   student ⇒ own questions, OR (7-4b AC5 widening, FU-7-4-E) a classmate with a
--             CURRENT active enrollment in q.class_id when the thread carries at
--             least one 'shared' reply — so a shared answer reaches the class,
--             while a personal-only or unanswered thread still 404s the non-asker
--             classmate (ListRepliesForReader then hands back the shared reply
--             only, never the personal ones — non-disclosure preserved);
--   teacher ⇒ own classes only;
--   owner/admin ⇒ 0 rows (ErrNoRows → 404 non-disclosure, R25/R26).
-- LEFT JOIN users denormalizes the asker's display name + avatar (D5).
SELECT q.id AS question_id, q.exercise_id, q.class_id, q.student_id, q.anchor_type,
       q.anchor_ref, q.anchor_excerpt, q.content, q.status, q.created_at,
       su.full_name AS student_name, su.avatar_url AS student_avatar_url
FROM questions q
LEFT JOIN users su ON su.id = q.student_id
WHERE q.center_id = sqlc.arg('center_id')
  AND q.id = sqlc.arg('question_id')
  AND (
      (sqlc.arg('reader_role')::text = 'student' AND (
          q.student_id = sqlc.arg('reader_id')
          OR (
              EXISTS (SELECT 1 FROM enrollments e
                      WHERE e.class_id = q.class_id
                        AND e.student_id = sqlc.arg('reader_id')
                        AND e.status = 'active')
              AND EXISTS (SELECT 1 FROM question_replies qr2
                          WHERE qr2.question_id = q.id AND qr2.visibility = 'shared')
          )
      ))
      OR
      (sqlc.arg('reader_role')::text = 'teacher'
       AND q.class_id IN (SELECT id FROM classes WHERE teacher_id = sqlc.arg('reader_id')))
  );

-- name: ListQuestionsForReader :many
-- The R25/R26 role-scope elision (AC6/AC7), encoded in SQL and keyed on the
-- DB-fetched reader role (SEC-1). student ⇒ own questions; teacher ⇒ questions
-- for classes they teach; owner/admin (any other role) ⇒ NEITHER branch matches
-- ⇒ 0 rows (never null, never error — the caller reaches the handler and gets an
-- empty envelope). exercise_id/class_id/status/unanswered are optional filters.
-- LEFT JOIN users denormalizes the asker's display name + avatar (D5).
SELECT q.id AS question_id, q.exercise_id, q.class_id, q.student_id, q.anchor_type,
       q.anchor_ref, q.anchor_excerpt, q.content, q.status, q.created_at,
       su.full_name AS student_name, su.avatar_url AS student_avatar_url
FROM questions q
LEFT JOIN users su ON su.id = q.student_id
WHERE q.center_id = sqlc.arg('center_id')
  AND (
      (sqlc.arg('reader_role')::text = 'student' AND q.student_id = sqlc.arg('reader_id'))
      OR
      (sqlc.arg('reader_role')::text = 'teacher'
       AND q.class_id IN (SELECT id FROM classes WHERE teacher_id = sqlc.arg('reader_id')))
  )
  AND (sqlc.narg('exercise_id')::uuid IS NULL OR q.exercise_id = sqlc.narg('exercise_id'))
  AND (sqlc.narg('class_id')::uuid IS NULL OR q.class_id = sqlc.narg('class_id'))
  AND (sqlc.narg('status')::text IS NULL OR q.status = sqlc.narg('status'))
  AND (sqlc.narg('unanswered')::bool IS NULL OR sqlc.narg('unanswered') = false OR q.status = 'open')
ORDER BY q.created_at DESC, q.id DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: CountQuestionsForReader :one
-- meta.total under the SAME scope + filters as ListQuestionsForReader (the count
-- must not leak either — owner/admin count = 0).
SELECT count(*)::bigint
FROM questions q
WHERE q.center_id = sqlc.arg('center_id')
  AND (
      (sqlc.arg('reader_role')::text = 'student' AND q.student_id = sqlc.arg('reader_id'))
      OR
      (sqlc.arg('reader_role')::text = 'teacher'
       AND q.class_id IN (SELECT id FROM classes WHERE teacher_id = sqlc.arg('reader_id')))
  )
  AND (sqlc.narg('exercise_id')::uuid IS NULL OR q.exercise_id = sqlc.narg('exercise_id'))
  AND (sqlc.narg('class_id')::uuid IS NULL OR q.class_id = sqlc.narg('class_id'))
  AND (sqlc.narg('status')::text IS NULL OR q.status = sqlc.narg('status'))
  AND (sqlc.narg('unanswered')::bool IS NULL OR sqlc.narg('unanswered') = false OR q.status = 'open');

-- name: CreateReply :one
-- Teacher reply insert (AC8). author_id = the replying teacher; center_id
-- denormalized from tc (GO-1). visibility is 'personal'|'shared' (D5).
INSERT INTO question_replies (id, center_id, question_id, author_id, content, visibility)
VALUES (sqlc.arg('id'), sqlc.arg('center_id'), sqlc.arg('question_id'),
        sqlc.arg('author_id'), sqlc.arg('content'), sqlc.arg('visibility'))
RETURNING id, center_id, question_id, author_id, content, visibility, created_at;

-- name: ResolveQuestion :execrows
-- One-way open→resolved (AC11). Matched on status='open' so a re-resolve is a
-- 0-row no-op (reopen is deferred, FU-7-4-D). Authz is enforced in the service
-- BEFORE this runs; RLS scopes to the tenant.
UPDATE questions
SET status = 'resolved', updated_at = now()
WHERE id = sqlc.arg('id') AND status = 'open';

-- name: ListRepliesForReader :many
-- Per-reply visibility scope (AC9/AC10), keyed on the DB-fetched reader role
-- (SEC-1). owner/admin ⇒ 0 rows regardless of visibility. For a student/teacher:
--   'shared'   ⇒ reader teaches q.class_id, OR reader is the asker (q.student_id),
--                OR reader has an ACTIVE enrollment in q.class_id (transfers
--                gain/lose access — scoped by CURRENT enrollment, not at-post-time);
--   'personal' ⇒ reader is the asker (q.student_id) OR the reply author
--                (qr.author_id) — a per-thread binding independent of who
--                currently teaches the class.
-- LEFT JOIN users denormalizes the reply author's display name + avatar (D5).
-- (Visibility branches UNCHANGED — 7-4b Task 1: only the author enrichment is new.)
SELECT qr.id AS reply_id, qr.question_id, qr.author_id, qr.content, qr.visibility, qr.created_at,
       au.full_name AS author_name, au.avatar_url AS author_avatar_url
FROM question_replies qr
JOIN questions q ON q.id = qr.question_id
LEFT JOIN users au ON au.id = qr.author_id
WHERE qr.center_id = sqlc.arg('center_id')
  AND qr.question_id = sqlc.arg('question_id')
  AND (sqlc.arg('reader_role')::text = 'student' OR sqlc.arg('reader_role')::text = 'teacher')
  AND (
      (qr.visibility = 'shared' AND (
          (sqlc.arg('reader_role')::text = 'teacher'
           AND EXISTS (SELECT 1 FROM classes c WHERE c.id = q.class_id AND c.teacher_id = sqlc.arg('reader_id')))
          OR q.student_id = sqlc.arg('reader_id')
          OR EXISTS (SELECT 1 FROM enrollments e
                     WHERE e.class_id = q.class_id AND e.student_id = sqlc.arg('reader_id') AND e.status = 'active')
      ))
      OR
      (qr.visibility = 'personal' AND (q.student_id = sqlc.arg('reader_id') OR qr.author_id = sqlc.arg('reader_id')))
  )
ORDER BY qr.created_at ASC, qr.id ASC;

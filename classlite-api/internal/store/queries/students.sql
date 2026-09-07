-- Story 7.2a — student roster read model + per-student detail composition.
-- Students are center_members rows with role='student' joined to users (there is
-- NO students table, D2). Every query runs inside a SET LOCAL app.current_tenant_id
-- tx so RLS tenant-scopes center_members / enrollments / classes / attendance /
-- submissions / grades (via current_grades, security_invoker); users is global but
-- only read for a userId already proven a center member.
--
-- Role-scope (D3, the R-SEC axis): teacher_id is a NULLABLE bound arg. NULL ⇒
-- center-wide (admin/owner); non-NULL ⇒ ONLY students with an active enrollment
-- in a class WHERE classes.teacher_id = teacher_id, and every aggregate is scoped
-- to the caller-visible classes. Clock windows use a BOUND @now arg (D4) — NEVER
-- SQL now() — so the injected fake clock drives the at-risk boundary reds.
--
-- Window sizes below (LIMIT 5 for overallBand, LIMIT 4 for the drop slice) mirror
-- the Go consts service.OverallBandWindow / service.AtRiskGradedWindow — the
-- roster param set is pinned by the ATDD red seam (no window arg), so these are
-- documented literals, not tunable args. The at-risk CLASSIFICATION thresholds
-- remain single-sourced in the AtRiskDetector consts.

-- name: ListStudents :many
-- The role-scoped, paginated student roster (AC1/AC2/AC5/D3/D10). One row per
-- role='student' center_members row of @center_id (teacher-scoped when
-- @teacher_id is set). Per-row aggregates are LATERAL subqueries keyed on u.id so
-- a student appears EXACTLY ONCE with true SUMs (no JOIN fan-out) and the service
-- batch-classifies the whole page from the at-risk INPUT columns — NO N+1 (D4).
SELECT
    u.id                                    AS student_id,
    u.full_name                             AS name,
    u.email                                 AS email,
    u.avatar_url                            AS avatar_url,
    cm.archived_at                          AS archived_at,
    cm.created_at                           AS joined_at,
    ec.enrolled_classes                     AS enrolled_classes,
    aec.active_enrollment_count::bigint     AS active_enrollment_count,
    ob.overall_band                         AS overall_band,
    ct.class_target_band                    AS class_target_band,
    att.present_late::bigint                AS attendance_present_late,
    att.total_marked::bigint                AS attendance_total_marked,
    miss.consecutive_missed::int            AS consecutive_missed,
    bands.recent_released_bands             AS recent_released_bands
FROM center_members cm
JOIN users u ON u.id = cm.user_id
LEFT JOIN LATERAL (
    SELECT COALESCE(
        jsonb_agg(jsonb_build_object(
            'classId', c.id,
            'className', c.name,
            'teacherId', c.teacher_id,
            'teacherName', tu.full_name
        ) ORDER BY c.name),
        '[]'::jsonb
    )::text AS enrolled_classes
    FROM enrollments e
    JOIN classes c ON c.id = e.class_id
    LEFT JOIN users tu ON tu.id = c.teacher_id
    WHERE e.student_id = u.id AND e.status = 'active'
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
) ec ON true
LEFT JOIN LATERAL (
    SELECT count(*) AS active_enrollment_count
    FROM enrollments e
    JOIN classes c ON c.id = e.class_id
    WHERE e.student_id = u.id AND e.status = 'active'
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
) aec ON true
LEFT JOIN LATERAL (
    SELECT max(c.target_band)::numeric AS class_target_band
    FROM enrollments e
    JOIN classes c ON c.id = e.class_id
    WHERE e.student_id = u.id AND e.status = 'active'
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
) ct ON true
LEFT JOIN LATERAL (
    SELECT avg(band)::numeric AS overall_band
    FROM (
        SELECT cg.overall_band AS band
        FROM current_grades cg
        JOIN submissions s ON s.id = cg.submission_id
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE s.student_id = u.id AND cg.released_at IS NOT NULL
          AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
        ORDER BY cg.released_at DESC, cg.id DESC
        LIMIT 5  -- service.OverallBandWindow
    ) last_n
) ob ON true
LEFT JOIN LATERAL (
    SELECT
        count(*) FILTER (WHERE a.status IN ('present','late')) AS present_late,
        count(*) AS total_marked
    FROM attendance a
    JOIN sessions sess ON sess.id = a.session_id
    JOIN classes c ON c.id = sess.class_id
    WHERE a.student_id = u.id
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
) att ON true
LEFT JOIN LATERAL (
    -- Leading run of the most-recent past-due assignments with no qualifying
    -- submission (D4 signal 2). MIN(rn) of the first non-missed row minus one =
    -- the leading run; all-missed ⇒ COUNT(*); none ⇒ 0.
    SELECT COALESCE(min(rn) FILTER (WHERE NOT missed) - 1, count(*))::int AS consecutive_missed
    FROM (
        SELECT
            (NOT EXISTS (
                SELECT 1 FROM submissions s
                WHERE s.assignment_id = a.id AND s.student_id = u.id
                  AND s.status IN ('submitted','ai_processing','graded')
            )) AS missed,
            row_number() OVER (ORDER BY a.deadline_at DESC, a.id) AS rn
        FROM assignments a
        JOIN enrollments e ON e.class_id = a.class_id AND e.student_id = u.id AND e.status = 'active'
        JOIN classes c ON c.id = a.class_id
        WHERE a.deadline_at <= sqlc.arg('now')
          AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
    ) ranked
) miss ON true
LEFT JOIN LATERAL (
    -- The last-4 released bands, CHRONOLOGICAL oldest→newest (D4 signal 3). The
    -- inner query takes the 4 most recent by released_at DESC; the outer agg
    -- re-orders ASC so first-of-4 minus last-of-4 is the downward slide.
    SELECT array_agg(band ORDER BY released_at ASC, id ASC)::float8[] AS recent_released_bands
    FROM (
        SELECT cg.overall_band::float8 AS band, cg.released_at, cg.id
        FROM current_grades cg
        JOIN submissions s ON s.id = cg.submission_id
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE s.student_id = u.id AND cg.released_at IS NOT NULL
          AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
        ORDER BY cg.released_at DESC, cg.id DESC
        LIMIT 4  -- service.AtRiskGradedWindow
    ) last4
) bands ON true
WHERE cm.center_id = sqlc.arg('center_id')
  AND cm.role = 'student'
  AND (sqlc.narg('teacher_id')::uuid IS NULL OR EXISTS (
        SELECT 1 FROM enrollments e
        JOIN classes c ON c.id = e.class_id
        WHERE e.student_id = u.id AND e.status = 'active' AND c.teacher_id = sqlc.narg('teacher_id')
  ))
  AND (sqlc.narg('class_id')::uuid IS NULL OR EXISTS (
        SELECT 1 FROM enrollments e2
        WHERE e2.student_id = u.id AND e2.class_id = sqlc.narg('class_id') AND e2.status = 'active'
  ))
ORDER BY u.full_name ASC, u.id ASC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: CountStudents :one
-- meta.total under the SAME role/class filter as ListStudents (D10).
SELECT count(*)::bigint AS total
FROM center_members cm
JOIN users u ON u.id = cm.user_id
WHERE cm.center_id = sqlc.arg('center_id')
  AND cm.role = 'student'
  AND (sqlc.narg('teacher_id')::uuid IS NULL OR EXISTS (
        SELECT 1 FROM enrollments e
        JOIN classes c ON c.id = e.class_id
        WHERE e.student_id = u.id AND e.status = 'active' AND c.teacher_id = sqlc.narg('teacher_id')
  ))
  AND (sqlc.narg('class_id')::uuid IS NULL OR EXISTS (
        SELECT 1 FROM enrollments e2
        WHERE e2.student_id = u.id AND e2.class_id = sqlc.narg('class_id') AND e2.status = 'active'
  ));

-- name: GetStudentMembership :one
-- Single student member of @center_id (B6/B7/D11). pgx.ErrNoRows for a
-- non-member / non-student → drives 404 STUDENT_NOT_FOUND (non-disclosure).
SELECT
    u.id            AS student_id,
    u.full_name     AS name,
    u.email         AS email,
    u.avatar_url    AS avatar_url,
    u.language_pref AS language_pref,
    cm.archived_at  AS archived_at,
    cm.created_at   AS joined_at
FROM center_members cm
JOIN users u ON u.id = cm.user_id
WHERE cm.center_id = sqlc.arg('center_id')
  AND cm.user_id = sqlc.arg('student_id')
  AND cm.role = 'student';

-- name: ListStudentEnrolledClasses :many
-- The student's active enrolled classes (detail D12), caller-visible-scoped.
-- Teacher-scope: @teacher_id NULL ⇒ all classes; set ⇒ only the teacher's. An
-- empty result for a teacher caller means the student is in none of their
-- classes → the service maps it to 404 STUDENT_NOT_FOUND (D11 non-disclosure).
SELECT
    c.id            AS class_id,
    c.name          AS class_name,
    tu.full_name    AS teacher_name,
    c.target_band   AS target_band
FROM enrollments e
JOIN classes c ON c.id = e.class_id
LEFT JOIN users tu ON tu.id = c.teacher_id
WHERE e.student_id = sqlc.arg('student_id') AND e.status = 'active'
  AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
ORDER BY c.name ASC;

-- name: StudentPerSkillBands :many
-- Per-skill band DERIVED via submission → assignments.exercise_id →
-- exercises.skill (D6 — NO stored per-skill column). Avg overall_band of the
-- student's RELEASED current grades grouped by skill; only skills with a graded
-- submission appear (the service surfaces just the 4 IELTS skills). @teacher_id
-- NULL ⇒ center-wide (the store red seam); set ⇒ caller-visible classes only.
SELECT
    ex.skill::text          AS skill,
    avg(cg.overall_band)::numeric AS avg_band
FROM current_grades cg
JOIN submissions s ON s.id = cg.submission_id
JOIN assignments a ON a.id = s.assignment_id
JOIN exercises ex ON ex.id = a.exercise_id
JOIN classes c ON c.id = a.class_id
WHERE s.student_id = sqlc.arg('student_id')
  AND s.center_id = sqlc.arg('center_id')
  AND cg.released_at IS NOT NULL
  AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
GROUP BY ex.skill;

-- name: GetStudentAttendanceStats :one
-- Attendance-rate inputs (D6/AC10): present+late vs total marked over the
-- student's caller-visible sessions. absent counts in the denominator only.
-- @teacher_id NULL ⇒ center-wide (the store red seam); set ⇒ teacher's classes.
SELECT
    count(*) FILTER (WHERE att.status IN ('present','late'))::bigint AS present_late,
    count(*)::bigint AS total_marked
FROM attendance att
JOIN sessions sess ON sess.id = att.session_id
JOIN classes c ON c.id = sess.class_id
WHERE att.student_id = sqlc.arg('student_id')
  AND att.center_id = sqlc.arg('center_id')
  AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'));

-- name: GetStudentSubmissionStats :one
-- onTime / pending / missing split (D12/AC10). All four counts gate on ONE
-- definition of "has a submission" (has_submission = status IN submitted/
-- ai_processing/graded) so submitted/on-time and pending/missing partition the
-- assignment set with no overlap. on-time = has_submission & submitted_at <=
-- deadline_at; pending = no submission & deadline in the future; missing = no
-- submission & past-due — split at the bound @now (D4). Caller-visible.
WITH visible_assignments AS (
    SELECT a.id, a.deadline_at
    FROM assignments a
    JOIN enrollments e ON e.class_id = a.class_id AND e.student_id = sqlc.arg('student_id') AND e.status = 'active'
    JOIN classes c ON c.id = a.class_id
    WHERE a.center_id = sqlc.arg('center_id')
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
),
sub AS (
    SELECT
        va.deadline_at,
        s.submitted_at,
        (s.id IS NOT NULL AND s.status IN ('submitted','ai_processing','graded')) AS has_submission
    FROM visible_assignments va
    LEFT JOIN submissions s ON s.assignment_id = va.id AND s.student_id = sqlc.arg('student_id')
)
SELECT
    count(*) FILTER (WHERE has_submission AND submitted_at IS NOT NULL AND submitted_at <= deadline_at)::bigint AS on_time_count,
    count(*) FILTER (WHERE has_submission)::bigint AS submitted_count,
    count(*) FILTER (WHERE NOT has_submission AND deadline_at > sqlc.arg('now'))::bigint AS pending_count,
    count(*) FILTER (WHERE NOT has_submission AND deadline_at <= sqlc.arg('now'))::bigint AS missing_count
FROM sub;

-- name: GetStudentAtRiskInputs :one
-- The single-student at-risk INPUT columns for the detail composition (D4/D12).
-- Mirrors the ListStudents LATERAL bodies for one student, caller-visible-scoped.
SELECT
    ob.overall_band                     AS overall_band,
    ct.class_target_band                AS class_target_band,
    miss.consecutive_missed::int        AS consecutive_missed,
    bands.recent_released_bands         AS recent_released_bands
FROM (SELECT sqlc.arg('student_id')::uuid AS student_id) base
LEFT JOIN LATERAL (
    SELECT avg(band)::numeric AS overall_band
    FROM (
        SELECT cg.overall_band AS band
        FROM current_grades cg
        JOIN submissions s ON s.id = cg.submission_id
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE s.student_id = base.student_id AND cg.released_at IS NOT NULL
          AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
        ORDER BY cg.released_at DESC, cg.id DESC
        LIMIT 5  -- service.OverallBandWindow
    ) last_n
) ob ON true
LEFT JOIN LATERAL (
    SELECT max(c.target_band)::numeric AS class_target_band
    FROM enrollments e
    JOIN classes c ON c.id = e.class_id
    WHERE e.student_id = base.student_id AND e.status = 'active'
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
) ct ON true
LEFT JOIN LATERAL (
    SELECT COALESCE(min(rn) FILTER (WHERE NOT missed) - 1, count(*))::int AS consecutive_missed
    FROM (
        SELECT
            (NOT EXISTS (
                SELECT 1 FROM submissions s
                WHERE s.assignment_id = a.id AND s.student_id = base.student_id
                  AND s.status IN ('submitted','ai_processing','graded')
            )) AS missed,
            row_number() OVER (ORDER BY a.deadline_at DESC, a.id) AS rn
        FROM assignments a
        JOIN enrollments e ON e.class_id = a.class_id AND e.student_id = base.student_id AND e.status = 'active'
        JOIN classes c ON c.id = a.class_id
        WHERE a.deadline_at <= sqlc.arg('now')
          AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
    ) ranked
) miss ON true
LEFT JOIN LATERAL (
    SELECT array_agg(band ORDER BY released_at ASC, id ASC)::float8[] AS recent_released_bands
    FROM (
        SELECT cg.overall_band::float8 AS band, cg.released_at, cg.id
        FROM current_grades cg
        JOIN submissions s ON s.id = cg.submission_id
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE s.student_id = base.student_id AND cg.released_at IS NOT NULL
          AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
        ORDER BY cg.released_at DESC, cg.id DESC
        LIMIT 4  -- service.AtRiskGradedWindow
    ) last4
) bands ON true;

-- name: GetStudentBandDelta :one
-- currentVsFirstDelta (D9): avg of the last OverallBandWindow released grades
-- minus avg of the student's first-month released grades. NULL when insufficient
-- data — fewer than 2 released grades → current_avg is NULL so the service maps
-- the whole delta to null (a lone grade is not a trend, D1 review ruling
-- 2026-09-07), never a misleading 0.0.
WITH released AS (
    SELECT cg.overall_band AS band, cg.released_at, cg.id
    FROM current_grades cg
    JOIN submissions s ON s.id = cg.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE s.student_id = sqlc.arg('student_id') AND cg.released_at IS NOT NULL
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
),
first_month AS (
    SELECT band FROM released
    WHERE released_at <= (SELECT min(released_at) FROM released) + interval '30 days'
),
last_n AS (
    SELECT band FROM released ORDER BY released_at DESC, id DESC LIMIT 5  -- service.OverallBandWindow
)
SELECT
    CASE WHEN (SELECT count(*) FROM released) >= 2
         THEN (SELECT avg(band) FROM last_n) END::numeric AS current_avg,
    (SELECT avg(band) FROM first_month)::numeric AS first_avg;

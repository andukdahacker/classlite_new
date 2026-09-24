-- Story 8.2a — analytics aggregates (D5/D8/D11, D13/D14/W2). Reads only; the
-- SECOND consumer of the 8-1a R31/PERF-2 keystone. Every class-perf aggregate is
-- ONE set-based query (GROUP BY week_start inside an already range-filtered set —
-- NEVER one query per week; W2). RLS (SET LOCAL app.current_tenant_id, set by the
-- service before the first current_grades touch) tenant-scopes every table; the
-- explicit center_id/class_id predicates also keep the tenant/class index usable
-- (AC16, no Seq Scan). Every list carries a total-order tiebreak.
--
-- Week bucketing (D8): the range filter stays SARGABLE on the raw column
-- (released_at >= @range_start AND < @range_end, UTC instants the service computes
-- in centers.timezone). Only the GROUP BY / SELECT week key uses
-- date_trunc('week', released_at AT TIME ZONE @tz) — Monday-anchored local week,
-- converted back to the absolute instant of local Monday-midnight so it matches the
-- Go-computed dense axis. @now / windows are ALWAYS bound args (D8), never SQL now().
--
-- Heatmap JSONB is TYPE-GUARDED (D13): a present-but-non-numeric criterion value
-- (""/"N/A"/holistic artifact) would throw 22P02 and 500 the whole heatmap on real
-- data. The CASE short-circuits the ::numeric cast so it is evaluated ONLY on
-- jsonb 'number' values; sample_count counts those survivors.
--
-- Mistake instanceCount derives student identity from submissions.student_id, NOT a
-- submission→enrollment inner join (D14): 7.3 transfer/withdraw means a student can
-- hold multiple enrollment rows per class; an inner join would multiply count(*).

-- name: GetClassForAnalytics :one
-- Class auth + display fields for the class-perf 404/scope check (D4/AC11-13).
-- pgx.ErrNoRows for a missing/cross-tenant class → 404 CLASS_NOT_FOUND
-- (non-disclosure). has_writing_content distinguishes "Writing class, no grades
-- yet" from "no Writing content" (DR-D) independent of released grades.
SELECT
    c.id           AS class_id,
    c.name         AS class_name,
    c.target_band  AS target_band,
    c.teacher_id   AS teacher_id,
    EXISTS (
        SELECT 1 FROM assignments a
        JOIN exercises ex ON ex.id = a.exercise_id
        WHERE a.class_id = c.id AND ex.skill = 'writing'
    ) AS has_writing_content
FROM classes c
WHERE c.id = sqlc.arg('class_id');

-- name: ListAnalyticsHomeClasses :many
-- The caller's analyzable class list + mini-stats (AC2/AC3). teacher_id narg NULL ⇒
-- center-wide (owner/admin); set ⇒ own classes only (teacher). Per-class aggregates
-- are LATERAL subqueries so each class appears exactly once with true counts (no JOIN
-- fan-out) — atRiskCount is computed separately (ListAnalyticsHomeAtRiskInputs) since
-- it is per-student grain. onTimeRate is derived in Go from on_time_count/total_due
-- (null when total_due = 0). Set-based, no per-class N+1 (W1/PERF-2).
SELECT
    c.id                    AS class_id,
    c.name                  AS class_name,
    sc.student_count::bigint AS student_count,
    ab.avg_band             AS avg_band,
    sr.on_time_count::bigint AS on_time_count,
    sr.total_due::bigint    AS total_due
FROM classes c
LEFT JOIN LATERAL (
    SELECT count(*) AS student_count
    FROM enrollments e WHERE e.class_id = c.id AND e.status = 'active'
) sc ON true
LEFT JOIN LATERAL (
    SELECT avg(cg.overall_band)::numeric AS avg_band
    FROM current_grades cg
    JOIN submissions s ON s.id = cg.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    WHERE a.class_id = c.id AND cg.released_at IS NOT NULL
) ab ON true
LEFT JOIN LATERAL (
    SELECT
        count(*) FILTER (
            WHERE sub.id IS NOT NULL
              AND sub.status IN ('submitted','ai_processing','graded')
              AND sub.submitted_at IS NOT NULL
              AND sub.submitted_at <= due.deadline_at
        ) AS on_time_count,
        count(*) AS total_due
    FROM (
        SELECT a.id AS assignment_id, a.deadline_at, e.student_id
        FROM assignments a
        JOIN enrollments e ON e.class_id = a.class_id AND e.status = 'active'
        WHERE a.class_id = c.id
          AND a.deadline_at <= sqlc.arg('now')      -- past-due only (never count not-yet-due)
          AND a.deadline_at >= e.enrolled_at        -- since the student enrolled (7.3 transfer-safe)
    ) due
    LEFT JOIN submissions sub ON sub.assignment_id = due.assignment_id AND sub.student_id = due.student_id
) sr ON true
WHERE c.center_id = sqlc.arg('center_id')
  AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
ORDER BY c.name ASC, c.id ASC
LIMIT sqlc.arg('class_limit');

-- name: ListAnalyticsHomeAtRiskInputs :many
-- One row per (class, active student) across the caller's analyzable classes, with
-- the class-scoped at-risk INPUT columns (mirrors ListClassStudentsAtRiskInputs but
-- returns class_id and spans the caller's classes). The service classifies the whole
-- set in Go via the reused AtRiskDetector (D5) and tallies atRiskCount per class — NO
-- per-class/per-student N+1 (W1). teacher_id narg = the home role scope.
-- PER-CLASS scan cap (scan_limit): the `capped` CTE takes each analyzable class and,
-- via a LATERAL, its first N active students by full_name — mirroring
-- ListClassStudentsAtRiskInputs' "first N by name" cap, so a class's atRiskCount
-- agrees between the home and the class endpoint (a plain global LIMIT would truncate
-- whole later classes and undercount them instead). The light CTE resolves the capped
-- (class, student) set first so the expensive at-risk LATERAL inputs below are
-- computed ONLY for the survivors.
WITH capped AS (
    SELECT cl.id AS cl_id, cl.id AS class_id, cl.target_band AS class_target_band, top.student_id AS student_id
    FROM classes cl
    CROSS JOIN LATERAL (
        SELECT u.id AS student_id
        FROM enrollments e
        JOIN users u ON u.id = e.student_id
        WHERE e.class_id = cl.id AND e.status = 'active'
        ORDER BY u.full_name ASC, u.id ASC
        LIMIT sqlc.arg('scan_limit')
    ) top
    WHERE cl.center_id = sqlc.arg('center_id')
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR cl.teacher_id = sqlc.narg('teacher_id'))
)
SELECT
    capped.class_id                     AS class_id,
    capped.student_id                   AS student_id,
    att.present_late::bigint            AS attendance_present_late,
    att.total_marked::bigint            AS attendance_total_marked,
    miss.consecutive_missed::int        AS consecutive_missed,
    ob.overall_band                     AS overall_band,
    capped.class_target_band::numeric   AS class_target_band,
    bands.recent_released_bands         AS recent_released_bands
FROM capped
LEFT JOIN LATERAL (
    SELECT
        count(*) FILTER (WHERE a.status IN ('present','late')) AS present_late,
        count(*) AS total_marked
    FROM attendance a
    JOIN sessions sess ON sess.id = a.session_id
    WHERE a.student_id = capped.student_id AND sess.class_id = capped.cl_id
) att ON true
LEFT JOIN LATERAL (
    SELECT COALESCE(min(rn) FILTER (WHERE NOT missed) - 1, count(*))::int AS consecutive_missed
    FROM (
        SELECT
            (NOT EXISTS (
                SELECT 1 FROM submissions s
                WHERE s.assignment_id = a.id AND s.student_id = capped.student_id
                  AND s.status IN ('submitted','ai_processing','graded')
            )) AS missed,
            row_number() OVER (ORDER BY a.deadline_at DESC, a.id) AS rn
        FROM assignments a
        WHERE a.class_id = capped.cl_id AND a.deadline_at <= sqlc.arg('now')
    ) ranked_missed
) miss ON true
LEFT JOIN LATERAL (
    SELECT avg(band)::numeric AS overall_band
    FROM (
        SELECT cg.overall_band AS band
        FROM current_grades cg
        JOIN submissions s ON s.id = cg.submission_id
        JOIN assignments a ON a.id = s.assignment_id
        WHERE s.student_id = capped.student_id AND a.class_id = capped.cl_id AND cg.released_at IS NOT NULL
        ORDER BY cg.released_at DESC, cg.id DESC
        LIMIT 5  -- service.OverallBandWindow
    ) last_n
) ob ON true
LEFT JOIN LATERAL (
    SELECT array_agg(band ORDER BY released_at ASC, id ASC)::float8[] AS recent_released_bands
    FROM (
        SELECT cg.overall_band::float8 AS band, cg.released_at, cg.id
        FROM current_grades cg
        JOIN submissions s ON s.id = cg.submission_id
        JOIN assignments a ON a.id = s.assignment_id
        WHERE s.student_id = capped.student_id AND a.class_id = capped.cl_id AND cg.released_at IS NOT NULL
        ORDER BY cg.released_at DESC, cg.id DESC
        LIMIT 4  -- service.AtRiskGradedWindow
    ) last4
) bands ON true
ORDER BY capped.class_id ASC, capped.student_id ASC;

-- name: ListClassBandOverTime :many
-- Cohort avg overall_band per Monday-anchored week (center tz), released grades only
-- (AC6). Rows for WEEKS WITH DATA only; the service left-joins onto the dense
-- contiguous week axis (D15b — empty weeks → avgBand null / submissionCount 0). The
-- week key is the absolute instant of local Monday-midnight (matches the Go axis).
SELECT
    (date_trunc('week', cg.released_at AT TIME ZONE sqlc.arg('tz')::text) AT TIME ZONE sqlc.arg('tz')::text)::timestamptz AS week_start,
    avg(cg.overall_band)::numeric AS avg_band,
    count(*)::bigint AS submission_count
FROM current_grades cg
JOIN submissions s ON s.id = cg.submission_id
JOIN assignments a ON a.id = s.assignment_id
WHERE a.class_id = sqlc.arg('class_id')
  AND cg.released_at IS NOT NULL
  AND cg.released_at >= sqlc.arg('range_start')
  AND cg.released_at < sqlc.arg('range_end')
GROUP BY week_start
ORDER BY week_start ASC;

-- name: ListClassSkillHeatmap :many
-- Type-guarded weekly avg of the 4 Writing criteria over released WRITING grades
-- (D2/D13). The 4 criteria are unpivoted via a VALUES cross join; the CASE
-- short-circuits the ::numeric cast so a present-but-non-numeric criterion value
-- NEVER throws 22P02 (D13) — it contributes NULL (ignored by avg). sample_count
-- counts the numeric survivors. Rows for (criterion, week) that had at least one
-- Writing grade; the service fills the dense 4×N grid (empty/invalid → null cell).
SELECT
    crit.criterion::text AS criterion,
    (date_trunc('week', cg.released_at AT TIME ZONE sqlc.arg('tz')::text) AT TIME ZONE sqlc.arg('tz')::text)::timestamptz AS week_start,
    avg(CASE WHEN jsonb_typeof(cg.criterion_scores->crit.criterion) = 'number'
             THEN (cg.criterion_scores->>crit.criterion)::numeric END)::numeric AS avg_band,
    count(*) FILTER (WHERE jsonb_typeof(cg.criterion_scores->crit.criterion) = 'number')::bigint AS sample_count
FROM current_grades cg
JOIN submissions s ON s.id = cg.submission_id
JOIN assignments a ON a.id = s.assignment_id
JOIN exercises ex ON ex.id = a.exercise_id
CROSS JOIN (VALUES ('taskResponse'),('coherenceCohesion'),('lexicalResource'),('grammaticalRange')) AS crit(criterion)
WHERE a.class_id = sqlc.arg('class_id')
  AND ex.skill = 'writing'
  AND cg.released_at IS NOT NULL
  AND cg.released_at >= sqlc.arg('range_start')
  AND cg.released_at < sqlc.arg('range_end')
GROUP BY crit.criterion, week_start
ORDER BY crit.criterion ASC, week_start ASC;

-- name: ListClassMistakePatterns :many
-- Repetitive-mistake patterns mined from released grades over a class (D3/D11 + D12).
-- ONE UNION ALL of two sources (mirrors ListStudentMistakePatterns — both Mistakes
-- surfaces are symmetric, no two-truths asymmetry):
--   * comments (writing/speaking) → patternSource 'human_comment', criterion = the IELTS
--     criterion, type in {error,praise,suggestion};
--   * answer_errors (reading/listening) → patternSource 'auto_graded', type 'error',
--     criterion = the questionType (FU-8-2-A / D12). skillSource from the ex.skill JOIN.
-- BOTH jsonb_array_elements are ARRAY-GUARDED (CASE → '[]' on a non-array; R-4/B-2).
-- student identity from submissions.student_id, NO enrollment inner join (D14). The
-- recent/prior trend windows are per-row 0/1 FLAGS SUMmed in the outer query (an
-- aggregate FILTER over a UNION'd CTE column cannot be resolved by sqlc). The service
-- applies the co-gate (instanceCount >= MIN AND affectedStudentCount >= MIN, DR-A).
-- Ordered by a TOTAL order (instanceCount DESC, skillSource, criterion, type).
WITH unnested AS (
    SELECT
        ex.skill::text                    AS skill_source,
        (elem.value->>'criterion')::text  AS criterion,
        (elem.value->>'type')::text       AS type,
        'human_comment'::text             AS pattern_source,
        (elem.value->>'text')::text       AS example_quote,
        s.student_id                      AS student_id,
        (CASE WHEN cg.released_at >= sqlc.arg('recent_start') THEN 1 ELSE 0 END) AS recent_flag,
        (CASE WHEN cg.released_at >= sqlc.arg('prior_start') AND cg.released_at < sqlc.arg('recent_start') THEN 1 ELSE 0 END) AS prior_flag
    FROM current_grades cg
    JOIN submissions s ON s.id = cg.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN exercises ex ON ex.id = a.exercise_id
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(cg.comments) = 'array' THEN cg.comments ELSE '[]'::jsonb END
    ) AS elem(value)
    WHERE a.class_id = sqlc.arg('class_id')
      AND cg.released_at IS NOT NULL
      AND cg.released_at >= sqlc.arg('range_start')  -- 12-week axis (shared with bandOverTime/heatmap)
      AND ex.skill IN ('writing','speaking')
      AND (elem.value->>'type') IN ('error','praise','suggestion')
      AND (elem.value->>'criterion') IS NOT NULL
      AND (elem.value->>'criterion') <> ''
    UNION ALL
    SELECT
        ex.skill::text                      AS skill_source,
        (ae.value->>'questionType')::text   AS criterion,
        'error'::text                       AS type,
        'auto_graded'::text                 AS pattern_source,
        NULL::text                          AS example_quote,
        s.student_id                        AS student_id,
        (CASE WHEN cg.released_at >= sqlc.arg('recent_start') THEN 1 ELSE 0 END) AS recent_flag,
        (CASE WHEN cg.released_at >= sqlc.arg('prior_start') AND cg.released_at < sqlc.arg('recent_start') THEN 1 ELSE 0 END) AS prior_flag
    FROM current_grades cg
    JOIN submissions s ON s.id = cg.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN exercises ex ON ex.id = a.exercise_id
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(cg.answer_errors) = 'array' THEN cg.answer_errors ELSE '[]'::jsonb END
    ) AS ae(value)
    WHERE a.class_id = sqlc.arg('class_id')
      AND cg.released_at IS NOT NULL
      AND cg.released_at >= sqlc.arg('range_start')
      AND ex.skill IN ('reading','listening')
      AND (ae.value->>'questionType') IS NOT NULL
      AND (ae.value->>'questionType') <> ''
)
SELECT
    skill_source,
    criterion,
    type,
    pattern_source,
    count(*)::bigint AS instance_count,
    count(DISTINCT student_id)::bigint AS affected_student_count,
    sum(recent_flag)::bigint AS recent_count,
    sum(prior_flag)::bigint AS prior_count,
    max(example_quote) AS example_quote
FROM unnested
GROUP BY skill_source, criterion, type, pattern_source
ORDER BY count(*) DESC, skill_source ASC, criterion ASC, type ASC;

-- name: GetClassSubmissionRate :one
-- Class-wide on-time rate (AC10). total_due = (assignment × active-enrolled student)
-- pairs — the expected-submission set over CURRENTLY-ACTIVE enrollments (7.3
-- withdrawn excluded). on_time = submitted AND submitted_at <= deadline_at (STRICT).
-- The rate + null-when-total_due-0 guard is applied in Go.
WITH due AS (
    SELECT a.id AS assignment_id, a.deadline_at, e.student_id
    FROM assignments a
    JOIN enrollments e ON e.class_id = a.class_id AND e.status = 'active'
    WHERE a.class_id = sqlc.arg('class_id')
      AND a.deadline_at <= sqlc.arg('now')      -- past-due only (never count not-yet-due)
      AND a.deadline_at >= e.enrolled_at        -- since the student enrolled (7.3 transfer-safe)
)
SELECT
    count(*) FILTER (
        WHERE sub.id IS NOT NULL
          AND sub.status IN ('submitted','ai_processing','graded')
          AND sub.submitted_at IS NOT NULL
          AND sub.submitted_at <= due.deadline_at
    )::bigint AS on_time_count,
    count(*)::bigint AS total_due
FROM due
LEFT JOIN submissions sub ON sub.assignment_id = due.assignment_id AND sub.student_id = due.student_id;

-- name: ListClassStudentsAtRiskInputs :many
-- Class-scoped at-risk INPUT columns, ONE row per active-enrolled student (W2 —
-- literal class_id, keeps the index sargable; does NOT bolt a nullable class_id narg
-- onto the hot ListStudents path). LATERAL scalar subqueries scoped to this class so
-- a student appears exactly once with true SUMs. The service classifies the whole set
-- in Go via the reused AtRiskDetector (D5) — no per-student query fan-out.
SELECT
    u.id                                AS student_id,
    u.full_name                         AS name,
    att.present_late::bigint            AS attendance_present_late,
    att.total_marked::bigint            AS attendance_total_marked,
    miss.consecutive_missed::int        AS consecutive_missed,
    ob.overall_band                     AS overall_band,
    cl.target_band::numeric             AS class_target_band,
    bands.recent_released_bands         AS recent_released_bands
FROM enrollments enr
JOIN classes cl ON cl.id = enr.class_id
JOIN users u ON u.id = enr.student_id
LEFT JOIN LATERAL (
    SELECT
        count(*) FILTER (WHERE a.status IN ('present','late')) AS present_late,
        count(*) AS total_marked
    FROM attendance a
    JOIN sessions sess ON sess.id = a.session_id
    WHERE a.student_id = u.id AND sess.class_id = cl.id
) att ON true
LEFT JOIN LATERAL (
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
        WHERE a.class_id = cl.id AND a.deadline_at <= sqlc.arg('now')
    ) ranked
) miss ON true
LEFT JOIN LATERAL (
    SELECT avg(band)::numeric AS overall_band
    FROM (
        SELECT cg.overall_band AS band
        FROM current_grades cg
        JOIN submissions s ON s.id = cg.submission_id
        JOIN assignments a ON a.id = s.assignment_id
        WHERE s.student_id = u.id AND a.class_id = cl.id AND cg.released_at IS NOT NULL
        ORDER BY cg.released_at DESC, cg.id DESC
        LIMIT 5  -- service.OverallBandWindow
    ) last_n
) ob ON true
LEFT JOIN LATERAL (
    SELECT array_agg(band ORDER BY released_at ASC, id ASC)::float8[] AS recent_released_bands
    FROM (
        SELECT cg.overall_band::float8 AS band, cg.released_at, cg.id
        FROM current_grades cg
        JOIN submissions s ON s.id = cg.submission_id
        JOIN assignments a ON a.id = s.assignment_id
        WHERE s.student_id = u.id AND a.class_id = cl.id AND cg.released_at IS NOT NULL
        ORDER BY cg.released_at DESC, cg.id DESC
        LIMIT 4  -- service.AtRiskGradedWindow
    ) last4
) bands ON true
WHERE enr.class_id = sqlc.arg('class_id') AND enr.status = 'active'
ORDER BY u.full_name ASC, u.id ASC
LIMIT sqlc.arg('scan_limit');

-- ============================================================================
-- Story 8.3a — per-student analytics (D6/D11/D3). Reads only; the student slice
-- over the 8.2a spine. Same seams: RLS tenant-scopes every table (SET LOCAL by the
-- service before the first current_grades touch); student identity is
-- submissions.student_id, NOT an enrollment inner join (D14/7.3 transfer-safe); every
-- range filter stays SARGABLE on the raw released_at column; every list carries a
-- total-order tiebreak. The query BUDGET is exactly 6 (size-invariant, R31): the tz is
-- folded into GetStudentForAnalytics so there is no separate GetCenterTimezone call.
-- ============================================================================

-- name: GetStudentForAnalytics :one
-- Auth + display + the resolved class (for classAvgBand/targetBand, D11) + the center
-- tz (folded in — one fewer query, keeps the ≤6 budget). The caller's role scope is the
-- teacher_id narg: NULL ⇒ owner/admin (any center student); set ⇒ teacher (the student
-- must have an active enrollment in a class THIS teacher teaches, else NO ROW → 404
-- STUDENT_NOT_FOUND non-disclosure, D4). center_members.role='student' both scopes the
-- target to a real student AND (RLS) to the caller's center, so a cross-tenant/unknown/
-- non-student id is ErrNoRows → 404. The resolved class = the caller-scoped active
-- enrollment's class (teacher: their class containing the student; owner/admin: the
-- student's most-recent active enrollment); NULL when none. centers is a global table.
SELECT
    u.id                    AS student_id,
    u.full_name             AS student_name,
    cls.class_id            AS class_id,
    cls.target_band         AS target_band,
    ct.timezone             AS timezone
FROM users u
JOIN center_members cm ON cm.user_id = u.id AND cm.role = 'student'
JOIN centers ct ON ct.id = cm.center_id
LEFT JOIN LATERAL (
    SELECT c.id AS class_id, c.target_band
    FROM enrollments e
    JOIN classes c ON c.id = e.class_id
    WHERE e.student_id = u.id AND e.status = 'active'
      AND (sqlc.narg('teacher_id')::uuid IS NULL OR c.teacher_id = sqlc.narg('teacher_id'))
    ORDER BY e.enrolled_at DESC, c.id ASC
    LIMIT 1
) cls ON true
WHERE u.id = sqlc.arg('student_id')
  AND (
      sqlc.narg('teacher_id')::uuid IS NULL
      OR EXISTS (
          SELECT 1 FROM enrollments e2
          JOIN classes c2 ON c2.id = e2.class_id
          WHERE e2.student_id = u.id AND e2.status = 'active'
            AND c2.teacher_id = sqlc.narg('teacher_id')
      )
  );

-- name: ListStudentBandProgression :many
-- Per-skill weekly avg(overall_band) over released grades (AC8), one row per
-- (skill, populated week). The service densifies each skill onto the shared dense
-- center-tz 12-week axis (empty week → avgBand null, never 0; a skill with no released
-- grades never appears → omitted, not a zero series). Week key = the absolute instant of
-- local Monday-midnight (matches the Go axis). Range filter sargable on released_at.
SELECT
    ex.skill::text AS skill,
    (date_trunc('week', cg.released_at AT TIME ZONE sqlc.arg('tz')::text) AT TIME ZONE sqlc.arg('tz')::text)::timestamptz AS week_start,
    avg(cg.overall_band)::numeric AS avg_band,
    count(*)::bigint AS submission_count
FROM current_grades cg
JOIN submissions s ON s.id = cg.submission_id
JOIN assignments a ON a.id = s.assignment_id
JOIN exercises ex ON ex.id = a.exercise_id
WHERE s.student_id = sqlc.arg('student_id')
  AND cg.released_at IS NOT NULL
  AND cg.released_at >= sqlc.arg('range_start')
  AND cg.released_at < sqlc.arg('range_end')
GROUP BY ex.skill, week_start
ORDER BY ex.skill ASC, week_start ASC;

-- name: ListStudentSkillBreakdown :many
-- Per skill (that has released grades): the LATEST released overall band + the avg of
-- each of the 6 distinct IELTS criteria (type-guarded like the 8.2a heatmap — a
-- present-but-non-numeric value NEVER throws 22P02). The service picks each skill's own
-- criterion subset (writing: taskResponse/coherenceCohesion/lexicalResource/
-- grammaticalRange; speaking: fluencyCoherence/lexicalResource/grammaticalRange/
-- pronunciation; reading/listening: none → empty criteria). ONE query, one row per skill.
WITH skill_grades AS (
    SELECT ex.skill::text AS skill, cg.overall_band, cg.criterion_scores, cg.released_at, cg.id
    FROM current_grades cg
    JOIN submissions s ON s.id = cg.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN exercises ex ON ex.id = a.exercise_id
    WHERE s.student_id = sqlc.arg('student_id')
      AND cg.released_at IS NOT NULL
),
latest_overall AS (
    SELECT DISTINCT ON (skill) skill, overall_band
    FROM skill_grades
    ORDER BY skill, released_at DESC, id DESC
),
crit_avgs AS (
    SELECT
        skill,
        avg(CASE WHEN jsonb_typeof(criterion_scores->'taskResponse') = 'number' THEN (criterion_scores->>'taskResponse')::numeric END)::numeric      AS task_response_avg,
        avg(CASE WHEN jsonb_typeof(criterion_scores->'coherenceCohesion') = 'number' THEN (criterion_scores->>'coherenceCohesion')::numeric END)::numeric AS coherence_cohesion_avg,
        avg(CASE WHEN jsonb_typeof(criterion_scores->'lexicalResource') = 'number' THEN (criterion_scores->>'lexicalResource')::numeric END)::numeric  AS lexical_resource_avg,
        avg(CASE WHEN jsonb_typeof(criterion_scores->'grammaticalRange') = 'number' THEN (criterion_scores->>'grammaticalRange')::numeric END)::numeric AS grammatical_range_avg,
        avg(CASE WHEN jsonb_typeof(criterion_scores->'fluencyCoherence') = 'number' THEN (criterion_scores->>'fluencyCoherence')::numeric END)::numeric AS fluency_coherence_avg,
        avg(CASE WHEN jsonb_typeof(criterion_scores->'pronunciation') = 'number' THEN (criterion_scores->>'pronunciation')::numeric END)::numeric      AS pronunciation_avg
    FROM skill_grades
    GROUP BY skill
)
SELECT
    lo.skill                    AS skill,
    lo.overall_band             AS overall_band,
    ca.task_response_avg        AS task_response_avg,
    ca.coherence_cohesion_avg   AS coherence_cohesion_avg,
    ca.lexical_resource_avg     AS lexical_resource_avg,
    ca.grammatical_range_avg    AS grammatical_range_avg,
    ca.fluency_coherence_avg    AS fluency_coherence_avg,
    ca.pronunciation_avg        AS pronunciation_avg
FROM latest_overall lo
JOIN crit_avgs ca ON ca.skill = lo.skill
ORDER BY lo.skill ASC;

-- name: ListClassCohortSkillAvg :many
-- D11 — the per-skill cohort avg(overall_band) for the student's RESOLVED class (the
-- teacher-only classAvgBand comparison). ONE set-based aggregate (size-invariant, +1 to
-- the budget). class_id narg NULL (student in no class) ⇒ no rows ⇒ classAvgBand null
-- for every skill. Released grades only; whole-class cohort (includes the subject).
SELECT
    ex.skill::text AS skill,
    avg(cg.overall_band)::numeric AS class_avg_band
FROM current_grades cg
JOIN submissions s ON s.id = cg.submission_id
JOIN assignments a ON a.id = s.assignment_id
JOIN exercises ex ON ex.id = a.exercise_id
WHERE a.class_id = sqlc.narg('class_id')
  AND cg.released_at IS NOT NULL
GROUP BY ex.skill
ORDER BY ex.skill ASC;

-- name: GetStudentAnalyticsSubmissionStats :one
-- The student's own submission zone (AC10): on-time rate (mirrors GetClassSubmissionRate,
-- student-scoped over CURRENTLY-active enrollments, 7.3 withdrawn excluded, past-due
-- only, since-enrolled), total submission count, gradedSubmissionCount (released grades —
-- the s37 "≥3 graded" threshold, DISTINCT from submission count, Sally), and praise/error
-- pin counts (unnested released-grade comments, array-guarded). ONE query via 1-row CTEs.
WITH due AS (
    SELECT a.id AS assignment_id, a.deadline_at
    FROM assignments a
    JOIN enrollments e ON e.class_id = a.class_id AND e.status = 'active' AND e.student_id = sqlc.arg('student_id')
    WHERE a.deadline_at <= sqlc.arg('now')      -- past-due only
      AND a.deadline_at >= e.enrolled_at        -- since the student enrolled (7.3 transfer-safe)
),
rate AS (
    SELECT
        count(*) FILTER (
            WHERE sub.id IS NOT NULL
              AND sub.status IN ('submitted','ai_processing','graded')
              AND sub.submitted_at IS NOT NULL
              AND sub.submitted_at <= due.deadline_at
        )::bigint AS on_time_count,
        count(*)::bigint AS total_due
    FROM due
    LEFT JOIN submissions sub ON sub.assignment_id = due.assignment_id AND sub.student_id = sqlc.arg('student_id')
),
counts AS (
    SELECT
        (SELECT count(*) FROM submissions s
         WHERE s.student_id = sqlc.arg('student_id') AND s.submitted_at IS NOT NULL)::bigint AS total_submission_count,
        (SELECT count(*) FROM current_grades cg
         JOIN submissions s ON s.id = cg.submission_id
         WHERE s.student_id = sqlc.arg('student_id') AND cg.released_at IS NOT NULL)::bigint AS graded_submission_count
),
pins AS (
    SELECT
        count(*) FILTER (WHERE elem.value->>'type' = 'praise')::bigint AS praise_pin_count,
        count(*) FILTER (WHERE elem.value->>'type' = 'error')::bigint  AS error_pin_count
    FROM current_grades cg
    JOIN submissions s ON s.id = cg.submission_id
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(cg.comments) = 'array' THEN cg.comments ELSE '[]'::jsonb END
    ) AS elem(value)
    WHERE s.student_id = sqlc.arg('student_id') AND cg.released_at IS NOT NULL
)
SELECT
    rate.on_time_count              AS on_time_count,
    rate.total_due                  AS total_due,
    counts.total_submission_count   AS total_submission_count,
    counts.graded_submission_count  AS graded_submission_count,
    pins.praise_pin_count           AS praise_pin_count,
    pins.error_pin_count            AS error_pin_count
FROM rate, counts, pins;

-- name: ListStudentMistakePatterns :many
-- The student's 4-skill repetitive-mistake mining (AC11-13, D3/D7), ONE UNION ALL:
--   * comments source (writing/speaking) → patternSource 'human_comment', criterion =
--     the IELTS criterion, type in {error,praise,suggestion} (the 8.2a class idiom,
--     student-scoped on s.student_id);
--   * answer_errors source (reading/listening) → patternSource 'auto_graded', type
--     'error', criterion = the questionType (FU-8-2-A). skillSource is derived from the
--     ex.skill JOIN, NOT the JSONB (Winston C2).
-- BOTH unnests are ARRAY-GUARDED in the jsonb_array_elements argument (CASE → '[]' on a
-- non-array): jsonb_array_elements over a scalar/object/null would 500 the endpoint
-- (R-4/B-2). The service applies the co-gate (instanceCount>=MIN AND
-- affectedStudentCount>=MIN) + trend; total-ordered here.
-- The recent/prior trend windows are computed as per-row 0/1 FLAGS inside each branch
-- (where released_at is unambiguously cg.released_at) and SUMmed in the outer query.
-- An aggregate FILTER referencing a UNION'd CTE column cannot be resolved by sqlc's
-- analyzer, so the flag-then-sum form is used instead of count(*) FILTER (...).
WITH unnested AS (
    SELECT
        ex.skill::text                    AS skill_source,
        (elem.value->>'criterion')::text  AS criterion,
        (elem.value->>'type')::text       AS type,
        'human_comment'::text             AS pattern_source,
        (elem.value->>'text')::text       AS example_quote,
        s.student_id                      AS student_id,
        (CASE WHEN cg.released_at >= sqlc.arg('recent_start') THEN 1 ELSE 0 END) AS recent_flag,
        (CASE WHEN cg.released_at >= sqlc.arg('prior_start') AND cg.released_at < sqlc.arg('recent_start') THEN 1 ELSE 0 END) AS prior_flag
    FROM current_grades cg
    JOIN submissions s ON s.id = cg.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN exercises ex ON ex.id = a.exercise_id
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(cg.comments) = 'array' THEN cg.comments ELSE '[]'::jsonb END
    ) AS elem(value)
    WHERE s.student_id = sqlc.arg('student_id')
      AND cg.released_at IS NOT NULL
      AND cg.released_at >= sqlc.arg('range_start')
      AND ex.skill IN ('writing','speaking')
      AND (elem.value->>'type') IN ('error','praise','suggestion')
      AND (elem.value->>'criterion') IS NOT NULL
      AND (elem.value->>'criterion') <> ''
    UNION ALL
    SELECT
        ex.skill::text                      AS skill_source,
        (ae.value->>'questionType')::text   AS criterion,
        'error'::text                       AS type,
        'auto_graded'::text                 AS pattern_source,
        NULL::text                          AS example_quote,
        s.student_id                        AS student_id,
        (CASE WHEN cg.released_at >= sqlc.arg('recent_start') THEN 1 ELSE 0 END) AS recent_flag,
        (CASE WHEN cg.released_at >= sqlc.arg('prior_start') AND cg.released_at < sqlc.arg('recent_start') THEN 1 ELSE 0 END) AS prior_flag
    FROM current_grades cg
    JOIN submissions s ON s.id = cg.submission_id
    JOIN assignments a ON a.id = s.assignment_id
    JOIN exercises ex ON ex.id = a.exercise_id
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(cg.answer_errors) = 'array' THEN cg.answer_errors ELSE '[]'::jsonb END
    ) AS ae(value)
    WHERE s.student_id = sqlc.arg('student_id')
      AND cg.released_at IS NOT NULL
      AND cg.released_at >= sqlc.arg('range_start')
      AND ex.skill IN ('reading','listening')
      AND (ae.value->>'questionType') IS NOT NULL
      AND (ae.value->>'questionType') <> ''
)
SELECT
    skill_source,
    criterion,
    type,
    pattern_source,
    count(*)::bigint AS instance_count,
    count(DISTINCT student_id)::bigint AS affected_student_count,
    sum(recent_flag)::bigint AS recent_count,
    sum(prior_flag)::bigint AS prior_count,
    max(example_quote) AS example_quote
FROM unnested
GROUP BY skill_source, criterion, type, pattern_source
ORDER BY count(*) DESC, skill_source ASC, criterion ASC, type ASC;

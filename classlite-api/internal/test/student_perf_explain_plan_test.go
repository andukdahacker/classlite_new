// student_perf_explain_plan_test.go — Story 8-3a (AC21 · Task 7). GREEN-PHASE, NOT part
// of the WF-8 red gate (planner heuristics are environment-brittle — Murat N1; the red
// gate is the scope/RLS/query-count files).
//
// REUSES the 8-1a dashExplainNoSeqScan helper UNCHANGED (SET LOCAL enable_seqscan=off,
// then assert no "Seq Scan"). Seeded at realistic cardinality: the 8-2a cohort
// (≈30 students × 12 weeks × 2 skills = 720 submissions) PLUS one focal student with many
// released grades across all four skills (writing/speaking comments + reading/listening
// answer_errors). The focal student is the AC21 watch: every per-student query filters
// submissions.student_id, whose only composite index (uq_submissions_assignment_student)
// leads with assignment_id — so this test proves the student band/skill/cohort/mistake
// drivers plan without a Seq Scan on the tenant-filtered spine at real cardinality. If a
// plan Seq Scans, the W3 remedy is an index via a MIGRATION (WF-2 — flag first).
package test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// seedFocalStudentGrades adds one active student to `class` with `weeks` released grades
// per skill: writing/speaking carry a criterion comment (the human_comment mining source),
// reading/listening carry a two-element answer_errors array (the auto_graded source).
// Returns the focal student id.
func seedFocalStudentGrades(t *testing.T, db *TxDB, centerID, class, teacherID uuid.UUID, weeks int) uuid.UUID {
	t.Helper()
	ctx := context.Background()

	student := CreateUser(t, db, "focal-"+uuid.NewString()[:8]+"@x.test", "Focal Student")
	sid := uuidFromPg(student.ID)
	CreateCenterMember(t, db, student.ID, pgUUID(centerID), "student")
	insertEnrollmentRaw(t, db, centerID, sid, class, "active")

	// One exercise per skill.
	exBySkill := map[string]uuid.UUID{}
	for _, skill := range []string{"writing", "speaking", "reading", "listening"} {
		ex := uuid.New()
		if _, err := db.Exec(ctx,
			`INSERT INTO exercises (id, center_id, created_by, code, title, skill) VALUES ($1,$2,$3,$4,'Ex',$5)`,
			ex, centerID, teacherID, "FOC-"+uuid.NewString()[:8], skill); err != nil {
			t.Fatalf("seed focal exercise(%s): %v", skill, err)
		}
		exBySkill[skill] = ex
	}

	comments := map[string]string{
		"writing":  `[{"type":"error","criterion":"grammaticalRange","text":"x"}]`,
		"speaking": `[{"type":"error","criterion":"pronunciation","timestampMs":1000,"text":"y"}]`,
	}
	answerErrors := map[string]string{
		"reading":   `[{"questionRef":"0:0:0","questionType":"gap_fill","schemaVersion":1},{"questionRef":"0:1:0","questionType":"matching","schemaVersion":1}]`,
		"listening": `[{"questionRef":"0:0:0","questionType":"multiple_choice","schemaVersion":1}]`,
	}

	for skill, ex := range exBySkill {
		for w := 0; w < weeks; w++ {
			as, sub, gr := uuid.New(), uuid.New(), uuid.New()
			deadline := time.Now().Add(-time.Duration(w) * 7 * 24 * time.Hour)
			if _, err := db.Exec(ctx,
				`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, deadline_at) VALUES ($1,$2,$3,$4,$5,$6)`,
				as, centerID, ex, class, teacherID, deadline); err != nil {
				t.Fatalf("seed focal assignment: %v", err)
			}
			if _, err := db.Exec(ctx,
				`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, submitted_at) VALUES ($1,$2,$3,$4,'graded',$5)`,
				sub, centerID, as, sid, deadline.Add(-time.Hour)); err != nil {
				t.Fatalf("seed focal submission: %v", err)
			}
			cJSON := "[]"
			if c, ok := comments[skill]; ok {
				cJSON = c
			}
			var aeArg any
			if ae, ok := answerErrors[skill]; ok {
				aeArg = ae
			}
			if _, err := db.Exec(ctx,
				`INSERT INTO grades (id, submission_id, center_id, graded_by, version, criterion_scores, overall_band, comments, answer_errors, released_at)
				 VALUES ($1,$2,$3,$4,1,'{"taskResponse":6.0,"coherenceCohesion":6.5,"lexicalResource":6.0,"grammaticalRange":6.5,"fluencyCoherence":6.0,"pronunciation":6.5}'::jsonb,6.5,$5::jsonb,$6::jsonb,$7)`,
				gr, sub, centerID, teacherID, cJSON, aeArg, deadline); err != nil {
				t.Fatalf("seed focal grade(%s): %v", skill, err)
			}
		}
	}
	return sid
}

func TestStudentPerf_ExplainNoSeqScan(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@sp-explain.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)

	// Realistic cohort cardinality (720 submissions) so a Seq Scan would be a real choice,
	// plus one focal student with many grades across all four skills.
	class := seedAnalyticsExplainCohort(t, db, cid, tID, 30, 12)
	focal := seedFocalStudentGrades(t, db, cid, class, tID, 12)

	studentPg := pgUUIDForTest(focal)
	classPg := pgUUIDForTest(class)
	tz := "Asia/Ho_Chi_Minh"
	now := time.Now()
	rangeStart := now.Add(-13 * 7 * 24 * time.Hour)
	rangeEnd := now.Add(7 * 24 * time.Hour)
	recentStart := now.Add(-4 * 7 * 24 * time.Hour)
	priorStart := now.Add(-8 * 7 * 24 * time.Hour)

	// band progression driver — current_grades/submissions/assignments/exercises on
	// submissions.student_id (the AC21 watch path).
	dashExplainNoSeqScan(t, db, "bandProgression(ListStudentBandProgression)",
		`SELECT ex.skill::text AS skill,
		        (date_trunc('week', cg.released_at AT TIME ZONE $1::text) AT TIME ZONE $1::text)::timestamptz AS week_start,
		        avg(cg.overall_band)::numeric AS avg_band, count(*)::bigint AS submission_count
		   FROM current_grades cg
		   JOIN submissions s ON s.id = cg.submission_id
		   JOIN assignments a ON a.id = s.assignment_id
		   JOIN exercises ex ON ex.id = a.exercise_id
		  WHERE s.student_id = $2 AND cg.released_at IS NOT NULL
		    AND cg.released_at >= $3 AND cg.released_at < $4
		  GROUP BY ex.skill, week_start`,
		tz, studentPg, rangeStart, rangeEnd)

	// skill breakdown driver — the skill_grades CTE spine on submissions.student_id.
	dashExplainNoSeqScan(t, db, "skillBreakdown(ListStudentSkillBreakdown)",
		`WITH skill_grades AS (
			SELECT ex.skill::text AS skill, cg.overall_band, cg.criterion_scores, cg.released_at, cg.id
			  FROM current_grades cg
			  JOIN submissions s ON s.id = cg.submission_id
			  JOIN assignments a ON a.id = s.assignment_id
			  JOIN exercises ex ON ex.id = a.exercise_id
			 WHERE s.student_id = $1 AND cg.released_at IS NOT NULL
		)
		SELECT DISTINCT ON (skill) skill, overall_band FROM skill_grades ORDER BY skill, released_at DESC, id DESC`,
		studentPg)

	// cohort classAvgBand driver (D11) — class-scoped, released grades.
	dashExplainNoSeqScan(t, db, "cohortSkillAvg(ListClassCohortSkillAvg)",
		`SELECT ex.skill::text AS skill, avg(cg.overall_band)::numeric AS class_avg_band
		   FROM current_grades cg
		   JOIN submissions s ON s.id = cg.submission_id
		   JOIN assignments a ON a.id = s.assignment_id
		   JOIN exercises ex ON ex.id = a.exercise_id
		  WHERE a.class_id = $1 AND cg.released_at IS NOT NULL
		  GROUP BY ex.skill`,
		classPg)

	// submission stats driver — the student's active enrollments + past-due assignments.
	dashExplainNoSeqScan(t, db, "submissionStats(GetStudentAnalyticsSubmissionStats.rate)",
		`WITH due AS (
			SELECT a.id AS assignment_id, a.deadline_at
			  FROM assignments a
			  JOIN enrollments e ON e.class_id = a.class_id AND e.status = 'active' AND e.student_id = $1
			 WHERE a.deadline_at <= $2 AND a.deadline_at >= e.enrolled_at
		)
		SELECT count(*)::bigint AS total_due FROM due`,
		studentPg, now)

	// mistake union driver — the shipped UNION ALL (comments + answer_errors), the R-4
	// guard, on submissions.student_id (AC21 — the answer_errors branch lands here too).
	dashExplainNoSeqScan(t, db, "mistakes(ListStudentMistakePatterns)",
		`WITH unnested AS (
			SELECT ex.skill::text AS skill_source, (elem.value->>'criterion')::text AS criterion,
			       (elem.value->>'type')::text AS type, 'human_comment'::text AS pattern_source, s.student_id AS student_id,
			       (CASE WHEN cg.released_at >= $2 THEN 1 ELSE 0 END) AS recent_flag,
			       (CASE WHEN cg.released_at >= $3 AND cg.released_at < $2 THEN 1 ELSE 0 END) AS prior_flag
			  FROM current_grades cg
			  JOIN submissions s ON s.id = cg.submission_id
			  JOIN assignments a ON a.id = s.assignment_id
			  JOIN exercises ex ON ex.id = a.exercise_id
			  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cg.comments) = 'array' THEN cg.comments ELSE '[]'::jsonb END) AS elem(value)
			 WHERE s.student_id = $1 AND cg.released_at IS NOT NULL AND cg.released_at >= $4
			   AND ex.skill IN ('writing','speaking') AND (elem.value->>'type') IN ('error','praise','suggestion')
			   AND (elem.value->>'criterion') IS NOT NULL
			UNION ALL
			SELECT ex.skill::text, (ae.value->>'questionType')::text, 'error'::text, 'auto_graded'::text, s.student_id,
			       (CASE WHEN cg.released_at >= $2 THEN 1 ELSE 0 END), (CASE WHEN cg.released_at >= $3 AND cg.released_at < $2 THEN 1 ELSE 0 END)
			  FROM current_grades cg
			  JOIN submissions s ON s.id = cg.submission_id
			  JOIN assignments a ON a.id = s.assignment_id
			  JOIN exercises ex ON ex.id = a.exercise_id
			  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cg.answer_errors) = 'array' THEN cg.answer_errors ELSE '[]'::jsonb END) AS ae(value)
			 WHERE s.student_id = $1 AND cg.released_at IS NOT NULL AND cg.released_at >= $4
			   AND ex.skill IN ('reading','listening') AND (ae.value->>'questionType') IS NOT NULL
		)
		SELECT skill_source, criterion, type, pattern_source, count(*)::bigint, sum(recent_flag)::bigint, sum(prior_flag)::bigint
		  FROM unnested GROUP BY skill_source, criterion, type, pattern_source`,
		studentPg, recentStart, priorStart, rangeStart)
}

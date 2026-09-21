// analytics_explain_plan_test.go — Story 8-2a (AC16 · Task 6). GREEN-PHASE, NOT part
// of the WF-8 red gate (plan tests are environment-brittle — planner heuristics; the
// red gate is the scope/RLS/query-count files, per the 8-1a AC14 precedent).
//
// REUSES the 8-1a dashExplainNoSeqScan helper UNCHANGED (SET LOCAL enable_seqscan=off
// then assert no "Seq Scan"). Seeded at realistic cardinality (≈30 students × 12 weeks
// × 2 skills — planner choices on 3-row fixtures are noise, W2). Asserts no Seq Scan
// on the class_id/center_id-filtered current_grades / submissions / assignments drivers
// of the three set-based aggregates (bandOverTime, heatmap, mistake-mining) + the
// submission-rate query (AC16). If a plan surfaces a Seq Scan/sort on current_grades'
// DISTINCT ON, the W3 remedy is a grades(submission_id, version DESC) index via a
// MIGRATION (WF-2 — flag first). Faithful query text (matches queries/analytics.sql)
// so a plan check can't pass while the shipped query Seq Scans.
package test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// seedAnalyticsExplainCohort bulk-seeds one class with `students` active students and,
// across `weeks` weeks, one Writing + one Speaking assignment per week, each with a
// released, comment-bearing, fully-scored grade for every student. Tenant context set
// by the caller. Returns the class id.
func seedAnalyticsExplainCohort(t *testing.T, db *TxDB, centerID, teacherID uuid.UUID, students, weeks int) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	class := seedClassWithTeacher(t, db, centerID, teacherID)

	// students → users + center_members(student) + active enrollments.
	if _, err := db.Exec(ctx, `
		WITH ins_u AS (
			INSERT INTO users (id, email, full_name)
			SELECT gen_random_uuid(), 'exp-stu-'||g||'-'||gen_random_uuid()||'@x.test', 'Exp Student '||g
			FROM generate_series(1, $1) g
			RETURNING id
		),
		ins_m AS (
			INSERT INTO center_members (user_id, center_id, role)
			SELECT id, $2, 'student' FROM ins_u
			RETURNING user_id
		)
		INSERT INTO enrollments (id, center_id, class_id, student_id, status)
		SELECT gen_random_uuid(), $2, $3, user_id, 'active' FROM ins_m`,
		students, centerID, class); err != nil {
		t.Fatalf("seed explain students: %v", err)
	}

	// two exercises (writing + speaking), authored by the teacher.
	writingEx, speakingEx := uuid.New(), uuid.New()
	for _, e := range []struct {
		id    uuid.UUID
		skill string
	}{{writingEx, "writing"}, {speakingEx, "speaking"}} {
		if _, err := db.Exec(ctx,
			`INSERT INTO exercises (id, center_id, created_by, code, title, skill) VALUES ($1,$2,$3,$4,'Ex',$5)`,
			e.id, centerID, teacherID, "EXP-"+uuid.NewString()[:8], e.skill); err != nil {
			t.Fatalf("seed explain exercise(%s): %v", e.skill, err)
		}
	}

	// weeks × {writing, speaking} assignments, deadlines spread one week apart.
	if _, err := db.Exec(ctx, `
		INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, deadline_at)
		SELECT gen_random_uuid(), $1,
		       (CASE WHEN skill_ix = 0 THEN $2 ELSE $3 END)::uuid,
		       $4, $5,
		       now() - make_interval(weeks => w)
		FROM generate_series(0, $6 - 1) w
		CROSS JOIN generate_series(0, 1) skill_ix`,
		centerID, writingEx, speakingEx, class, teacherID, weeks); err != nil {
		t.Fatalf("seed explain assignments: %v", err)
	}

	// one graded submission per (assignment, active student).
	if _, err := db.Exec(ctx, `
		INSERT INTO submissions (id, center_id, assignment_id, student_id, status, submitted_at)
		SELECT gen_random_uuid(), $1, a.id, e.student_id, 'graded', a.deadline_at - interval '1 hour'
		FROM assignments a
		JOIN enrollments e ON e.class_id = a.class_id AND e.status = 'active'
		WHERE a.class_id = $2`,
		centerID, class); err != nil {
		t.Fatalf("seed explain submissions: %v", err)
	}

	// one released grade per submission — full criterion_scores + a comment (writing →
	// grammaticalRange error; speaking → pronunciation error) so the heatmap + mistake
	// drivers have real rows.
	if _, err := db.Exec(ctx, `
		INSERT INTO grades (id, submission_id, center_id, graded_by, version, criterion_scores, overall_band, comments, released_at)
		SELECT gen_random_uuid(), s.id, $1, $2, 1,
		       '{"taskResponse":6.0,"coherenceCohesion":6.5,"lexicalResource":6.0,"grammaticalRange":6.5}'::jsonb,
		       6.5,
		       CASE WHEN ex.skill = 'writing'
		            THEN '[{"type":"error","criterion":"grammaticalRange","text":"x"}]'::jsonb
		            ELSE '[{"type":"error","criterion":"pronunciation","text":"y"}]'::jsonb END,
		       a.deadline_at
		FROM submissions s
		JOIN assignments a ON a.id = s.assignment_id
		JOIN exercises ex ON ex.id = a.exercise_id
		WHERE a.class_id = $3`,
		centerID, teacherID, class); err != nil {
		t.Fatalf("seed explain grades: %v", err)
	}
	return class
}

func TestAnalytics_ExplainNoSeqScan(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@an-explain.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	class := seedAnalyticsExplainCohort(t, db, cid, dashPGToUUID(t, teacher.ID), 30, 12)

	classPg := pgUUIDForTest(class)
	tz := "Asia/Ho_Chi_Minh"
	now := time.Now()
	rangeStart := now.Add(-13 * 7 * 24 * time.Hour)
	rangeEnd := now.Add(7 * 24 * time.Hour)

	// bandOverTime driver — current_grades + submissions + assignments on class_id.
	dashExplainNoSeqScan(t, db, "bandOverTime(ListClassBandOverTime)",
		`SELECT (date_trunc('week', cg.released_at AT TIME ZONE $1::text) AT TIME ZONE $1::text)::timestamptz AS week_start,
		        avg(cg.overall_band)::numeric AS avg_band,
		        count(*)::bigint AS submission_count
		   FROM current_grades cg
		   JOIN submissions s ON s.id = cg.submission_id
		   JOIN assignments a ON a.id = s.assignment_id
		  WHERE a.class_id = $2
		    AND cg.released_at IS NOT NULL
		    AND cg.released_at >= $3
		    AND cg.released_at <  $4
		  GROUP BY week_start
		  ORDER BY week_start ASC`,
		tz, classPg, rangeStart, rangeEnd)

	// heatmap driver — the same current_grades/submissions/assignments spine + the
	// exercises join + the 4-criterion VALUES cross join.
	dashExplainNoSeqScan(t, db, "skillHeatmap(ListClassSkillHeatmap)",
		`SELECT crit.criterion::text AS criterion,
		        (date_trunc('week', cg.released_at AT TIME ZONE $1::text) AT TIME ZONE $1::text)::timestamptz AS week_start,
		        avg(CASE WHEN jsonb_typeof(cg.criterion_scores->crit.criterion) = 'number'
		                 THEN (cg.criterion_scores->>crit.criterion)::numeric END)::numeric AS avg_band,
		        count(*) FILTER (WHERE jsonb_typeof(cg.criterion_scores->crit.criterion) = 'number')::bigint AS sample_count
		   FROM current_grades cg
		   JOIN submissions s ON s.id = cg.submission_id
		   JOIN assignments a ON a.id = s.assignment_id
		   JOIN exercises ex ON ex.id = a.exercise_id
		   CROSS JOIN (VALUES ('taskResponse'),('coherenceCohesion'),('lexicalResource'),('grammaticalRange')) AS crit(criterion)
		  WHERE a.class_id = $2
		    AND ex.skill = 'writing'
		    AND cg.released_at IS NOT NULL
		    AND cg.released_at >= $3
		    AND cg.released_at <  $4
		  GROUP BY crit.criterion, week_start`,
		tz, classPg, rangeStart, rangeEnd)

	// mistake-mining driver — current_grades/submissions/assignments/exercises spine
	// with the comments unnest; student identity from submissions.student_id (D14).
	dashExplainNoSeqScan(t, db, "mistakePatterns(ListClassMistakePatterns)",
		`WITH unnested AS (
			SELECT ex.skill::text AS skill_source,
			       (elem.value->>'criterion')::text AS criterion,
			       (elem.value->>'type')::text AS type,
			       s.student_id AS student_id,
			       cg.released_at AS released_at
			  FROM current_grades cg
			  JOIN submissions s ON s.id = cg.submission_id
			  JOIN assignments a ON a.id = s.assignment_id
			  JOIN exercises ex ON ex.id = a.exercise_id
			  CROSS JOIN LATERAL jsonb_array_elements(
			      CASE WHEN jsonb_typeof(cg.comments) = 'array' THEN cg.comments ELSE '[]'::jsonb END
			  ) AS elem(value)
			 WHERE a.class_id = $1
			   AND cg.released_at IS NOT NULL
			   AND cg.released_at >= $2
			   AND ex.skill IN ('writing','speaking')
		)
		SELECT skill_source, criterion, type, count(*)::bigint
		  FROM unnested GROUP BY skill_source, criterion, type`,
		classPg, rangeStart)

	// submission-rate driver — assignments + enrollments on class_id, LEFT JOIN submissions.
	dashExplainNoSeqScan(t, db, "submissionRate(GetClassSubmissionRate)",
		`WITH due AS (
			SELECT a.id AS assignment_id, a.deadline_at, e.student_id
			  FROM assignments a
			  JOIN enrollments e ON e.class_id = a.class_id AND e.status = 'active'
			 WHERE a.class_id = $1
			   AND a.deadline_at <= $2
			   AND a.deadline_at >= e.enrolled_at
		)
		SELECT count(*) FILTER (
		         WHERE sub.id IS NOT NULL AND sub.submitted_at IS NOT NULL AND sub.submitted_at <= due.deadline_at
		       )::bigint AS on_time_count,
		       count(*)::bigint AS total_due
		  FROM due
		  LEFT JOIN submissions sub ON sub.assignment_id = due.assignment_id AND sub.student_id = due.student_id`,
		classPg, now)

	_ = pgtype.UUID{} // import anchor across green edits
}

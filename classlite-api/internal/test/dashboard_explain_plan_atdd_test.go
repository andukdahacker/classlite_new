// dashboard_explain_plan_atdd_test.go — Story 8-1a (AC14 · D7(2) · Task 6).
//
// ⚠️ GREEN-PHASE SCAFFOLD — **NOT part of the WF-8 red gate.** The red gate is
// AC2/AC13/AC15/AC16/AC17 (the other four dashboard_*_atdd_test.go files). Plan
// tests are environment-brittle (planner heuristics), so per the story EXPLAIN is
// green-phase. This file is tagged `//go:build atdd_red_phase` ONLY so it stays
// out of `go test ./...` until the new queries land — it is NOT a compile-red
// proof. The dev finalizes the SQL below against queries/dashboard.sql in green,
// then may un-tag it into a normal CI plan check.
//
// MUST `SET LOCAL enable_seqscan = off` BEFORE EXPLAIN, or it FALSE-REDS on tiny
// seeded tables (Postgres picks Seq Scan on small relations regardless of
// indexes). In-repo idiom: audit_logs_rls_test.go:243-262. With seqscan off, a
// remaining "Seq Scan" proves no usable index exists for that access path.
//
// Assert NO Seq Scan on: the tenant-filtered index columns (center_id/class_id/
// teacher_id) AND the DRIVING submissions relation of the grading-backlog query —
// a status-filter seq scan of all-center submissions would pass a join-column
// check while being O(all submissions) (Winston). If a plan regresses, Task 6
// flags a partial index `submissions(status) WHERE status IN ('submitted',
// 'ai_processing')` via a MIGRATION (WF-2 — flag before adding).
package test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// dashExplainNoSeqScan runs EXPLAIN under enable_seqscan=off and fails if the
// plan still contains a Seq Scan (⇒ no usable index for this access path).
// Reusable by 8.2/8.4 plan checks alongside the query-count harness.
func dashExplainNoSeqScan(t *testing.T, db *TxDB, label, sql string, args ...any) {
	t.Helper()
	ctx := context.Background()
	if _, err := db.Exec(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
		t.Fatalf("%s: disable seqscan: %v", label, err)
	}
	rows, err := db.Query(ctx, "EXPLAIN "+sql, args...)
	if err != nil {
		t.Fatalf("%s: explain: %v", label, err)
	}
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatalf("%s: scan plan: %v", label, err)
		}
		plan.WriteString(line)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("%s: plan rows: %v", label, err)
	}
	if strings.Contains(plan.String(), "Seq Scan") {
		t.Errorf("AC14: %s plan contains a Seq Scan — a usable index is missing "+
			"(if this is the submissions status driver, Task 6 flags the partial index, WF-2):\n%s",
			label, plan.String())
	}
}

func TestDashboard_ExplainNoSeqScan_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@explain.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)
	student := seedStudentMember(t, db, cid, "s@explain.test", "S")
	insertEnrollmentRaw(t, db, cid, student, class, "active")
	dashSeedNeedsGrading(t, db, cid, class, tID, student)

	now := time.Now()
	var noClass pgtype.UUID // NULL class_id narg (teacher scope ⇒ own classes via teacher_id)

	// weekSessions — the ACTUAL reused ListSessionsByRange access path (faithful text,
	// not a simplification): a plan check that omits the real query's joins/filters
	// would pass while the shipped query Seq Scans.
	dashExplainNoSeqScan(t, db, "weekSessions(ListSessionsByRange)",
		`SELECT s.id, c.name AS class_name, c.color AS class_color, c.teacher_id
		   FROM sessions s
		   JOIN classes c ON c.id = s.class_id
		  WHERE s.starts_at >= $1
		    AND s.starts_at <  $2
		    AND ($3::uuid IS NULL OR s.class_id = $3::uuid)
		    AND ($4::uuid IS NULL OR c.teacher_id = $4::uuid)
		  ORDER BY s.starts_at ASC`,
		now.Add(-7*24*time.Hour), now.Add(7*24*time.Hour), noClass, tID)

	// grading-backlog DRIVER — the FULL shipped ListGradingBacklog, incl. the
	// current_grades LEFT JOIN + exercises/users joins + released-at filter. The
	// submissions relation must not Seq Scan on the status filter (D7(2)/Winston);
	// a red here is the AC14 signal to flag Task 6's partial-index migration (WF-2).
	dashExplainNoSeqScan(t, db, "gradingBacklog(ListGradingBacklog)",
		`SELECT sub.id AS submission_id,
		        u.full_name AS student_name,
		        e.title AS assignment_title,
		        c.name AS class_name,
		        (COALESCE(a.hard_deadline_at, a.deadline_at) < $1)::boolean AS overdue,
		        sub.submitted_at
		   FROM submissions sub
		   JOIN assignments a ON a.id = sub.assignment_id
		   JOIN classes c ON c.id = a.class_id
		   JOIN exercises e ON e.id = a.exercise_id
		   JOIN users u ON u.id = sub.student_id
		   LEFT JOIN current_grades cg ON cg.submission_id = sub.id
		  WHERE sub.center_id = $2
		    AND sub.status IN ('submitted', 'ai_processing')
		    AND (cg.id IS NULL OR cg.released_at IS NULL)
		    AND ($3::uuid IS NULL OR c.teacher_id = $3::uuid)
		  ORDER BY sub.submitted_at ASC NULLS LAST, sub.id ASC
		  LIMIT $4`,
		now, center.ID, tID, DashboardRailLimitForPlan)

	// student dueSoon — the NEW ListStudentDueSoon path (open-status filter + the
	// enrollment/exercise joins). Proves the added query has a usable index too.
	dashExplainNoSeqScan(t, db, "dueSoon(ListStudentDueSoon)",
		`SELECT a.id, a.deadline_at,
		        e.title AS exercise_title, e.skill AS exercise_skill,
		        sub.id AS submission_id, sub.status AS submission_status
		   FROM assignments a
		   JOIN enrollments en ON en.class_id = a.class_id
		       AND en.student_id = $1 AND en.status = 'active'
		   JOIN exercises e ON e.id = a.exercise_id
		   LEFT JOIN submissions sub ON sub.assignment_id = a.id
		       AND sub.student_id = $1
		  WHERE a.center_id = $2 AND a.status = 'open'
		  ORDER BY a.deadline_at ASC, a.id ASC
		  LIMIT $3`,
		student, center.ID, DashboardRailLimitForPlan)
}

// DashboardRailLimitForPlan is the LIMIT value bound into the EXPLAIN'd rail queries.
// It mirrors service.DashboardRailLimit (the story's fixed ≤N rail cap); EXPLAIN only
// plans, so the exact value does not affect the chosen access path.
const DashboardRailLimitForPlan = 5

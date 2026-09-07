// Story 7.2a (AC9/AC10 · D6 · risk=7) — the DERIVED aggregates: per-skill band
// (submission→assignment.exercise_id→exercises.skill; NO stored per-skill column)
// and attendance-rate ((present+late)/total_marked). Real DB in tx. Store-seam
// reds proving the derivation joins are correct; the Good/Normal split + null
// handling live at the service seam (AtRiskDetector + GetStudentDetail).
//
// ★ Correction folded from recon: assignments use `deadline_at` (NOT `due_at`);
// on-time = submissions.submitted_at <= assignments.deadline_at (an is_late column
// also exists). exercises.skill enum = reading|listening|writing|speaking|grammar|
// vocabulary|general — the 4-box breakdown surfaces ONLY the 4 IELTS skills
// (grammar/vocabulary/general excluded at the SERVICE, still counted in overallBand).
//
// RED (`//go:build atdd_red_phase`, quarantined): compile-fails on GREENFIELD seams —
// generated.StudentPerSkillBands / GetStudentAttendanceStats.
//
// GREEN SEAMS (dev — Task 3 queries/students.sql):
//
//	StudentPerSkillBands(ctx, {CenterID, StudentID}) → []{Skill string, AvgBand pgtype.Numeric}
//	  -- avg overall_band of the student's RELEASED current grades (current_grades, released_at IS NOT NULL),
//	     grouped by exercises.skill. Teacher-scope variant filters to caller-visible classes.
//	GetStudentAttendanceStats(ctx, {CenterID, StudentID}) → {PresentLate int64, TotalMarked int64}
//	  -- present+late vs total attendance rows for the student's caller-visible sessions.
package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// seedReleasedGrade builds the full chain exercise(skill)→assignment→submission(graded)
// →grade(released, overall_band=band). Tenant context must be set by the caller.
func seedReleasedGrade(t *testing.T, db *TxDB, centerID, classID, studentID, authorID uuid.UUID, skill string, band float64) {
	t.Helper()
	ctx := context.Background()
	exID, asID, subID := uuid.New(), uuid.New(), uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill) VALUES ($1,$2,$3,$4,'Ex',$5)`,
		exID, centerID, authorID, "EX-"+uuid.NewString()[:8], skill); err != nil {
		t.Fatalf("seed exercise(%s): %v", skill, err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, deadline_at) VALUES ($1,$2,$3,$4,$5,$6)`,
		asID, centerID, exID, classID, authorID, fixedLoadNow.Add(-24*time.Hour)); err != nil {
		t.Fatalf("seed assignment: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, submitted_at) VALUES ($1,$2,$3,$4,'graded',$5)`,
		subID, centerID, asID, studentID, fixedLoadNow.Add(-25*time.Hour)); err != nil {
		t.Fatalf("seed submission: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO grades (id, submission_id, center_id, graded_by, version, criterion_scores, overall_band, released_at)
		 VALUES ($1,$2,$3,$4,1,'{}'::jsonb,$5,$6)`,
		uuid.New(), subID, centerID, authorID, band, fixedLoadNow.Add(-23*time.Hour)); err != nil {
		t.Fatalf("seed grade: %v", err)
	}
}

func numericToFloat(t *testing.T, n pgtype.Numeric) float64 {
	t.Helper()
	v, err := n.Float64Value()
	if err != nil {
		t.Fatalf("numeric→float: %v", err)
	}
	return v.Float64
}

// AC9/D6 — per-skill band derives from exercises.skill; only skills with a
// released grade appear, at the correct average.
func TestStudentPerSkillBands_Derivation_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	cid := uuidFromPg(center.ID)
	TenantContext(t, db, center.ID)

	author := seedTeacher(t, db, cid, "author@example.com")
	class := seedClassWithTeacher(t, db, cid, author)
	student := seedStudentMember(t, db, cid, "stu@example.com", "Stu")
	seedActiveEnrollment(t, db, cid, student, class)

	seedReleasedGrade(t, db, cid, class, student, author, "reading", 6.0)
	seedReleasedGrade(t, db, cid, class, student, author, "reading", 6.0) // avg stays 6.0
	seedReleasedGrade(t, db, cid, class, student, author, "writing", 7.0)

	rows, err := generated.New(db).StudentPerSkillBands(context.Background(), generated.StudentPerSkillBandsParams{
		CenterID: pgUUID(cid), StudentID: pgUUID(student),
	})
	if err != nil {
		t.Fatalf("per-skill: %v", err)
	}
	got := map[string]float64{}
	for _, r := range rows {
		got[r.Skill] = numericToFloat(t, r.AvgBand)
	}
	if got["reading"] != 6.0 {
		t.Errorf("reading: got %v, want 6.0", got["reading"])
	}
	if got["writing"] != 7.0 {
		t.Errorf("writing: got %v, want 7.0", got["writing"])
	}
	if _, ok := got["listening"]; ok {
		t.Errorf("listening must be ABSENT (no graded submission), got %v", got["listening"])
	}
	if _, ok := got["speaking"]; ok {
		t.Errorf("speaking must be ABSENT (no graded submission), got %v", got["speaking"])
	}
}

// AC10/D6 — attendance rate inputs: present+late vs total; absent counts in the
// denominator only.
func TestStudentAttendanceStats_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	cid := uuidFromPg(center.ID)
	TenantContext(t, db, center.ID)

	author := seedTeacher(t, db, cid, "author@example.com")
	class := seedClassWithTeacher(t, db, cid, author)
	student := seedStudentMember(t, db, cid, "stu@example.com", "Stu")
	seedActiveEnrollment(t, db, cid, student, class)

	for _, status := range []string{"present", "late", "absent"} {
		sid := uuid.New()
		if _, err := db.Exec(context.Background(),
			`INSERT INTO sessions (id, center_id, class_id, starts_at, ends_at, status)
			 VALUES ($1,$2,$3,$4,$4::timestamptz + interval '90 minutes','scheduled')`,
			sid, cid, class, fixedLoadNow.Add(-48*time.Hour)); err != nil {
			t.Fatalf("seed session: %v", err)
		}
		if _, err := db.Exec(context.Background(),
			`INSERT INTO attendance (id, center_id, session_id, student_id, status, marked_by) VALUES ($1,$2,$3,$4,$5,$6)`,
			uuid.New(), cid, sid, student, status, author); err != nil {
			t.Fatalf("seed attendance(%s): %v", status, err)
		}
	}

	stats, err := generated.New(db).GetStudentAttendanceStats(context.Background(), generated.GetStudentAttendanceStatsParams{
		CenterID: pgUUID(cid), StudentID: pgUUID(student),
	})
	if err != nil {
		t.Fatalf("attendance stats: %v", err)
	}
	if stats.PresentLate != 2 {
		t.Errorf("present+late: got %d, want 2", stats.PresentLate)
	}
	if stats.TotalMarked != 3 {
		t.Errorf("total_marked: got %d, want 3 (absent counts in denominator)", stats.TotalMarked)
	}
}

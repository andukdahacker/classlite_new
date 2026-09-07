// Story 7.2a (AC10/AC11 · D4 · risk=7) — the at-risk INPUT queries that feed the
// detector: the ★ consecutive-missed LEADING RUN over deadline_at (a total-miss
// count false-greens it) and the on-time / pending / missing split at
// clock.Now(). Real DB in tx, bound @now (never SQL now()). The detector's
// threshold math is proven separately in at_risk_detector_atdd_test.go; these
// prove the SQL produces the right raw inputs.
//
// RED (`//go:build atdd_red_phase`): compile-fails on the GREENFIELD store seams
// generated.GetStudentAtRiskInputs / GetStudentSubmissionStats.
package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func seedInputAssignment(t *testing.T, db *TxDB, centerID, classID, authorID uuid.UUID, deadline time.Time) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	exID, asID := uuid.New(), uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill) VALUES ($1,$2,$3,$4,'Ex','reading')`,
		exID, centerID, authorID, "EX-"+uuid.NewString()[:8]); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, deadline_at) VALUES ($1,$2,$3,$4,$5,$6)`,
		asID, centerID, exID, classID, authorID, deadline); err != nil {
		t.Fatalf("seed assignment: %v", err)
	}
	return asID
}

func seedInputSubmission(t *testing.T, db *TxDB, centerID, assignmentID, studentID uuid.UUID, status string, submittedAt time.Time) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, submitted_at) VALUES ($1,$2,$3,$4,$5,$6)`,
		uuid.New(), centerID, assignmentID, studentID, status, submittedAt); err != nil {
		t.Fatalf("seed submission(%s): %v", status, err)
	}
}

// ★ AC11 — consecutive_missed is the LEADING RUN of most-recent past-due misses,
// NOT the total miss count. Student misses the two most recent (leading run 2);
// a second student misses two NON-adjacent (leading run 1 — the most recent was
// submitted).
func TestStudentAtRiskInputs_ConsecutiveMissed_LeadingRun_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	cid := uuidFromPg(center.ID)
	TenantContext(t, db, center.ID)

	author := seedTeacher(t, db, cid, "author@example.com")

	// Each student has their OWN class so their assignment sets are disjoint.
	// Student 1: A1(oldest) submitted, A2 + A3(newest) missed → leading run 2.
	class1 := seedClassWithTeacher(t, db, cid, author)
	s1 := seedStudentMember(t, db, cid, "s1@example.com", "S1")
	seedActiveEnrollment(t, db, cid, s1, class1)
	a1 := seedInputAssignment(t, db, cid, class1, author, fixedLoadNow.Add(-72*time.Hour))
	seedInputAssignment(t, db, cid, class1, author, fixedLoadNow.Add(-48*time.Hour)) // A2 missed
	seedInputAssignment(t, db, cid, class1, author, fixedLoadNow.Add(-24*time.Hour)) // A3 missed
	seedInputSubmission(t, db, cid, a1, s1, "submitted", fixedLoadNow.Add(-73*time.Hour))

	// Student 2: A1 missed, A2 submitted, A3(newest) missed → leading run 1.
	class2 := seedClassWithTeacher(t, db, cid, author)
	s2 := seedStudentMember(t, db, cid, "s2@example.com", "S2")
	seedActiveEnrollment(t, db, cid, s2, class2)
	seedInputAssignment(t, db, cid, class2, author, fixedLoadNow.Add(-72*time.Hour)) // A1 missed
	b2 := seedInputAssignment(t, db, cid, class2, author, fixedLoadNow.Add(-48*time.Hour))
	seedInputAssignment(t, db, cid, class2, author, fixedLoadNow.Add(-24*time.Hour)) // A3 missed
	seedInputSubmission(t, db, cid, b2, s2, "graded", fixedLoadNow.Add(-49*time.Hour))

	q := generated.New(db)
	in1, err := q.GetStudentAtRiskInputs(context.Background(), generated.GetStudentAtRiskInputsParams{
		StudentID: pgUUID(s1), TeacherID: pgtype.UUID{Valid: false}, Now: loadNowArg(),
	})
	if err != nil {
		t.Fatalf("s1 inputs: %v", err)
	}
	if in1.ConsecutiveMissed != 2 {
		t.Errorf("s1 consecutive_missed: got %d, want 2 (leading run of the two most recent)", in1.ConsecutiveMissed)
	}

	in2, err := q.GetStudentAtRiskInputs(context.Background(), generated.GetStudentAtRiskInputsParams{
		StudentID: pgUUID(s2), TeacherID: pgtype.UUID{Valid: false}, Now: loadNowArg(),
	})
	if err != nil {
		t.Fatalf("s2 inputs: %v", err)
	}
	if in2.ConsecutiveMissed != 1 {
		t.Errorf("s2 consecutive_missed: got %d, want 1 (most recent missed, prior submitted — leading run, not total)", in2.ConsecutiveMissed)
	}
}

// AC10 — on-time / submitted / pending / missing split at the bound @now.
func TestStudentSubmissionStats_Split_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	cid := uuidFromPg(center.ID)
	TenantContext(t, db, center.ID)

	author := seedTeacher(t, db, cid, "author@example.com")
	class := seedClassWithTeacher(t, db, cid, author)
	student := seedStudentMember(t, db, cid, "stu@example.com", "Stu")
	seedActiveEnrollment(t, db, cid, student, class)

	onTime := seedInputAssignment(t, db, cid, class, author, fixedLoadNow.Add(-24*time.Hour))
	seedInputSubmission(t, db, cid, onTime, student, "graded", fixedLoadNow.Add(-25*time.Hour)) // before deadline

	late := seedInputAssignment(t, db, cid, class, author, fixedLoadNow.Add(-24*time.Hour))
	seedInputSubmission(t, db, cid, late, student, "submitted", fixedLoadNow.Add(-23*time.Hour)) // after deadline

	seedInputAssignment(t, db, cid, class, author, fixedLoadNow.Add(24*time.Hour)) // pending (future, no sub)
	seedInputAssignment(t, db, cid, class, author, fixedLoadNow.Add(-1*time.Hour)) // missing (past, no sub)

	stats, err := generated.New(db).GetStudentSubmissionStats(context.Background(), generated.GetStudentSubmissionStatsParams{
		CenterID: pgUUID(cid), StudentID: pgUUID(student), TeacherID: pgtype.UUID{Valid: false}, Now: loadNowArg(),
	})
	if err != nil {
		t.Fatalf("submission stats: %v", err)
	}
	if stats.OnTimeCount != 1 {
		t.Errorf("on_time_count: got %d, want 1", stats.OnTimeCount)
	}
	if stats.SubmittedCount != 2 {
		t.Errorf("submitted_count: got %d, want 2", stats.SubmittedCount)
	}
	if stats.PendingCount != 1 {
		t.Errorf("pending_count: got %d, want 1", stats.PendingCount)
	}
	if stats.MissingCount != 1 {
		t.Errorf("missing_count: got %d, want 1", stats.MissingCount)
	}
}

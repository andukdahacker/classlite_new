// Story 5.1 (AC7–15) — submission lifecycle + FR-23 lock behavior, driven at the
// service layer against a real DB (TxDB) with an injected MockClock for the
// exact-instant boundary tests (Murat: for every boundary test, the exact instant
// — not either side). errors.As on the typed service errors proves the 8 codes.
package test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

type subEnv struct {
	db            *TxDB
	clk           *clock.MockClock
	assignmentSvc *service.AssignmentService
	submissionSvc *service.SubmissionService
	exerciseSvc   *service.ExerciseService
	centerID      uuid.UUID
	classID       uuid.UUID
	exerciseID    uuid.UUID
	teacherID     uuid.UUID
	studentID     uuid.UUID
	studentTC     model.TenantContext
	teacherTC     model.TenantContext
}

// mockBase is a fixed wall time all lifecycle tests anchor to.
var mockBase = time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)

// setupSubEnv seeds center/users/members/class/exercise/enrollment under RLS and
// wires the three services on a shared MockClock. timeLimitMinutes=0 → untimed.
func setupSubEnv(t *testing.T, clk *clock.MockClock, timeLimitMinutes int) *subEnv {
	t.Helper()
	db := SetupDB(t)
	ctx := context.Background()
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerID := uuid.UUID(center.ID.Bytes)
	TenantContext(t, db, center.ID)

	teacherID := rlsInsertUserAS(t, db, "teacher-"+uuid.NewString()+"@example.com")
	studentID := rlsInsertUserAS(t, db, "student-"+uuid.NewString()+"@example.com")
	CreateCenterMember(t, db, pgUUIDFromGo(teacherID), center.ID, "owner")
	CreateCenterMember(t, db, pgUUIDFromGo(studentID), center.ID, "student")

	classID := uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'C','active',$3)`,
		classID, centerID, teacherID); err != nil {
		t.Fatalf("seed class: %v", err)
	}
	settings := `{"timeLimitEnabled":false,"timeLimitMinutes":0,"caseSensitive":false}`
	if timeLimitMinutes > 0 {
		settings = `{"timeLimitEnabled":true,"timeLimitMinutes":` + itoa(timeLimitMinutes) + `,"caseSensitive":false}`
	}
	exerciseID := uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1,$2,$3,$4,'Ex','reading',$5,1)`,
		exerciseID, centerID, teacherID, "EX-"+exerciseID.String()[:8],
		`{"sections":[],"settings":`+settings+`}`); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`,
		uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("seed enrollment: %v", err)
	}

	audit := service.NewAuditService(db)
	return &subEnv{
		db: db, clk: clk,
		assignmentSvc: service.NewAssignmentService(db, audit, nil, clk),
		submissionSvc: service.NewSubmissionService(db, audit, clk),
		exerciseSvc:   service.NewExerciseService(db, audit, clk),
		centerID:      centerID, classID: classID, exerciseID: exerciseID,
		teacherID: teacherID, studentID: studentID,
		studentTC: model.TenantContext{CenterID: centerID.String(), UserID: studentID.String(), Role: model.RoleStudent, EmailVerified: true},
		teacherTC: model.TenantContext{CenterID: centerID.String(), UserID: teacherID.String(), Role: model.RoleOwner, EmailVerified: true},
	}
}

// insertAssignment raw-inserts an assignment (bypassing the create path) so each
// test controls deadline/hardDeadline/penalty/status precisely.
func (e *subEnv) insertAssignment(t *testing.T, deadline time.Time, hard *time.Time, penalty float64, status string) uuid.UUID {
	t.Helper()
	TenantContext(t, e.db, pgUUIDFromGo(e.centerID))
	id := uuid.New()
	if _, err := e.db.Exec(context.Background(),
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, hard_deadline_at, late_penalty)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		id, e.centerID, e.exerciseID, e.classID, e.teacherID, status, deadline, hard, penalty); err != nil {
		t.Fatalf("insert assignment: %v", err)
	}
	return id
}

func (e *subEnv) startAttempt(t *testing.T, assignmentID uuid.UUID) service.SubmissionResult {
	t.Helper()
	res, err := e.submissionSvc.Start(context.Background(), e.studentTC, assignmentID)
	if err != nil {
		t.Fatalf("start attempt: %v", err)
	}
	return res
}

// --- AC11: exact-deadline boundary (the `>` vs `>=` tripwire) ---

func TestSubmit_ExactlyAtDeadline_IsNotLate(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	deadline := mockBase.Add(1 * time.Hour)
	aid := e.insertAssignment(t, deadline, nil, 2.0, "open")
	sub := e.startAttempt(t, aid)

	// Submit at the EXACT deadline instant — strictly `>` means NOT late.
	clk.Set(deadline)
	res, err := e.submissionSvc.Submit(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if res.Row.IsLate {
		t.Error("AC11 VIOLATION: submission exactly at the deadline was flagged late (must be > , not >=)")
	}
	if got := numericToFloatTest(t, e, uuid.UUID(res.Row.ID.Bytes)); got != 0 {
		t.Errorf("on-time submission has applied_penalty=%v, want 0", got)
	}
}

func TestSubmit_OneNanoPastDeadline_IsLate(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	deadline := mockBase.Add(1 * time.Hour)
	aid := e.insertAssignment(t, deadline, nil, 2.5, "open")
	sub := e.startAttempt(t, aid)

	// Postgres timestamptz is microsecond-resolution, so 1µs is the true smallest
	// step past the deadline (a sub-µs delta rounds back onto the deadline instant).
	clk.Set(deadline.Add(1 * time.Microsecond))
	res, err := e.submissionSvc.Submit(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if !res.Row.IsLate {
		t.Error("AC11 VIOLATION: submission one microsecond past the deadline was NOT flagged late")
	}
}

// --- AC12: point-in-time penalty snapshot ---

func TestSubmit_SnapshotIsPointInTime_NotLiveReference(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	deadline := mockBase.Add(1 * time.Hour)
	aid := e.insertAssignment(t, deadline, nil, 2.5, "open")
	sub := e.startAttempt(t, aid)

	clk.Set(deadline.Add(1 * time.Hour)) // late
	res, err := e.submissionSvc.Submit(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if !res.Row.IsLate {
		t.Fatal("precondition: late submission expected")
	}
	if got := numericToFloatTest(t, e, uuid.UUID(res.Row.ID.Bytes)); got != 2.5 {
		t.Fatalf("applied_penalty snapshot=%v, want 2.5", got)
	}
	// Mutate the assignment's live penalty AFTER submit; the snapshot must not move.
	TenantContext(t, e.db, pgUUIDFromGo(e.centerID))
	if _, err := e.db.Exec(context.Background(), `UPDATE assignments SET late_penalty=9.0 WHERE id=$1`, aid); err != nil {
		t.Fatalf("mutate penalty: %v", err)
	}
	if got := numericToFloatTest(t, e, uuid.UUID(res.Row.ID.Bytes)); got != 2.5 {
		t.Errorf("AC12 VIOLATION: applied_penalty moved to %v after a live-penalty edit (want frozen 2.5)", got)
	}
}

// --- AC13: hard-deadline lock (inclusive) + hard==soft lock-wins ---

func TestSubmit_HardEqualsSoftDeadline_LockWins(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	deadline := mockBase.Add(1 * time.Hour)
	hard := deadline // hard == soft
	aid := e.insertAssignment(t, deadline, &hard, 1.0, "open")
	sub := e.startAttempt(t, aid)

	// At the instant hard==soft, the inclusive hard lock wins over "on-time".
	clk.Set(hard)
	_, err := e.submissionSvc.Submit(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes))
	var locked *service.SubmissionLockedError
	if !errors.As(err, &locked) {
		t.Fatalf("AC13 VIOLATION: expected SUBMISSION_LOCKED at the inclusive hard deadline, got %v", err)
	}
}

func TestStart_PastHardDeadline_Locked(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	deadline := mockBase.Add(1 * time.Hour)
	hard := mockBase.Add(2 * time.Hour)
	aid := e.insertAssignment(t, deadline, &hard, 1.0, "open")

	clk.Set(hard.Add(time.Second))
	_, err := e.submissionSvc.Start(context.Background(), e.studentTC, aid)
	var locked *service.SubmissionLockedError
	if !errors.As(err, &locked) {
		t.Fatalf("expected SUBMISSION_LOCKED starting past the hard deadline, got %v", err)
	}
}

func TestStart_ClosedAssignment_Locked(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(time.Hour), nil, 0, "closed")
	_, err := e.submissionSvc.Start(context.Background(), e.studentTC, aid)
	var locked *service.SubmissionLockedError
	if !errors.As(err, &locked) {
		t.Fatalf("expected SUBMISSION_LOCKED on a closed assignment, got %v", err)
	}
}

// --- AC10: server-side time-limit enforcement on /progress ---

func TestProgress_PastTimeLimit_409TimeExpired(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 30) // 30-minute limit
	aid := e.insertAssignment(t, mockBase.Add(24*time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)

	// Well past 30 min + grace.
	clk.Set(mockBase.Add(31 * time.Minute))
	_, err := e.submissionSvc.SaveProgress(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes), []byte(`{"answer":"x"}`))
	var expired *service.TimeExpiredError
	if !errors.As(err, &expired) {
		t.Fatalf("AC10 VIOLATION: expected TIME_EXPIRED past the time limit, got %v", err)
	}
}

func TestProgress_WithinTimeLimit_OK(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 30)
	aid := e.insertAssignment(t, mockBase.Add(24*time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)
	if sub.TimeBudgetSeconds == nil || *sub.TimeBudgetSeconds != 30*60 {
		t.Fatalf("timeBudgetSeconds=%v, want 1800", sub.TimeBudgetSeconds)
	}
	clk.Set(mockBase.Add(10 * time.Minute))
	if _, err := e.submissionSvc.SaveProgress(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes), []byte(`{"answer":"x"}`)); err != nil {
		t.Fatalf("save within limit: %v", err)
	}
}

func TestSubmit_AllowedAfterTimeExpiry(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 30)
	aid := e.insertAssignment(t, mockBase.Add(24*time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)
	clk.Set(mockBase.Add(45 * time.Minute)) // past the limit
	if _, err := e.submissionSvc.Submit(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes)); err != nil {
		t.Fatalf("AC10 VIOLATION: submit must be allowed after time expiry (client auto-submits), got %v", err)
	}
}

// --- AC7: idempotent start/resume ---

func TestStart_ResumeReturnsSameRow_NeverResetsStartedAt(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(time.Hour), nil, 0, "open")
	first := e.startAttempt(t, aid)
	if !first.Created {
		t.Fatal("first start should create (201)")
	}
	// Advance the clock, then resume — must return the SAME row, started_at intact.
	clk.Set(mockBase.Add(10 * time.Minute))
	second, err := e.submissionSvc.Start(context.Background(), e.studentTC, aid)
	if err != nil {
		t.Fatalf("resume: %v", err)
	}
	if second.Created {
		t.Error("AC7 VIOLATION: resume created a new row instead of returning the existing one")
	}
	if second.Row.ID != first.Row.ID {
		t.Error("AC7 VIOLATION: resume returned a different submission row")
	}
	if !second.Row.StartedAt.Time.Equal(first.Row.StartedAt.Time) {
		t.Errorf("AC7 VIOLATION: started_at reset on resume (%v → %v)", first.Row.StartedAt.Time, second.Row.StartedAt.Time)
	}
}

func TestStart_TerminalSubmission_409Exists(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)
	if _, err := e.submissionSvc.Submit(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes)); err != nil {
		t.Fatalf("submit: %v", err)
	}
	_, err := e.submissionSvc.Start(context.Background(), e.studentTC, aid)
	var exists *service.SubmissionExistsError
	if !errors.As(err, &exists) {
		t.Fatalf("AC7 VIOLATION: expected SUBMISSION_EXISTS after a terminal submission, got %v", err)
	}
}

// --- AC8: enrollment gate re-checked every write ---

func TestSubmit_StudentWithdrawnMidAttempt_403(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)

	// Withdraw the student AFTER they started (Murat #11).
	TenantContext(t, e.db, pgUUIDFromGo(e.centerID))
	if _, err := e.db.Exec(context.Background(),
		`UPDATE enrollments SET status='withdrawn' WHERE class_id=$1 AND student_id=$2`, e.classID, e.studentID); err != nil {
		t.Fatalf("withdraw: %v", err)
	}
	_, err := e.submissionSvc.Submit(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes))
	var notEnrolled *service.NotEnrolledError
	if !errors.As(err, &notEnrolled) {
		t.Fatalf("AC8 VIOLATION: withdrawn student could submit (got %v)", err)
	}
}

func TestProgress_StillEnrolled_200(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)
	if _, err := e.submissionSvc.SaveProgress(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes), []byte(`{"answer":"x"}`)); err != nil {
		t.Fatalf("enrolled student save should succeed: %v", err)
	}
}

func TestStart_NonStudent_403InsufficientRole(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(time.Hour), nil, 0, "open")
	_, err := e.submissionSvc.Start(context.Background(), e.teacherTC, aid)
	var forbidden *service.ForbiddenError
	if !errors.As(err, &forbidden) {
		t.Fatalf("AC8 VIOLATION: non-student could start (got %v)", err)
	}
}

// --- AC14: no lifecycle path reaches graded ---

func TestSubmit_CannotTransitionToGraded(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)
	res, err := e.submissionSvc.Submit(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if res.Row.Status != "submitted" {
		t.Errorf("AC14 VIOLATION: submit produced status %q, want submitted (no path to graded/ai_processing)", res.Row.Status)
	}
}

// --- AC9: save-progress guard ---

func TestProgress_AfterSubmit_409NotEditable(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)
	if _, err := e.submissionSvc.Submit(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes)); err != nil {
		t.Fatalf("submit: %v", err)
	}
	_, err := e.submissionSvc.SaveProgress(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes), []byte(`{"answer":"y"}`))
	var notEditable *service.SubmissionNotEditableError
	if !errors.As(err, &notEditable) {
		t.Fatalf("AC9 VIOLATION: saved progress on a submitted row (got %v)", err)
	}
}

// --- AC15/16: FR-23 exercise lock ---

func TestExerciseUpdate_WithSubmission_409ExerciseLocked(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(time.Hour), nil, 0, "open")
	e.startAttempt(t, aid) // now the exercise has >= 1 submission → locked

	// Read the current updated_at for the precondition.
	TenantContext(t, e.db, pgUUIDFromGo(e.centerID))
	var updatedAt time.Time
	if err := e.db.QueryRow(context.Background(), `SELECT updated_at FROM exercises WHERE id=$1`, e.exerciseID).Scan(&updatedAt); err != nil {
		t.Fatalf("read updated_at: %v", err)
	}
	newTitle := "Blocked edit"
	_, err := e.exerciseSvc.Update(context.Background(), e.teacherTC, e.exerciseID, service.UpdateExerciseInput{
		Title:        &newTitle,
		Precondition: &updatedAt,
	})
	var locked *service.ExerciseLockedError
	if !errors.As(err, &locked) {
		t.Fatalf("AC15 VIOLATION: edited a locked exercise (got %v)", err)
	}
}

func TestExerciseDelete_WithSubmission_409ExerciseLocked(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(time.Hour), nil, 0, "open")
	e.startAttempt(t, aid)
	err := e.exerciseSvc.SoftDelete(context.Background(), e.teacherTC, e.exerciseID)
	var locked *service.ExerciseLockedError
	if !errors.As(err, &locked) {
		t.Fatalf("AC15 VIOLATION: deleted a locked exercise (got %v)", err)
	}
}

func TestExerciseGet_Locked_ReportsLockedBy(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(time.Hour), nil, 0, "open")
	e.startAttempt(t, aid)
	got, err := e.exerciseSvc.Get(context.Background(), e.teacherTC, e.exerciseID)
	if err != nil {
		t.Fatalf("get exercise: %v", err)
	}
	if !got.Locked {
		t.Error("AC16 VIOLATION: locked exercise reports locked=false")
	}
	if len(got.LockedBy) != 1 {
		t.Fatalf("AC16 VIOLATION: lockedBy has %d entries, want 1", len(got.LockedBy))
	}
	if got.LockedBy[0].AttemptState != "in_progress" {
		t.Errorf("lockedBy attemptState=%q, want in_progress", got.LockedBy[0].AttemptState)
	}
}

func TestExerciseUpdate_NoSubmissions_Succeeds(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	// No assignment/submission → not locked → edit succeeds (negative control).
	TenantContext(t, e.db, pgUUIDFromGo(e.centerID))
	var updatedAt time.Time
	if err := e.db.QueryRow(context.Background(), `SELECT updated_at FROM exercises WHERE id=$1`, e.exerciseID).Scan(&updatedAt); err != nil {
		t.Fatalf("read updated_at: %v", err)
	}
	newTitle := "Free edit"
	if _, err := e.exerciseSvc.Update(context.Background(), e.teacherTC, e.exerciseID, service.UpdateExerciseInput{
		Title:        &newTitle,
		Precondition: &updatedAt,
	}); err != nil {
		t.Fatalf("unlocked exercise edit should succeed: %v", err)
	}
}

// --- helpers ---

func numericToFloatTest(t *testing.T, e *subEnv, submissionID uuid.UUID) float64 {
	t.Helper()
	TenantContext(t, e.db, pgUUIDFromGo(e.centerID))
	var f float64
	if err := e.db.QueryRow(context.Background(), `SELECT applied_penalty::float8 FROM submissions WHERE id=$1`, submissionID).Scan(&f); err != nil {
		t.Fatalf("read applied_penalty: %v", err)
	}
	return f
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

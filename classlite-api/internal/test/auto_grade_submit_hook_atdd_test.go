// Story 6.4a (AC1/AC3 · D4/D13/D14/D15 · R16=6) — the SYNCHRONOUS auto-grade hook
// inside SubmissionService.Submit, wrapped in a SAVEPOINT fault boundary. This file
// owns the party-mode NON-NEGOTIABLE red: the D13 fault-injection proof that a student
// submit STILL COMMITS as 'submitted' even when the auto-grade engine panics or errors
// — a grading defect must never block a submission. Also proves the hook FIRES for
// objective content (1 working row) and SKIPS cleanly for writing/speaking (0 rows).
// Service layer over the real DB in a tx (SetupDB, RLS enforced under classlite_app).
//
// GREEN (de-tagged, runs in `go test ./...`): the reds landed build-tagged
// `atdd_red_phase` before in-progress (WF-8 gate); the SubmissionService.WithAutoGrade
// hook + service.AutoGrader seam + auto_grade_results table now exist, so the tag was
// removed and this fault-boundary suite is permanent regression coverage.
//
// SEAMS (dev, green — the ONE place to reconcile):
//   - service.AutoGrader interface:
//         GradeOnSubmit(ctx context.Context, tx pgx.Tx, tc model.TenantContext, submissionID uuid.UUID) error
//     Invoked by Submit INSIDE a post-flip SAVEPOINT (D13). Production wiring reads the
//     live exercise via store.UnmarshalExerciseContent (D14, NOT the answer-stripped
//     attempt bundle), runs the pure grading.Grade engine (D15), and INSERTs one
//     auto_grade_results row. On ANY failure — returned error OR panic (recovered) —
//     Submit rolls back to the savepoint and the OUTER tx still commits 'submitted'.
//   - (*SubmissionService).WithAutoGrade(g service.AutoGrader) *service.SubmissionService
//     Builder mirroring the existing .WithStorage(mock) (6.3a). NewSubmissionService
//     wires the REAL auto-grader by default; tests inject a failing/panicking double.
//   - The default-wired service auto-grades objective submits; the two doubles below
//     prove the fault boundary.
package test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// --- fault-injection doubles satisfying service.AutoGrader ---

type panicAutoGrader struct{}

func (panicAutoGrader) GradeOnSubmit(context.Context, pgx.Tx, model.TenantContext, uuid.UUID) error {
	panic("boom: auto-grade engine defect")
}

type errAutoGrader struct{}

func (errAutoGrader) GradeOnSubmit(context.Context, pgx.Tx, model.TenantContext, uuid.UUID) error {
	return errors.New("auto_grade_results insert failed")
}

// poisonAutoGrader runs a genuinely-failing SQL statement on the submit tx (division by
// zero → a real Postgres error that POISONS the pgx-v5 tx), then returns. Unlike the panic
// and error doubles above — which fail BEFORE touching the DB — this is the only one that
// exercises the actual D13 mechanism: a poisoned pgx tx rejects every subsequent statement,
// so ROLLBACK TO SAVEPOINT must UN-POISON it for the outer submit to still COMMIT.
type poisonAutoGrader struct{}

func (poisonAutoGrader) GradeOnSubmit(ctx context.Context, tx pgx.Tx, _ model.TenantContext, _ uuid.UUID) error {
	if _, err := tx.Exec(ctx, `SELECT 1/0`); err != nil {
		return fmt.Errorf("auto-grade poisoned the tx: %w", err)
	}
	return errors.New("expected the failing statement to error")
}

type autoGradeHookEnv struct {
	db           *TxDB
	centerID     uuid.UUID
	studentTC    model.TenantContext
	assignmentID uuid.UUID
	classID      uuid.UUID
	studentID    uuid.UUID
	audit        service.AuditLogger
}

// objectiveExerciseContent is a reading section with one multiple_choice question
// (answer "The fox"); colon-handle 0:0:0.
const objectiveExerciseContent = `{
  "sections":[{"type":"reading","title":"","content":"","questionGroups":[
    {"type":"multiple_choice","instructions":"","questions":[
      {"text":"?","type":"multiple_choice","options":["The fox","The dog"],"correctAnswer":"The fox","acceptedVariants":[]}
    ]}
  ]}],
  "settings":{"timeLimitEnabled":false,"timeLimitMinutes":0,"caseSensitive":false}
}`

func setupAutoGradeHookEnv(t *testing.T) autoGradeHookEnv {
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
	if _, err := db.Exec(ctx, `INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'C','active',$3)`, classID, centerID, teacherID); err != nil {
		t.Fatalf("seed class: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`, uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("seed enrollment: %v", err)
	}

	return autoGradeHookEnv{
		db:        db,
		centerID:  centerID,
		classID:   classID,
		studentID: studentID,
		audit:     service.NewAuditService(db),
		studentTC: model.TenantContext{CenterID: centerID.String(), UserID: studentID.String(), Role: model.RoleStudent, EmailVerified: true},
	}
}

// seedInProgressSubmission raw-inserts an objective (or writing/speaking) exercise +
// open assignment + an in_progress submission owning the given AttemptContent blob,
// and returns the submission id.
func (e autoGradeHookEnv) seedInProgressSubmission(t *testing.T, skill, exerciseContent, attemptContent string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	teacherID := rlsInsertUserAS(t, e.db, "author-"+uuid.NewString()+"@example.com")
	CreateCenterMember(t, e.db, pgUUIDFromGo(teacherID), pgUUIDFromGo(e.centerID), "teacher")
	exerciseID := uuid.New()
	if _, err := e.db.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1,$2,$3,$4,'Ex',$5,$6,1)`,
		exerciseID, e.centerID, teacherID, "EX-"+exerciseID.String()[:8], skill, exerciseContent); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	assignmentID := rlsInsertAssignment(t, e.db, e.centerID, exerciseID, e.classID, teacherID)
	subID := uuid.New()
	if _, err := e.db.Exec(ctx,
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, started_at)
		 VALUES ($1,$2,$3,$4,'in_progress',$5,1, now())`,
		subID, e.centerID, assignmentID, e.studentID, attemptContent); err != nil {
		t.Fatalf("seed in_progress submission: %v", err)
	}
	return subID
}

func (e autoGradeHookEnv) submissionStatus(t *testing.T, subID uuid.UUID) string {
	t.Helper()
	var s string
	if err := e.db.QueryRow(context.Background(), `SELECT status FROM submissions WHERE id=$1`, subID).Scan(&s); err != nil {
		t.Fatalf("read status: %v", err)
	}
	return s
}

func (e autoGradeHookEnv) autoGradeRowCount(t *testing.T, subID uuid.UUID) int {
	t.Helper()
	var n int
	if err := e.db.QueryRow(context.Background(), `SELECT count(*) FROM auto_grade_results WHERE submission_id=$1`, subID).Scan(&n); err != nil {
		t.Fatalf("count auto_grade_results: %v", err)
	}
	return n
}

const attemptCorrectBlob = `{"schemaVersion":1,"answers":{"0:0:0":"The fox"},"flagged":[]}`

// -----------------------------------------------------------------------------
// AC3 / D13 — THE non-negotiable red: a panicking auto-grader must NOT block submit.
// Submit still commits 'submitted', the SAVEPOINT is rolled back → zero working rows.
// -----------------------------------------------------------------------------

func TestAutoGradeSubmit_EnginePanics_SubmitStillCommits_ATDD(t *testing.T) {
	e := setupAutoGradeHookEnv(t)
	subID := e.seedInProgressSubmission(t, "reading", objectiveExerciseContent, attemptCorrectBlob)

	svc := service.NewSubmissionService(e.db, e.audit, clock.RealClock{}).WithAutoGrade(panicAutoGrader{})
	res, err := svc.Submit(context.Background(), e.studentTC, subID)
	if err != nil {
		t.Fatalf("D13 VIOLATION: submit failed because auto-grade panicked: %v", err)
	}
	_ = res
	if got := e.submissionStatus(t, subID); got != "submitted" {
		t.Errorf("D13 VIOLATION: submission status = %q, want 'submitted' (submit must survive a grading panic)", got)
	}
	if n := e.autoGradeRowCount(t, subID); n != 0 {
		t.Errorf("D13 VIOLATION: %d auto_grade_results rows after a panicked grade, want 0 (savepoint rolled back)", n)
	}
}

// AC3 / D13 — the returned-error path (non-panic) also rolls back to the savepoint and
// lets submit commit.
func TestAutoGradeSubmit_EngineErrors_SubmitStillCommits_ATDD(t *testing.T) {
	e := setupAutoGradeHookEnv(t)
	subID := e.seedInProgressSubmission(t, "reading", objectiveExerciseContent, attemptCorrectBlob)

	svc := service.NewSubmissionService(e.db, e.audit, clock.RealClock{}).WithAutoGrade(errAutoGrader{})
	if _, err := svc.Submit(context.Background(), e.studentTC, subID); err != nil {
		t.Fatalf("D13 VIOLATION: submit failed because auto-grade errored: %v", err)
	}
	if got := e.submissionStatus(t, subID); got != "submitted" {
		t.Errorf("D13 VIOLATION: submission status = %q, want 'submitted'", got)
	}
	if n := e.autoGradeRowCount(t, subID); n != 0 {
		t.Errorf("D13 VIOLATION: %d auto_grade_results rows after a failed grade, want 0", n)
	}
}

// AC3 / D13 — the genuine tx-poisoning path: a REAL failed statement inside the SAVEPOINT
// poisons the pgx-v5 tx; ROLLBACK TO SAVEPOINT must recover it so submit still commits
// 'submitted' with zero working rows (the panic/error doubles never touch the DB, so only
// this proves recovery from an actually-poisoned transaction).
func TestAutoGradeSubmit_PoisonsTx_SavepointRecovers_SubmitStillCommits_ATDD(t *testing.T) {
	e := setupAutoGradeHookEnv(t)
	subID := e.seedInProgressSubmission(t, "reading", objectiveExerciseContent, attemptCorrectBlob)

	svc := service.NewSubmissionService(e.db, e.audit, clock.RealClock{}).WithAutoGrade(poisonAutoGrader{})
	if _, err := svc.Submit(context.Background(), e.studentTC, subID); err != nil {
		t.Fatalf("D13 VIOLATION: submit failed after the auto-grader poisoned the tx: %v", err)
	}
	if got := e.submissionStatus(t, subID); got != "submitted" {
		t.Errorf("D13 VIOLATION: submission status = %q, want 'submitted' (ROLLBACK TO SAVEPOINT must recover a poisoned tx)", got)
	}
	if n := e.autoGradeRowCount(t, subID); n != 0 {
		t.Errorf("D13 VIOLATION: %d auto_grade_results rows after a poisoned grade, want 0", n)
	}
}

// -----------------------------------------------------------------------------
// AC1 — objective submit auto-grades: the default-wired hook writes exactly ONE
// working row (UNIQUE per submission) and the submission lands 'submitted'.
// -----------------------------------------------------------------------------

func TestAutoGradeSubmit_ObjectiveSubmission_WritesOneRow_ATDD(t *testing.T) {
	e := setupAutoGradeHookEnv(t)
	subID := e.seedInProgressSubmission(t, "reading", objectiveExerciseContent, attemptCorrectBlob)

	svc := service.NewSubmissionService(e.db, e.audit, clock.RealClock{}) // default wiring = real auto-grader
	if _, err := svc.Submit(context.Background(), e.studentTC, subID); err != nil {
		t.Fatalf("submit objective: %v", err)
	}
	if got := e.submissionStatus(t, subID); got != "submitted" {
		t.Errorf("submission status = %q, want 'submitted'", got)
	}
	if n := e.autoGradeRowCount(t, subID); n != 1 {
		t.Fatalf("objective submit wrote %d auto_grade_results rows, want exactly 1", n)
	}
	// AC2 — the cached score is present; the correct MCQ → raw 1 / max 1.
	var raw, max int
	if err := e.db.QueryRow(context.Background(),
		`SELECT raw_score, max_score FROM auto_grade_results WHERE submission_id=$1`, subID).Scan(&raw, &max); err != nil {
		t.Fatalf("read working row: %v", err)
	}
	if raw != 1 || max != 1 {
		t.Errorf("cached score raw/max = %d/%d, want 1/1 (single correct MCQ)", raw, max)
	}
}

// -----------------------------------------------------------------------------
// AC1 — writing/speaking submit is UNAFFECTED: no working row, submit path unchanged.
// -----------------------------------------------------------------------------

func TestAutoGradeSubmit_WritingSubmission_NoRow_ATDD(t *testing.T) {
	e := setupAutoGradeHookEnv(t)
	writingContent := `{"sections":[{"type":"writing","title":"","content":"Prompt","questionGroups":[]}],"settings":{"timeLimitEnabled":false,"timeLimitMinutes":0,"caseSensitive":false}}`
	writingBlob, _ := json.Marshal(map[string]string{"text": "my essay"})
	subID := e.seedInProgressSubmission(t, "writing", writingContent, string(writingBlob))

	svc := service.NewSubmissionService(e.db, e.audit, clock.RealClock{})
	if _, err := svc.Submit(context.Background(), e.studentTC, subID); err != nil {
		t.Fatalf("submit writing: %v", err)
	}
	if got := e.submissionStatus(t, subID); got != "submitted" {
		t.Errorf("writing submission status = %q, want 'submitted'", got)
	}
	if n := e.autoGradeRowCount(t, subID); n != 0 {
		t.Errorf("writing submit wrote %d auto_grade_results rows, want 0 (prompt-only never auto-graded, D3)", n)
	}
}

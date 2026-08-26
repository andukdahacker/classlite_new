// Story 6.4a (AC13–19 · D8/D9/D10/D11/D16 · R16=6) — the teacher OVERRIDE (recompute +
// audit) and RELEASE (grades write + submitted→graded flip + outbox + reader contract)
// paths, plus the D9/D10 concurrent-release race (twin c of the AC10 3-twin). Service
// layer over the real DB in a tx (SetupDB) for the deterministic cases; the raw pool
// (SetupRawPool) for the true 2-connection release race. RLS enforced under classlite_app.
//
// GREEN (de-tagged, runs in `go test ./...`): the reds landed build-tagged
// `atdd_red_phase` before in-progress (WF-8 gate); the service.AutoGradeService seam + its
// types + the auto_grade_results table now exist, so the tag was removed and this
// override/release/concurrency suite is permanent regression coverage.
//
// The override/release WIRE contract is PROVISIONAL (D16 — co-finalized with 6-4b);
// these reds pin BEHAVIOR, and expect the request/response JSON to be refined in 6-4b.
//
// SEAMS (dev, green — the ONE place to reconcile):
//   - service.NewAutoGradeService(db service.AuthDB, audit service.AuditLogger, clk clock.Clock) *service.AutoGradeService
//   - (*AutoGradeService).Override(ctx, tc model.TenantContext, submissionID uuid.UUID,
//         in service.AutoGradeOverrideInput) (*service.AutoGradeView, error)
//       Takes SELECT … FOR UPDATE on the submission (D9), recomputes effective
//       raw/max/percentage/band (maxScore fixed; rawScore = Σ exact-correct +
//       Σ override==correct; unresolved needs_review excluded from provisional denom),
//       mutates auto_grade_results in place, writes audit_logs 'autograde.override'
//       ({questionRef, from, to}, entityType 'submission') via AuditService.LogWithinTx.
//   - (*AutoGradeService).Release(ctx, tc, submissionID uuid.UUID) (*service.GradeView, error)
//       Takes FOR UPDATE (D9); inserts a grades row (graded_by = caller UUID;
//       criterion_scores = objective shape WITH "kind":"objective" discriminator, D8;
//       overall_band = final band; comments = '[]'; released_at = now()); unresolved
//       needs_review counts as WRONG in the definitive grade (D10); flips submission
//       submitted→graded (guarded); enqueues the grade-release outbox (reused unchanged).
//   - service.AutoGradeOverrideInput{ QuestionRef string; Mark string } // "correct"|"wrong"
//   - service.AutoGradeView{ RawScore, MaxScore int; Percentage, ProvisionalBand float64;
//         Released bool; Answers []service.AutoGradeAnswerView }
//   - Guards → model.ConflictError{Code: "SUBMISSION_ALREADY_RELEASED" | "SUBMISSION_NOT_OBJECTIVE"
//         | "AUTO_GRADE_NOT_FOUND"}; unknown questionRef → model.ValidationError (INVALID_QUESTION_REF).
package test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// A 2-question objective exercise: mcq 0:0:0 (answer "The fox") + fill_in_blank 0:1:0
// (answer "necessary"). Colon-handles align 1:1 with the working-row answers below.
const objectiveExercise2Q = `{
  "sections":[{"type":"reading","title":"","content":"","questionGroups":[
    {"type":"multiple_choice","instructions":"","questions":[
      {"text":"?","type":"multiple_choice","options":["The fox","The dog"],"correctAnswer":"The fox","acceptedVariants":[]}
    ]},
    {"type":"fill_in_blank","instructions":"","questions":[
      {"text":"?","type":"fill_in_blank","options":[],"correctAnswer":"necessary","acceptedVariants":[]}
    ]}
  ]}],
  "settings":{"timeLimitEnabled":false,"timeLimitMinutes":0,"caseSensitive":false}
}`

// working-row answers: 0:0:0 correct, 0:1:0 needs_review (unresolved). raw=1, max=2.
// provisional = 1 / (2-1) = 100%.
const workingAnswers = `[
  {"questionRef":"0:0:0","studentAnswer":"The fox","studentFlagged":false,"autoMark":"correct","overrideMark":null},
  {"questionRef":"0:1:0","studentAnswer":"nesessary","studentFlagged":false,"autoMark":"needs_review","overrideMark":null}
]`

type agReleaseEnv struct {
	db           *TxDB
	svc          *service.AutoGradeService
	subSvc       *service.SubmissionService
	centerID     uuid.UUID
	ownerID      uuid.UUID
	studentID    uuid.UUID
	classID      uuid.UUID
	ownerTC      model.TenantContext
	studentTC    model.TenantContext
	assignmentID uuid.UUID
	submissionID uuid.UUID // objective, submitted, with a working row
	writingSubID uuid.UUID // writing, submitted, no working row
}

func setupAGReleaseEnv(t *testing.T) agReleaseEnv {
	t.Helper()
	db := SetupDB(t)
	ctx := context.Background()
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerID := uuid.UUID(center.ID.Bytes)
	TenantContext(t, db, center.ID)

	ownerID := rlsInsertUserAS(t, db, "owner-"+uuid.NewString()+"@example.com")
	studentID := rlsInsertUserAS(t, db, "student-"+uuid.NewString()+"@example.com")
	CreateCenterMember(t, db, pgUUIDFromGo(ownerID), center.ID, "owner")
	CreateCenterMember(t, db, pgUUIDFromGo(studentID), center.ID, "student")

	classID := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'C','active',$3)`, classID, centerID, ownerID); err != nil {
		t.Fatalf("seed class: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`, uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("seed enrollment: %v", err)
	}
	// Objective exercise + submitted submission + working row.
	objExID := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version) VALUES ($1,$2,$3,$4,'Obj','reading',$5,1)`, objExID, centerID, ownerID, "EX-OBJ-"+objExID.String()[:8], objectiveExercise2Q); err != nil {
		t.Fatalf("seed objective exercise: %v", err)
	}
	objAssignmentID := rlsInsertAssignment(t, db, centerID, objExID, classID, ownerID)
	submissionID := rlsInsertSubmissionWithContent(t, db, centerID, objAssignmentID, studentID, "submitted",
		`{"schemaVersion":1,"answers":{"0:0:0":"The fox","0:1:0":"nesessary"},"flagged":[]}`)
	insertWorkingRow(t, db, centerID, submissionID, workingAnswers, 1, 2, 100.0, 6.0)

	// Writing exercise + submission (no working row) for the objective-only guards.
	wExID := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version) VALUES ($1,$2,$3,$4,'Wri','writing','{"sections":[],"settings":{}}',1)`, wExID, centerID, ownerID, "EX-WRI-"+wExID.String()[:8]); err != nil {
		t.Fatalf("seed writing exercise: %v", err)
	}
	wAssignmentID := rlsInsertAssignment(t, db, centerID, wExID, classID, ownerID)
	writingSubID := insertWritingSubmission(t, db, centerID, wAssignmentID, studentID, "submitted", "my essay")

	audit := service.NewAuditService(db)
	clk := clock.RealClock{}
	return agReleaseEnv{
		db:           db,
		svc:          service.NewAutoGradeService(db, audit, clk),
		subSvc:       service.NewSubmissionService(db, audit, clk),
		centerID:     centerID,
		ownerID:      ownerID,
		studentID:    studentID,
		classID:      classID,
		ownerTC:      model.TenantContext{CenterID: centerID.String(), UserID: ownerID.String(), Role: model.RoleOwner, EmailVerified: true},
		studentTC:    model.TenantContext{CenterID: centerID.String(), UserID: studentID.String(), Role: model.RoleStudent, EmailVerified: true},
		assignmentID: objAssignmentID,
		submissionID: submissionID,
		writingSubID: writingSubID,
	}
}

func rlsInsertSubmissionWithContent(t *testing.T, db *TxDB, centerID, assignmentID, studentID uuid.UUID, status, content string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, submitted_at)
		 VALUES ($1,$2,$3,$4,$5,$6,1, now())`,
		id, centerID, assignmentID, studentID, status, content); err != nil {
		t.Fatalf("insert submission: %v", err)
	}
	return id
}

func insertWorkingRow(t *testing.T, db *TxDB, centerID, submissionID uuid.UUID, answers string, raw, max int, pct, band float64) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO auto_grade_results
		   (id, submission_id, center_id, raw_score, max_score, percentage, provisional_band, answers)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
		uuid.New(), submissionID, centerID, raw, max, pct, band, answers); err != nil {
		t.Fatalf("insert working row: %v", err)
	}
}

func (e agReleaseEnv) gradeRowCount(t *testing.T, subID uuid.UUID) int {
	t.Helper()
	var n int
	if err := e.db.QueryRow(context.Background(), `SELECT count(*) FROM grades WHERE submission_id=$1`, subID).Scan(&n); err != nil {
		t.Fatalf("count grades: %v", err)
	}
	return n
}

func (e agReleaseEnv) outboxJobCount(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.db.QueryRow(context.Background(), `SELECT count(*) FROM jobs WHERE type='grade_release_email' AND center_id=$1`, e.centerID).Scan(&n); err != nil {
		t.Fatalf("count jobs: %v", err)
	}
	return n
}

// -----------------------------------------------------------------------------
// AC13/AC14 — override recompute (needs_review → correct) + the audit row.
// -----------------------------------------------------------------------------

func TestAutoGradeOverride_RecomputeAndAudit_ATDD(t *testing.T) {
	e := setupAGReleaseEnv(t)
	ctx := context.Background()

	view, err := e.svc.Override(ctx, e.ownerTC, e.submissionID, service.AutoGradeOverrideInput{
		QuestionRef: "0:1:0", Mark: "correct",
	})
	if err != nil {
		t.Fatalf("override: %v", err)
	}
	// After resolving the needs_review answer to correct: raw 2 / max 2 → 100%,
	// and the denominator is now the full maxScore (nothing unresolved).
	if view.RawScore != 2 || view.MaxScore != 2 {
		t.Errorf("override recompute raw/max = %d/%d, want 2/2", view.RawScore, view.MaxScore)
	}
	if view.Percentage != 100 {
		t.Errorf("override recompute percentage = %v, want 100", view.Percentage)
	}
	// AC14 — an autograde.override audit row for this submission.
	var n int
	if err := e.db.QueryRow(ctx,
		`SELECT count(*) FROM audit_logs WHERE action='autograde.override' AND entity_id=$1`, e.submissionID).Scan(&n); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	if n != 1 {
		t.Errorf("autograde.override audit rows = %d, want 1", n)
	}
}

// AC15 — override on a WRITING submission → 409 SUBMISSION_NOT_OBJECTIVE.
func TestAutoGradeOverride_OnWritingSubmission_409_ATDD(t *testing.T) {
	e := setupAGReleaseEnv(t)
	_, err := e.svc.Override(context.Background(), e.ownerTC, e.writingSubID, service.AutoGradeOverrideInput{QuestionRef: "0:0:0", Mark: "correct"})
	var c model.ConflictError
	if !errors.As(err, &c) || c.Code != "SUBMISSION_NOT_OBJECTIVE" {
		t.Fatalf("override on writing → want 409 SUBMISSION_NOT_OBJECTIVE, got %v", err)
	}
}

// AC15 — override an unknown questionRef → 422 INVALID_QUESTION_REF.
func TestAutoGradeOverride_UnknownQuestionRef_422_ATDD(t *testing.T) {
	e := setupAGReleaseEnv(t)
	_, err := e.svc.Override(context.Background(), e.ownerTC, e.submissionID, service.AutoGradeOverrideInput{QuestionRef: "9:9:9", Mark: "correct"})
	var v model.ValidationError
	if !errors.As(err, &v) {
		t.Fatalf("override unknown questionRef → want 422 ValidationError (INVALID_QUESTION_REF), got %v", err)
	}
}

// AC15 — override AFTER release → 409 SUBMISSION_ALREADY_RELEASED (service guard; the
// D9 trigger is the DB backstop, proven in auto_grade_results_rls_atdd_test.go).
func TestAutoGradeOverride_AfterRelease_409_ATDD(t *testing.T) {
	e := setupAGReleaseEnv(t)
	ctx := context.Background()
	if _, err := e.svc.Release(ctx, e.ownerTC, e.submissionID); err != nil {
		t.Fatalf("release: %v", err)
	}
	_, err := e.svc.Override(ctx, e.ownerTC, e.submissionID, service.AutoGradeOverrideInput{QuestionRef: "0:1:0", Mark: "correct"})
	var c model.ConflictError
	if !errors.As(err, &c) || c.Code != "SUBMISSION_ALREADY_RELEASED" {
		t.Fatalf("override after release → want 409 SUBMISSION_ALREADY_RELEASED, got %v", err)
	}
}

// -----------------------------------------------------------------------------
// AC16/AC17 — release: grades row (kind discriminator) + flip + outbox; unresolved
// needs_review counts as WRONG in the definitive grade (D10).
// -----------------------------------------------------------------------------

func TestAutoGradeRelease_WritesGradeFlipsOutbox_ATDD(t *testing.T) {
	e := setupAGReleaseEnv(t)
	ctx := context.Background()

	if _, err := e.svc.Release(ctx, e.ownerTC, e.submissionID); err != nil {
		t.Fatalf("release: %v", err)
	}
	// Grade row written with the objective "kind" discriminator (D8).
	var criterion []byte
	if err := e.db.QueryRow(ctx, `SELECT criterion_scores FROM grades WHERE submission_id=$1`, e.submissionID).Scan(&criterion); err != nil {
		t.Fatalf("read grade: %v", err)
	}
	var cs map[string]any
	if err := json.Unmarshal(criterion, &cs); err != nil {
		t.Fatalf("unmarshal criterion_scores: %v", err)
	}
	if cs["kind"] != "objective" {
		t.Errorf(`criterion_scores.kind = %v, want "objective" (D8 discriminator)`, cs["kind"])
	}
	// Submission flipped submitted→graded.
	var status string
	if err := e.db.QueryRow(ctx, `SELECT status FROM submissions WHERE id=$1`, e.submissionID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "graded" {
		t.Errorf("submission status = %q, want 'graded'", status)
	}
	// Outbox job enqueued (reused enqueueGradeReleaseOutbox).
	if n := e.outboxJobCount(t); n != 1 {
		t.Errorf("grade-release outbox rows = %d, want 1", n)
	}
}

// AC16/D10 — at release, the definitive rawScore counts the unresolved needs_review as
// WRONG: raw stays 1 / max 2 (the pre-release provisional had EXCLUDED it from the denom).
func TestAutoGradeRelease_UnresolvedNeedsReviewCountsWrong_ATDD(t *testing.T) {
	e := setupAGReleaseEnv(t)
	ctx := context.Background()
	if _, err := e.svc.Release(ctx, e.ownerTC, e.submissionID); err != nil {
		t.Fatalf("release: %v", err)
	}
	var criterion []byte
	if err := e.db.QueryRow(ctx, `SELECT criterion_scores FROM grades WHERE submission_id=$1`, e.submissionID).Scan(&criterion); err != nil {
		t.Fatalf("read grade: %v", err)
	}
	var cs struct {
		RawScore int `json:"rawScore"`
		MaxScore int `json:"maxScore"`
	}
	if err := json.Unmarshal(criterion, &cs); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if cs.RawScore != 1 || cs.MaxScore != 2 {
		t.Errorf("definitive raw/max = %d/%d, want 1/2 (unresolved needs_review → wrong at release, D10)", cs.RawScore, cs.MaxScore)
	}
}

// -----------------------------------------------------------------------------
// AC18 — reader contract + leak-guard. Before release: student sees pending. After
// release: released=true, grade present, and the serialized student review NEVER
// leaks correctAnswer / the per-answer breakdown.
// -----------------------------------------------------------------------------

func TestAutoGradeRelease_StudentReaderContractAndLeakGuard_ATDD(t *testing.T) {
	e := setupAGReleaseEnv(t)
	ctx := context.Background()

	// BEFORE release — even with a computed working row, the student sees pending.
	pre, err := e.subSvc.GetStudentSubmissionReview(ctx, e.studentTC, e.assignmentID)
	if err != nil {
		t.Fatalf("pre-release student review: %v", err)
	}
	if pre.Released {
		t.Error("pre-release: student review Released=true, want false (grade not released)")
	}
	if pre.Grade != nil {
		t.Error("pre-release: student review Grade non-nil, want nil")
	}

	if _, err := e.svc.Release(ctx, e.ownerTC, e.submissionID); err != nil {
		t.Fatalf("release: %v", err)
	}

	post, err := e.subSvc.GetStudentSubmissionReview(ctx, e.studentTC, e.assignmentID)
	if err != nil {
		t.Fatalf("post-release student review: %v", err)
	}
	if !post.Released || post.Grade == nil {
		t.Fatalf("post-release: Released=%v Grade=%v, want true + non-nil", post.Released, post.Grade)
	}
	// Leak-guard: the serialized student result must NOT contain the answer key nor the
	// teacher-only per-answer breakdown (field-ABSENCE, not empty).
	raw, err := json.Marshal(post)
	if err != nil {
		t.Fatalf("marshal student review: %v", err)
	}
	// graded_by/gradedBy is teacher-identity metadata AC18 explicitly requires be absent
	// from the student result (both the camelCase wire form and the snake_case DB column).
	for _, banned := range []string{"correctAnswer", "acceptedVariants", "autoMark", "overrideMark", "gradedBy", "graded_by"} {
		if strings.Contains(string(raw), banned) {
			t.Errorf("LEAK: student result serialization contains %q — must be absent (AC18/D12)", banned)
		}
	}
}

// -----------------------------------------------------------------------------
// AC19 — release guards: re-release / non-objective / no-working-row.
// -----------------------------------------------------------------------------

func TestAutoGradeRelease_Guards_ATDD(t *testing.T) {
	e := setupAGReleaseEnv(t)
	ctx := context.Background()

	// Re-release → 409 SUBMISSION_ALREADY_RELEASED.
	if _, err := e.svc.Release(ctx, e.ownerTC, e.submissionID); err != nil {
		t.Fatalf("first release: %v", err)
	}
	_, err := e.svc.Release(ctx, e.ownerTC, e.submissionID)
	var c model.ConflictError
	if !errors.As(err, &c) || c.Code != "SUBMISSION_ALREADY_RELEASED" {
		t.Errorf("re-release → want 409 SUBMISSION_ALREADY_RELEASED, got %v", err)
	}

	// Release a WRITING submission → 409 SUBMISSION_NOT_OBJECTIVE.
	_, werr := e.svc.Release(ctx, e.ownerTC, e.writingSubID)
	if !errors.As(werr, &c) || c.Code != "SUBMISSION_NOT_OBJECTIVE" {
		t.Errorf("release writing → want 409 SUBMISSION_NOT_OBJECTIVE, got %v", werr)
	}
}

func TestAutoGradeRelease_NoWorkingRow_409_ATDD(t *testing.T) {
	e := setupAGReleaseEnv(t)
	ctx := context.Background()
	// An objective submission with NO working row (auto-grade never ran) → AUTO_GRADE_NOT_FOUND.
	objExID := uuid.New()
	if _, err := e.db.Exec(ctx, `INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version) VALUES ($1,$2,$3,$4,'Obj2','reading',$5,1)`, objExID, e.centerID, e.ownerID, "EX-O2-"+objExID.String()[:8], objectiveExercise2Q); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	assignmentID := rlsInsertAssignment(t, e.db, e.centerID, objExID, e.classID, e.ownerID)
	subID := rlsInsertSubmissionWithContent(t, e.db, e.centerID, assignmentID, e.studentID, "submitted", `{"schemaVersion":1,"answers":{},"flagged":[]}`)

	_, err := e.svc.Release(ctx, e.ownerTC, subID)
	var c model.ConflictError
	if !errors.As(err, &c) || c.Code != "AUTO_GRADE_NOT_FOUND" {
		t.Fatalf("release with no working row → want 409 AUTO_GRADE_NOT_FOUND, got %v", err)
	}
}

// -----------------------------------------------------------------------------
// AC10(c) / D9/D10 — TWO concurrent releases: the FOR UPDATE lock serializes them, so
// the loser gets the guarded 409 SUBMISSION_ALREADY_RELEASED, never a 500. Raw 2-conn
// pool (mirrors grading_concurrency_test.go).
// -----------------------------------------------------------------------------

func TestAutoGradeRelease_ConcurrentRelease_OneWins_ATDD(t *testing.T) {
	su := SuperuserPool(t)
	pool := SetupRawPool(t)
	env := seedAGReleaseRaceEnv(t, su, pool)
	ctx := context.Background()

	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			_, errs[idx] = env.svc.Release(ctx, env.tc, env.submissionID)
		}(i)
	}
	close(start)
	wg.Wait()

	successes, conflicts := 0, 0
	for _, err := range errs {
		if err == nil {
			successes++
			continue
		}
		var c model.ConflictError
		if errors.As(err, &c) && c.Code == "SUBMISSION_ALREADY_RELEASED" {
			conflicts++
		} else {
			t.Fatalf("unexpected error from concurrent release (want 409, never 500): %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent release: %d wins / %d conflicts, want 1/1", successes, conflicts)
	}
	var grades int
	su.QueryRow(ctx, `SELECT count(*) FROM grades WHERE submission_id=$1`, env.submissionID).Scan(&grades)
	if grades != 1 {
		t.Errorf("after concurrent release: %d grade rows, want exactly 1", grades)
	}
}

type agReleaseRaceEnv struct {
	svc          *service.AutoGradeService
	tc           model.TenantContext
	centerID     uuid.UUID
	submissionID uuid.UUID
}

func seedAGReleaseRaceEnv(t *testing.T, su, pool *pgxpool.Pool) agReleaseRaceEnv {
	t.Helper()
	ctx := context.Background()
	centerID := uuid.New()
	ownerID := uuid.New()
	studentID := uuid.New()
	classID := uuid.New()
	exerciseID := uuid.New()
	assignmentID := uuid.New()
	submissionID := uuid.New()
	short := "agrace-" + centerID.String()[:8]

	mustExec(t, su, ctx, `INSERT INTO centers (id, name, short_code) VALUES ($1,$2,$3)`, centerID, "AG Race", short)
	mustExec(t, su, ctx, `INSERT INTO users (id, email, full_name, password_hash, email_verified) VALUES ($1,$2,'O','x',true)`, ownerID, "o-"+short+"@e.com")
	mustExec(t, su, ctx, `INSERT INTO users (id, email, full_name, password_hash, email_verified) VALUES ($1,$2,'S','x',true)`, studentID, "s-"+short+"@e.com")
	mustExec(t, su, ctx, `INSERT INTO center_members (center_id, user_id, role) VALUES ($1,$2,'owner')`, centerID, ownerID)
	mustExec(t, su, ctx, `INSERT INTO center_members (center_id, user_id, role) VALUES ($1,$2,'student')`, centerID, studentID)
	mustExec(t, su, ctx, `INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'C','active',$3)`, classID, centerID, ownerID)
	mustExec(t, su, ctx, `INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version) VALUES ($1,$2,$3,$4,'Obj','reading',$5,1)`, exerciseID, centerID, ownerID, "EX-"+short, objectiveExercise2Q)
	mustExec(t, su, ctx, `INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`, uuid.New(), centerID, studentID, classID)
	mustExec(t, su, ctx, `INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, late_penalty) VALUES ($1,$2,$3,$4,$5,'open', now() + interval '7 days', 0)`, assignmentID, centerID, exerciseID, classID, ownerID)
	mustExec(t, su, ctx, `INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, submitted_at) VALUES ($1,$2,$3,$4,'submitted',$5,1, now())`, submissionID, centerID, assignmentID, studentID, `{"schemaVersion":1,"answers":{"0:0:0":"The fox","0:1:0":"nesessary"},"flagged":[]}`)
	mustExec(t, su, ctx, `INSERT INTO auto_grade_results (id, submission_id, center_id, raw_score, max_score, percentage, provisional_band, answers) VALUES ($1,$2,$3,1,2,100.0,6.0,$4::jsonb)`, uuid.New(), submissionID, centerID, workingAnswers)

	t.Cleanup(func() {
		_, _ = su.Exec(ctx, `DELETE FROM jobs WHERE center_id=$1`, centerID)
		_, _ = su.Exec(ctx, `DELETE FROM grades WHERE center_id=$1`, centerID)
		_, _ = su.Exec(ctx, `DELETE FROM auto_grade_results WHERE center_id=$1`, centerID)
		_, _ = su.Exec(ctx, `DELETE FROM submissions WHERE assignment_id=$1`, assignmentID)
		_, _ = su.Exec(ctx, `DELETE FROM assignments WHERE id=$1`, assignmentID)
		_, _ = su.Exec(ctx, `DELETE FROM enrollments WHERE class_id=$1`, classID)
		_, _ = su.Exec(ctx, `DELETE FROM exercises WHERE id=$1`, exerciseID)
		_, _ = su.Exec(ctx, `DELETE FROM classes WHERE id=$1`, classID)
		_, _ = su.Exec(ctx, `DELETE FROM center_members WHERE center_id=$1`, centerID)
		_, _ = su.Exec(ctx, `DELETE FROM audit_logs WHERE center_id=$1`, centerID)
		_, _ = su.Exec(ctx, `DELETE FROM centers WHERE id=$1`, centerID)
		_, _ = su.Exec(ctx, `DELETE FROM users WHERE id IN ($1,$2)`, ownerID, studentID)
	})

	return agReleaseRaceEnv{
		svc:          service.NewAutoGradeService(pool, service.NewAuditService(pool), clock.RealClock{}),
		tc:           model.TenantContext{CenterID: centerID.String(), UserID: ownerID.String(), Role: model.RoleOwner, EmailVerified: true},
		centerID:     centerID,
		submissionID: submissionID,
	}
}

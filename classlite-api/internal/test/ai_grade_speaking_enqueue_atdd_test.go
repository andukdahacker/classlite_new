// Story 6.3b, AC1 + AC10 + AC12 (skill-branched enqueue idempotency/authz/guards +
// grading-read aiSpeakingSuggestion) — RED PHASE.
//
// Build-tagged `atdd_red_phase`: run with
//
//	go test -tags=atdd_red_phase ./internal/test/...
//
// FAILS TO COMPILE until the green seams land (model.JobTypeAIGradeSpeaking, the
// TeacherGradingView.AiSpeakingSuggestion field). Dev strips the tag per-AC.
//
// Package `test` integration tests over the real DB in a tx (SetupDB, RLS enforced).
// Mirrors ai_grade_enqueue_atdd_test.go but for the SPEAKING branch. The enqueue
// SIGNATURE is unchanged — EnqueueAIGrade(ctx, tc, submissionID) resolves the skill
// from the DB (SEC-7) and branches internally; the handler/route are unchanged.
//
// WHY THE IDEMPOTENCY RED IS SHARPER HERE (D9/D16 — the double-charge trap):
//
//	6-2a's 23505 handler + isInflightIndexViolation are closure-scoped to the
//	WRITING index/query. A literal copy would let a 2nd in-flight SPEAKING enqueue's
//	23505 (on uq_jobs_ai_grade_speaking_inflight) escape the reconcile → surface as
//	an error instead of returning the existing job, OR (worse) charge a 2nd deduct.
//	SE8 drives EXACTLY the speaking index/query path: a miss here = the money bug.
//
// SEAMS (dev, green phase — the ONE place to reconcile):
//   - (*service.AIGradeService).EnqueueAIGrade unchanged signature; internally:
//     skill hoisted to an outer var so the post-tx 23505 handler picks the
//     SPEAKING twin query (GetInflightAISpeakingGradeJobForSubmission) + the
//     speaking index name; speaking guards run BEFORE InsertJob (D8/D9/D12):
//     assertSpeakingExercise (dead-defense — the branch IS chosen by DB skill),
//     empty-audioKey → SUBMISSION_NOT_GRADABLE, duration > maxAIGradeAudioDurationMs
//     → 409 BEFORE the deduct (D12).
//   - model.JobTypeAIGradeSpeaking = "ai_grade_speaking"
//   - service.TeacherGradingView gains AiSpeakingSuggestion *model.AISpeakingGradeResult
//     (D10) — latest COMPLETE ai_grade_speaking job (completed_at DESC, id DESC),
//     degrade-don't-fail, nil when none; the writing AiSuggestion + the student
//     /result path stay untouched (transcript/confidence/rationale teacher-only).
package test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// aiSpeakingEnqEnv mirrors gradingEnv but with a SPEAKING exercise + a speaking
// submission whose content carries an audioKey (SEC-8 prefix) + durationSec. It is
// DISTINCT from 6-3a's speakingGradingEnv (the grade-write env, no submissionSvc,
// fixed content) — this one parameterizes the content so the empty-audioKey and
// over-duration enqueue guards (D8/D12) are seedable, and carries submissionSvc for
// the student-leak read (SE19).
type aiSpeakingEnqEnv struct {
	db             *TxDB
	centerID       uuid.UUID
	ownerTC        model.TenantContext
	otherTeacherTC model.TenantContext
	studentTC      model.TenantContext
	assignmentID   uuid.UUID
	submissionID   uuid.UUID
	audioKey       string
	gradingSvc     *service.GradingService
	submissionSvc  *service.SubmissionService
}

// newAISpeakingEnqEnv seeds center A + owner/otherTeacher/student members + a speaking
// class/exercise/enrollment/assignment/submission. audioKeyMode is "default" (a key
// under the center prefix) or "empty" (the empty-audioKey guard probe). durationSec
// is written to content so the enqueue-time duration guard (D12) is exercisable.
func newAISpeakingEnqEnv(t *testing.T, audioKeyMode string, durationSec int) aiSpeakingEnqEnv {
	t.Helper()
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerID := uuid.UUID(center.ID.Bytes)
	TenantContext(t, db, center.ID)

	ownerID := rlsInsertUserAS(t, db, "owner-"+uuid.NewString()+"@example.com")
	otherTeacherID := rlsInsertUserAS(t, db, "teacher2-"+uuid.NewString()+"@example.com")
	studentID := rlsInsertUserAS(t, db, "student-"+uuid.NewString()+"@example.com")
	CreateCenterMember(t, db, pgUUIDFromGo(ownerID), center.ID, "owner")
	CreateCenterMember(t, db, pgUUIDFromGo(otherTeacherID), center.ID, "teacher")
	CreateCenterMember(t, db, pgUUIDFromGo(studentID), center.ID, "student")

	classID := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1, $2, 'S Class', 'active', $3)`,
		classID, centerID, ownerID); err != nil {
		t.Fatalf("insert class: %v", err)
	}
	exerciseID := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1, $2, $3, $4, 'Speaking Task', 'speaking', '{"sections":[]}', 1)`,
		exerciseID, centerID, ownerID, "EX-S-"+exerciseID.String()[:8]); err != nil {
		t.Fatalf("insert speaking exercise: %v", err)
	}
	if _, err := db.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1, $2, $3, $4, 'active')`,
		uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("insert enrollment: %v", err)
	}
	assignmentID := rlsInsertAssignment(t, db, centerID, exerciseID, classID, ownerID)

	audioKey := ""
	if audioKeyMode == "default" {
		audioKey = centerID.String() + "/speaking/" + uuid.NewString() + ".webm"
	}
	submissionID := uuid.New()
	content, _ := json.Marshal(map[string]any{"audioKey": audioKey, "durationSec": durationSec})
	if _, err := db.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, submitted_at)
		 VALUES ($1, $2, $3, $4, 'submitted', $5, 1, now())`,
		submissionID, centerID, assignmentID, studentID, content); err != nil {
		t.Fatalf("insert speaking submission: %v", err)
	}

	audit := service.NewAuditService(db)
	clk := clock.RealClock{}
	return aiSpeakingEnqEnv{
		db:             db,
		centerID:       centerID,
		ownerTC:        model.TenantContext{CenterID: centerID.String(), UserID: ownerID.String(), Role: model.RoleOwner, EmailVerified: true},
		otherTeacherTC: model.TenantContext{CenterID: centerID.String(), UserID: otherTeacherID.String(), Role: model.RoleTeacher, EmailVerified: true},
		studentTC:      model.TenantContext{CenterID: centerID.String(), UserID: studentID.String(), Role: model.RoleStudent, EmailVerified: true},
		assignmentID:   assignmentID,
		submissionID:   submissionID,
		audioKey:       audioKey,
		gradingSvc:     service.NewGradingService(db, audit, clk),
		// WithStorage so the student review's own-recording presign (SEC-8, story 5.5a)
		// is exercisable — the seeded speaking submission carries an audioKey.
		submissionSvc: service.NewSubmissionService(db, audit, clk).WithStorage(service.NewMockStorageService()),
	}
}

func enqueueAISpeakingGrade(t *testing.T, e aiSpeakingEnqEnv, tc model.TenantContext, submissionID uuid.UUID) (uuid.UUID, error) {
	t.Helper()
	svc := service.NewAIGradeService(e.db)
	jobID, _, err := svc.EnqueueAIGrade(context.Background(), tc, submissionID)
	return jobID, err
}

func (e aiSpeakingEnqEnv) countSpeakingJobs(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.db.QueryRow(context.Background(),
		`SELECT count(*) FROM jobs WHERE type = 'ai_grade_speaking' AND center_id = $1`, e.centerID,
	).Scan(&n); err != nil {
		t.Fatalf("count ai_grade_speaking jobs: %v", err)
	}
	return n
}

func (e aiSpeakingEnqEnv) countDeductions(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.db.QueryRow(context.Background(),
		`SELECT count(*) FROM ai_credit_ledger WHERE reason = 'job_deduction' AND center_id = $1`, e.centerID,
	).Scan(&n); err != nil {
		t.Fatalf("count deductions: %v", err)
	}
	return n
}

// ===========================================================================
// SE8 — Enqueue idempotency (D9/D16, the money bug): a 2nd in-flight SPEAKING
// enqueue returns the EXISTING job and inserts NO second deduct. Drives the
// speaking index (uq_jobs_ai_grade_speaking_inflight) + the speaking twin query
// via the HOISTED skill — a miss = double-charge.
// ===========================================================================

func TestEnqueueAISpeakingGrade_SecondInflight_ReturnsExisting_NoSecondDeduct(t *testing.T) {

	e := newAISpeakingEnqEnv(t, "default", 278)

	job1, err := enqueueAISpeakingGrade(t, e, e.ownerTC, e.submissionID)
	if err != nil {
		t.Fatalf("first speaking enqueue: %v", err)
	}
	job2, err := enqueueAISpeakingGrade(t, e, e.ownerTC, e.submissionID) // while job1 is pending
	if err != nil {
		t.Fatalf("2nd in-flight enqueue should return the existing job, not error (D16 reconcile miss?): %v", err)
	}
	if job1 != job2 {
		t.Fatalf("MONEY BUG: 2nd in-flight SPEAKING enqueue minted a new job %s (want existing %s)", job2, job1)
	}
	if n := e.countSpeakingJobs(t); n != 1 {
		t.Fatalf("expected exactly 1 ai_grade_speaking job, got %d", n)
	}
	if n := e.countDeductions(t); n != 1 {
		t.Fatalf("MONEY BUG: expected exactly 1 job_deduction, got %d (2nd deduct not rolled back)", n)
	}
}

// ===========================================================================
// SE9 — Guard failure leaves NO partial write: a non-member teacher's enqueue is
// rejected → zero jobs AND zero ledger rows (atomic, before InsertJob).
// ===========================================================================

func TestEnqueueAISpeakingGrade_ForbiddenTeacher_NoPartialWrite(t *testing.T) {

	e := newAISpeakingEnqEnv(t, "default", 278)

	_, err := enqueueAISpeakingGrade(t, e, e.otherTeacherTC, e.submissionID)
	var forbidden *service.ForbiddenError
	if !errors.As(err, &forbidden) {
		t.Fatalf("expected ForbiddenError for teacher-of-other-class, got %v", err)
	}
	if n := e.countSpeakingJobs(t); n != 0 {
		t.Errorf("partial write: %d speaking jobs on a rejected enqueue, want 0", n)
	}
	if n := e.countDeductions(t); n != 0 {
		t.Errorf("partial write: %d deductions on a rejected enqueue, want 0", n)
	}
}

// ===========================================================================
// SE10 — Student may never enqueue an AI grade (INSUFFICIENT_ROLE).
// ===========================================================================

func TestEnqueueAISpeakingGrade_Student_Forbidden(t *testing.T) {

	e := newAISpeakingEnqEnv(t, "default", 278)

	_, err := enqueueAISpeakingGrade(t, e, e.studentTC, e.submissionID)
	var forbidden *service.ForbiddenError
	if !errors.As(err, &forbidden) {
		t.Fatalf("expected ForbiddenError for a student enqueue, got %v", err)
	}
}

// ===========================================================================
// SE11 — empty audioKey → 409 SUBMISSION_NOT_GRADABLE BEFORE the deduct (D8).
// The speaking analog of writing's empty-essay guard: reject at enqueue so a
// credit is never spent on a recording that cannot be downloaded (though here
// the reason differs — the worker would refund; the guard avoids the pointless
// deduct+refund+job round-trip, Dev-Notes mirror-trap #5).
// ===========================================================================

func TestEnqueueAISpeakingGrade_EmptyAudioKey_Conflict_NoWrite(t *testing.T) {

	e := newAISpeakingEnqEnv(t, "empty", 278)

	_, err := enqueueAISpeakingGrade(t, e, e.ownerTC, e.submissionID)
	var conflict model.ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("expected ConflictError (409) for an empty audioKey, got %v", err)
	}
	if n := e.countSpeakingJobs(t); n != 0 {
		t.Errorf("empty-audioKey enqueue wrote %d jobs, want 0 (reject before InsertJob)", n)
	}
	if n := e.countDeductions(t); n != 0 {
		t.Errorf("empty-audioKey enqueue wrote %d deductions, want 0 (before the deduct)", n)
	}
}

// ===========================================================================
// SE12 — over-duration → 409 BEFORE the deduct (D12). A recording longer than
// maxAIGradeAudioDurationMs is rejected synchronously at enqueue, NOT deducted →
// enqueued → downloaded → transcoded → discovered dead in the worker.
// ===========================================================================

func TestEnqueueAISpeakingGrade_OverDuration_Conflict_BeforeDeduct(t *testing.T) {

	// A durationSec that dwarfs any AI-gradable ceiling (maxAIGradeAudioDurationMs).
	e := newAISpeakingEnqEnv(t, "default", 999_999)

	_, err := enqueueAISpeakingGrade(t, e, e.ownerTC, e.submissionID)
	var conflict model.ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("expected ConflictError (409) for an over-long recording, got %v (D12 — fail upfront, not a worker cliff)", err)
	}
	if n := e.countSpeakingJobs(t); n != 0 {
		t.Errorf("over-duration enqueue wrote %d jobs, want 0", n)
	}
	if n := e.countDeductions(t); n != 0 {
		t.Errorf("over-duration enqueue wrote %d deductions, want 0 (rejected BEFORE the deduct — D12)", n)
	}
}

// ===========================================================================
// SE-branch — SEC-7 skill branch: enqueue on a WRITING submission still mints an
// ai_grade_writing job and ZERO ai_grade_speaking jobs (the writing path is
// unchanged; the skill is resolved from the DB, never a client field). The
// SUBMISSION_NOT_SPEAKING guard is dead-defense inside the speaking branch (the
// branch is DB-chosen), so it is proven structurally, not via this auto-branch.
// ===========================================================================

func TestEnqueueAIGrade_WritingSubmission_RoutesToWritingBranch_NotSpeaking(t *testing.T) {

	// setupGradingEnv seeds a WRITING submission (shipped 6-2a scaffold).
	e := setupGradingEnv(t, "A writing essay to grade.")

	if _, err := enqueueAIGrade(t, e, e.ownerTC, e.submissionID); err != nil {
		t.Fatalf("writing enqueue (path unchanged) errored: %v", err)
	}
	var speakingN, writingN int
	if err := e.db.QueryRow(context.Background(),
		`SELECT count(*) FILTER (WHERE type='ai_grade_speaking'),
		        count(*) FILTER (WHERE type='ai_grade_writing')
		 FROM jobs WHERE center_id = $1`, e.centerID,
	).Scan(&speakingN, &writingN); err != nil {
		t.Fatalf("count jobs by type: %v", err)
	}
	if speakingN != 0 {
		t.Errorf("SEC-7 BRANCH BUG: a writing submission minted %d ai_grade_speaking jobs, want 0", speakingN)
	}
	if writingN != 1 {
		t.Errorf("writing path regression: expected exactly 1 ai_grade_writing job, got %d", writingN)
	}
}

// ===========================================================================
// SE18 — Grading-read surfaces the LATEST complete SPEAKING suggestion
// (completed_at DESC, id DESC), class-authz'd (D10). Writing's aiSuggestion is a
// SEPARATE field; this reads aiSpeakingSuggestion.
// ===========================================================================

func TestGetSubmissionForGrading_ReturnsLatestAISpeakingSuggestion(t *testing.T) {

	e := newAISpeakingEnqEnv(t, "default", 278)

	seedCompletedAISpeakingGradeJob(t, e, "OLDER speaking rationale", 1)
	seedCompletedAISpeakingGradeJob(t, e, "NEWER speaking rationale", 2)

	view, err := e.gradingSvc.GetSubmissionForGrading(context.Background(), e.ownerTC, e.submissionID)
	if err != nil {
		t.Fatalf("grading read: %v", err)
	}
	if view.AiSpeakingSuggestion == nil {
		t.Fatal("AiSpeakingSuggestion is nil; want the latest complete speaking suggestion")
	}
	blob, _ := json.Marshal(view.AiSpeakingSuggestion)
	if !containsRationale(blob, "NEWER speaking rationale") {
		t.Errorf("AiSpeakingSuggestion is not the latest (completed_at DESC, id DESC): %s", string(blob))
	}
}

// ===========================================================================
// SE19 — the STUDENT result path must NEVER expose a speaking suggestion:
// transcript / confidence / rationale are teacher-only (D10/UX-DR22).
// ===========================================================================

func TestStudentResult_NeverExposesAISpeakingSuggestion(t *testing.T) {

	e := newAISpeakingEnqEnv(t, "default", 278)
	seedCompletedAISpeakingGradeJob(t, e, "TEACHER_ONLY_speaking_rationale_marker", 1)

	review, err := e.submissionSvc.GetStudentSubmissionReview(context.Background(), e.studentTC, e.assignmentID)
	if err != nil {
		t.Fatalf("student review: %v", err)
	}
	blob, _ := json.Marshal(review)
	if containsRationale(blob, "TEACHER_ONLY_speaking_rationale_marker") {
		t.Errorf("LEAK: AI speaking rationale surfaced on the student path.\n%s", string(blob))
	}
}

// seedCompletedAISpeakingGradeJob inserts a complete ai_grade_speaking job carrying
// a minimal AISpeakingGradeResult whose fluencyCoherence.rationale is `marker`.
// `order` stamps completed_at so latest-wins is deterministic.
func seedCompletedAISpeakingGradeJob(t *testing.T, e aiSpeakingEnqEnv, marker string, order int) {
	t.Helper()
	result := map[string]any{
		"criteria": map[string]any{
			"fluencyCoherence": map[string]any{"band": 6.5, "rationale": marker, "confidence": "high"},
			"lexicalResource":  map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
			"grammaticalRange": map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
			"pronunciation":    map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
		},
		"moments":             []any{},
		"transcript":          "a transcript the student must never see",
		"transcriptionStatus": "available",
		"overallFeedback":     nil,
		"analyzedDurationMs":  278000,
		"latencyMs":           1400,
	}
	raw, _ := json.Marshal(result)
	params, _ := json.Marshal(map[string]string{"submissionId": e.submissionID.String()})
	if _, err := e.db.Exec(context.Background(),
		`INSERT INTO jobs (id, center_id, type, status, params, params_schema_version, result, result_schema_version, created_at, completed_at)
		 VALUES ($1, $2, 'ai_grade_speaking', 'complete', $3, 1, $4, 1, now(), now() + make_interval(secs => $5))`,
		uuid.New(), e.centerID, params, raw, order,
	); err != nil {
		t.Fatalf("seed completed ai_grade_speaking job: %v", err)
	}
}

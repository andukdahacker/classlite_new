// Story 6.2a, AC1 + AC10 + AC12 (enqueue idempotency/authz/guards + grading-read
// aiSuggestion) — RED PHASE.
//
// Package `test` integration tests over the real DB in a tx (SetupDB, RLS
// enforced). Reuses 6.1's setupGradingEnv/gradingEnv scaffold (owner/otherTeacher/
// student TCs, a Writing submission, assignment). The enqueue path is exercised
// through the production service seam, not a hand-rolled INSERT.
//
// SEAMS (dev, green phase — the ONE place to reconcile):
//   - service.NewAIGradeService(db, audit, clock) *service.AIGradeService  (or the
//       enqueue may land on GradingService — confirm and adjust enqueueAIGrade below)
//   - (*AIGradeService).EnqueueAIGrade(ctx, tc, submissionID uuid.UUID) (jobID uuid.UUID, err error)
//       · teacher-of-class authz + writing/gradable guards run BEFORE InsertJob (D9)
//       · InsertJob + InsertJobDeduction in ONE tenant tx (copy ai_generation_service.go:58-90)
//       · 2nd in-flight enqueue hits uq_jobs_ai_grade_inflight → 23505 → tx rolls back
//         (deduct included) → returns the EXISTING job (D6)
//   - service.GetSubmissionForGrading returns service.TeacherGradingView with a new
//       field AiSuggestion *model.AIWritingGradeResult (D2) — latest complete job,
//       ORDER BY completed_at DESC, id DESC (D11); nil when none.
//   - model.JobTypeAIGradeWriting = "ai_grade_writing"
package test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// enqueueAIGrade is the single DI reconciliation point for the enqueue seam. The
// service returns (jobID, existing, err) — the enqueue-logic tests care only about
// the job id and error (the existing→200 vs fresh→202 mapping is a handler concern),
// so the third return is discarded here.
func enqueueAIGrade(t *testing.T, e gradingEnv, tc model.TenantContext, submissionID uuid.UUID) (uuid.UUID, error) {
	t.Helper()
	svc := service.NewAIGradeService(e.db)
	jobID, _, err := svc.EnqueueAIGrade(context.Background(), tc, submissionID)
	return jobID, err
}

func (e gradingEnv) countAIGradeJobs(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.db.QueryRow(context.Background(),
		`SELECT count(*) FROM jobs WHERE type = 'ai_grade_writing' AND center_id = $1`, e.centerID,
	).Scan(&n); err != nil {
		t.Fatalf("count ai_grade_writing jobs: %v", err)
	}
	return n
}

func (e gradingEnv) countDeductions(t *testing.T) int {
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
// S8 — Enqueue idempotency: a 2nd in-flight enqueue returns the EXISTING job and
// inserts NO second deduct (D6, the money bug). The uq_jobs_ai_grade_inflight
// 23505 rolls the whole tx back — deduct included.
// ===========================================================================

func TestEnqueueAIGrade_SecondInflight_ReturnsExisting_NoSecondDeduct(t *testing.T) {

	e := setupGradingEnv(t, "My essay body for AI grading.")

	job1, err := enqueueAIGrade(t, e, e.ownerTC, e.submissionID)
	if err != nil {
		t.Fatalf("first enqueue: %v", err)
	}
	job2, err := enqueueAIGrade(t, e, e.ownerTC, e.submissionID) // while job1 is pending
	if err != nil {
		t.Fatalf("second enqueue should return the in-flight job, not error: %v", err)
	}

	if job1 != job2 {
		t.Fatalf("MONEY BUG: 2nd in-flight enqueue minted a new job %s (want existing %s)", job2, job1)
	}
	if n := e.countAIGradeJobs(t); n != 1 {
		t.Fatalf("expected exactly 1 ai_grade_writing job, got %d", n)
	}
	if n := e.countDeductions(t); n != 1 {
		t.Fatalf("MONEY BUG: expected exactly 1 job_deduction, got %d (2nd deduct not rolled back)", n)
	}
}

// ===========================================================================
// S9 — Guard failure leaves NO partial write: a non-member teacher's enqueue is
// rejected BEFORE/within the tx → zero jobs AND zero ledger rows (atomic).
// ===========================================================================

func TestEnqueueAIGrade_ForbiddenTeacher_NoPartialWrite(t *testing.T) {

	e := setupGradingEnv(t, "essay")

	// otherTeacherTC is a center member but NOT the teacher of this submission's class.
	_, err := enqueueAIGrade(t, e, e.otherTeacherTC, e.submissionID)

	// The enqueue reuses the 6.1 service-layer authz helpers, which return
	// *service.ForbiddenError (→ 403 via ErrorMapper) — mirror the 6.1 assertion.
	var forbidden *service.ForbiddenError
	if !errors.As(err, &forbidden) {
		t.Fatalf("expected ForbiddenError for teacher-of-other-class, got %v", err)
	}
	if n := e.countAIGradeJobs(t); n != 0 {
		t.Errorf("partial write: %d jobs created on a rejected enqueue, want 0", n)
	}
	if n := e.countDeductions(t); n != 0 {
		t.Errorf("partial write: %d deductions on a rejected enqueue, want 0", n)
	}
}

// ===========================================================================
// S10 — Student may never enqueue an AI grade (INSUFFICIENT_ROLE).
// ===========================================================================

func TestEnqueueAIGrade_Student_Forbidden(t *testing.T) {

	e := setupGradingEnv(t, "essay")

	_, err := enqueueAIGrade(t, e, e.studentTC, e.submissionID)
	var forbidden *service.ForbiddenError
	if !errors.As(err, &forbidden) {
		t.Fatalf("expected ForbiddenError for a student enqueue, got %v", err)
	}
}

// ===========================================================================
// S18 — Grading-read surfaces the LATEST complete suggestion (completed_at DESC,
// id DESC), class-authz'd (a co-teacher/admin sees it).
// ===========================================================================

func TestGetSubmissionForGrading_ReturnsLatestAISuggestion(t *testing.T) {

	e := setupGradingEnv(t, "essay")

	// Two completed AI-grade jobs; the newer must win the read.
	seedCompletedAIGradeJob(t, e, e.submissionID, "OLDER rationale", 1)
	seedCompletedAIGradeJob(t, e, e.submissionID, "NEWER rationale", 2)

	view, err := e.gradingSvc.GetSubmissionForGrading(context.Background(), e.ownerTC, e.submissionID)
	if err != nil {
		t.Fatalf("grading read: %v", err)
	}
	if view.AiSuggestion == nil {
		t.Fatal("AiSuggestion is nil; want the latest complete suggestion")
	}
	blob, _ := json.Marshal(view.AiSuggestion)
	if !containsRationale(blob, "NEWER rationale") {
		t.Errorf("AiSuggestion is not the latest (completed_at DESC, id DESC): %s", string(blob))
	}
}

// ===========================================================================
// S19 — The STUDENT result path must NEVER expose AI suggestions (D2/UX-DR22).
// ===========================================================================

func TestStudentResult_NeverExposesAISuggestion(t *testing.T) {

	e := setupGradingEnv(t, "essay")
	seedCompletedAIGradeJob(t, e, e.submissionID, "TEACHER_ONLY_rationale_marker", 1)

	review, err := e.submissionSvc.GetStudentSubmissionReview(context.Background(), e.studentTC, e.assignmentID)
	if err != nil {
		t.Fatalf("student review: %v", err)
	}
	blob, _ := json.Marshal(review)
	if containsRationale(blob, "TEACHER_ONLY_rationale_marker") {
		t.Errorf("LEAK: AI rationale surfaced on the student path.\n%s", string(blob))
	}
}

// --- red-phase helpers -----------------------------------------------------

// seedCompletedAIGradeJob inserts a complete ai_grade_writing job carrying a
// minimal AIWritingGradeResult whose taskResponse.rationale is `marker`. `order`
// stamps completed_at so latest-wins is deterministic.
func seedCompletedAIGradeJob(t *testing.T, e gradingEnv, submissionID uuid.UUID, marker string, order int) {
	t.Helper()
	result := map[string]any{
		"criteria": map[string]any{
			"taskResponse":      map[string]any{"band": 6.5, "rationale": marker, "confidence": "high"},
			"coherenceCohesion": map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
			"lexicalResource":   map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
			"grammaticalRange":  map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
		},
		"comments":          []any{},
		"overallFeedback":   nil,
		"analyzedWordCount": 42,
		"latencyMs":         1400,
	}
	raw, _ := json.Marshal(result)
	params, _ := json.Marshal(map[string]string{"submissionId": submissionID.String()})
	if _, err := e.db.Exec(context.Background(),
		`INSERT INTO jobs (id, center_id, type, status, params, params_schema_version, result, result_schema_version, created_at, completed_at)
		 VALUES ($1, $2, 'ai_grade_writing', 'complete', $3, 1, $4, 1, now(), now() + make_interval(secs => $5))`,
		uuid.New(), e.centerID, params, raw, order,
	); err != nil {
		t.Fatalf("seed completed ai_grade_writing job: %v", err)
	}
}

func containsRationale(blob []byte, marker string) bool {
	return strings.Contains(string(blob), marker)
}

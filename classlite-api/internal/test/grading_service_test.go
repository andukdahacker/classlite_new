// Story 6.1 — GradingService integration tests (AC4,5,6,7,8,10,11). Real DB in a
// tx (SetupDB), RLS enforced under classlite_app. Covers the happy grade+release,
// server-authoritative band, outbox row, revise version bump, validation,
// anchor demotion + multibyte round-trip (D3), double-grade 409, teacher-of-other-
// class 403 with zero side effects, and the /result released flip (AC10/D1).
package test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"unicode/utf16"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/service/grading"
	"github.com/google/uuid"
)

type gradingEnv struct {
	db             *TxDB
	centerID       uuid.UUID
	ownerTC        model.TenantContext
	otherTeacherTC model.TenantContext
	studentTC      model.TenantContext
	assignmentID   uuid.UUID
	submissionID   uuid.UUID
	gradingSvc     *service.GradingService
	submissionSvc  *service.SubmissionService
}

func insertWritingSubmission(t *testing.T, db *TxDB, centerID, assignmentID, studentID uuid.UUID, status, essay string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	raw, _ := json.Marshal(map[string]string{"text": essay})
	if _, err := db.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, submitted_at)
		 VALUES ($1, $2, $3, $4, $5, $6, 1, now())`,
		id, centerID, assignmentID, studentID, status, raw); err != nil {
		t.Fatalf("insert writing submission: %v", err)
	}
	return id
}

func setupGradingEnv(t *testing.T, essay string) gradingEnv {
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
		`INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1, $2, 'G Class', 'active', $3)`,
		classID, centerID, ownerID); err != nil {
		t.Fatalf("insert class: %v", err)
	}
	exerciseID := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1, $2, $3, $4, 'Writing Task', 'writing', '{"sections":[]}', 1)`,
		exerciseID, centerID, ownerID, "EX-G-"+exerciseID.String()[:8]); err != nil {
		t.Fatalf("insert exercise: %v", err)
	}
	if _, err := db.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1, $2, $3, $4, 'active')`,
		uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("insert enrollment: %v", err)
	}
	assignmentID := rlsInsertAssignment(t, db, centerID, exerciseID, classID, ownerID)
	submissionID := insertWritingSubmission(t, db, centerID, assignmentID, studentID, "submitted", essay)

	audit := service.NewAuditService(db)
	clk := clock.RealClock{}
	return gradingEnv{
		db:             db,
		centerID:       centerID,
		ownerTC:        model.TenantContext{CenterID: centerID.String(), UserID: ownerID.String(), Role: model.RoleOwner, EmailVerified: true},
		otherTeacherTC: model.TenantContext{CenterID: centerID.String(), UserID: otherTeacherID.String(), Role: model.RoleTeacher, EmailVerified: true},
		studentTC:      model.TenantContext{CenterID: centerID.String(), UserID: studentID.String(), Role: model.RoleStudent, EmailVerified: true},
		assignmentID:   assignmentID,
		submissionID:   submissionID,
		gradingSvc:     service.NewGradingService(db, audit, clk),
		submissionSvc:  service.NewSubmissionService(db, audit, clk),
	}
}

func scores(tr, cc, lr, gr float64) grading.CriterionScores {
	return grading.CriterionScores{TaskResponse: tr, CoherenceCohesion: cc, LexicalResource: lr, GrammaticalRange: gr}
}

func (e gradingEnv) countJobs(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.db.QueryRow(context.Background(),
		`SELECT count(*) FROM jobs WHERE type='grade_release_email' AND center_id=$1`, e.centerID).Scan(&n); err != nil {
		t.Fatalf("count jobs: %v", err)
	}
	return n
}

func (e gradingEnv) submissionStatus(t *testing.T) string {
	t.Helper()
	var s string
	if err := e.db.QueryRow(context.Background(), `SELECT status FROM submissions WHERE id=$1`, e.submissionID).Scan(&s); err != nil {
		t.Fatalf("read submission status: %v", err)
	}
	return s
}

func TestGradeWriting_HappyPath_ServerBand_Outbox(t *testing.T) {
	e := setupGradingEnv(t, "My essay body.")
	ctx := context.Background()

	feedback := "Good work overall."
	grade, err := e.gradingSvc.GradeWriting(ctx, e.ownerTC, e.submissionID, service.GradeWriteInput{
		Scores:   scores(6.0, 6.0, 6.5, 6.5), // mean 6.25 → .25 special-case → 6.5
		Comments: []grading.Comment{},
		Feedback: &feedback,
	})
	if err != nil {
		t.Fatalf("GradeWriting: %v", err)
	}
	if grade.OverallBand != 6.5 {
		t.Errorf("overallBand = %v, want 6.5 (server-authoritative IELTS rounding)", grade.OverallBand)
	}
	if grade.Version != 1 || grade.ReleasedAt == nil {
		t.Errorf("expected v1 released, got version=%d releasedAt=%v", grade.Version, grade.ReleasedAt)
	}
	if got := e.submissionStatus(t); got != "graded" {
		t.Errorf("submission status = %q, want graded", got)
	}
	if n := e.countJobs(t); n != 1 {
		t.Errorf("expected exactly 1 grade-release outbox job, got %d", n)
	}
}

func TestGradeWriting_DoubleGrade_409_ZeroSideEffects(t *testing.T) {
	e := setupGradingEnv(t, "Essay.")
	ctx := context.Background()
	if _, err := e.gradingSvc.GradeWriting(ctx, e.ownerTC, e.submissionID, service.GradeWriteInput{
		Scores: scores(6, 6, 6, 6), Comments: []grading.Comment{},
	}); err != nil {
		t.Fatalf("first grade: %v", err)
	}
	_, err := e.gradingSvc.GradeWriting(ctx, e.ownerTC, e.submissionID, service.GradeWriteInput{
		Scores: scores(7, 7, 7, 7), Comments: []grading.Comment{},
	})
	var conflict model.ConflictError
	if !errors.As(err, &conflict) || conflict.Code != "SUBMISSION_ALREADY_GRADED" {
		t.Fatalf("expected 409 SUBMISSION_ALREADY_GRADED, got %v", err)
	}
	// The loser committed zero side effects: still exactly one outbox job.
	if n := e.countJobs(t); n != 1 {
		t.Errorf("double-grade loser leaked side effects: %d outbox jobs, want 1", n)
	}
}

func TestGradeWriting_Validation_422(t *testing.T) {
	e := setupGradingEnv(t, "Essay.")
	_, err := e.gradingSvc.GradeWriting(context.Background(), e.ownerTC, e.submissionID, service.GradeWriteInput{
		Scores: scores(6.25, 6, 6, 6), // off the 0.5 grid
	})
	var ve model.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected model.ValidationError (422), got %v", err)
	}
}

func TestGradeWriting_AnchorDemotion_OutOfRange(t *testing.T) {
	e := setupGradingEnv(t, "Short.") // utf16 len 6
	ctx := context.Background()
	start, end := 100, 200 // way past the essay → demote to whole-essay
	grade, err := e.gradingSvc.GradeWriting(ctx, e.ownerTC, e.submissionID, service.GradeWriteInput{
		Scores: scores(6, 6, 6, 6),
		Comments: []grading.Comment{{
			Type: grading.CommentTypeError, Criterion: grading.CriterionTaskResponse,
			AnchorStart: &start, AnchorEnd: &end, Text: "out of range",
		}},
	})
	if err != nil {
		t.Fatalf("GradeWriting: %v", err)
	}
	if len(grade.Comments) != 1 {
		t.Fatalf("expected 1 comment, got %d", len(grade.Comments))
	}
	if grade.Comments[0].AnchorStart != nil || grade.Comments[0].AnchorEnd != nil {
		t.Errorf("out-of-range anchor should be demoted to whole-essay (null/null), got %v/%v",
			grade.Comments[0].AnchorStart, grade.Comments[0].AnchorEnd)
	}
}

func TestGradeWriting_MultibyteAnchor_RoundTrip(t *testing.T) {
	essay := "Café 🎉 test" // 'é' = 1 UTF-16 unit; '🎉' = surrogate pair (offsets [5,7))
	e := setupGradingEnv(t, essay)
	ctx := context.Background()
	start, end := 5, 7
	grade, err := e.gradingSvc.GradeWriting(ctx, e.ownerTC, e.submissionID, service.GradeWriteInput{
		Scores: scores(6, 6, 6, 6),
		Comments: []grading.Comment{{
			Type: grading.CommentTypePraise, Criterion: grading.CriterionLexicalResource,
			AnchorStart: &start, AnchorEnd: &end, Text: "nice emoji",
		}},
	})
	if err != nil {
		t.Fatalf("GradeWriting: %v", err)
	}
	c := grade.Comments[0]
	if c.AnchorStart == nil || c.AnchorEnd == nil || *c.AnchorStart != 5 || *c.AnchorEnd != 7 {
		t.Fatalf("multibyte anchor not preserved: got %v/%v, want 5/7", c.AnchorStart, c.AnchorEnd)
	}
	// Round-trip: the UTF-16 slice [5,7) of the essay is the emoji.
	units := utf16.Encode([]rune(essay))
	if got := string(utf16.Decode(units[*c.AnchorStart:*c.AnchorEnd])); got != "🎉" {
		t.Errorf("UTF-16 slice = %q, want 🎉 (offset contract broken)", got)
	}
}

func TestReviseGrade_VersionBump_PriorIntact(t *testing.T) {
	e := setupGradingEnv(t, "Essay.")
	ctx := context.Background()
	v1, err := e.gradingSvc.GradeWriting(ctx, e.ownerTC, e.submissionID, service.GradeWriteInput{
		Scores: scores(6, 6, 6, 6), Comments: []grading.Comment{},
	})
	if err != nil {
		t.Fatalf("grade: %v", err)
	}
	v2, err := e.gradingSvc.ReviseGrade(ctx, e.ownerTC, e.submissionID, service.GradeWriteInput{
		Scores: scores(7, 7, 7, 7), Comments: []grading.Comment{}, Reason: "re-marked stricter",
	})
	if err != nil {
		t.Fatalf("revise: %v", err)
	}
	if v2.Version != 2 {
		t.Errorf("revise version = %d, want 2", v2.Version)
	}
	if v1.OverallBand != 6.0 || v2.OverallBand != 7.0 {
		t.Errorf("bands: v1=%v (want 6) v2=%v (want 7)", v1.OverallBand, v2.OverallBand)
	}
	// Prior row intact + submission still graded (revise never touches the submission).
	if got := e.submissionStatus(t); got != "graded" {
		t.Errorf("submission status = %q, want graded", got)
	}
	var v1Band float64
	if err := e.db.QueryRow(ctx, `SELECT overall_band FROM grades WHERE submission_id=$1 AND version=1`, e.submissionID).Scan(&v1Band); err != nil {
		t.Fatalf("read v1: %v", err)
	}
	if v1Band != 6.0 {
		t.Errorf("prior grade v1 mutated: overall_band=%v, want 6.0", v1Band)
	}
}

func TestReviseGrade_NoExistingGrade_404(t *testing.T) {
	e := setupGradingEnv(t, "Essay.")
	_, err := e.gradingSvc.ReviseGrade(context.Background(), e.ownerTC, e.submissionID, service.GradeWriteInput{
		Scores: scores(6, 6, 6, 6), Reason: "x",
	})
	var nf model.NotFoundError
	if !errors.As(err, &nf) || nf.Code != "GRADE_NOT_FOUND" {
		t.Fatalf("expected 404 GRADE_NOT_FOUND, got %v", err)
	}
}

func TestGradeWriting_TeacherOfOtherClass_403_ZeroSideEffects(t *testing.T) {
	e := setupGradingEnv(t, "Essay.")
	// otherTeacher is a 'teacher' member but NOT the class teacher (class.teacher_id = owner).
	_, err := e.gradingSvc.GradeWriting(context.Background(), e.otherTeacherTC, e.submissionID, service.GradeWriteInput{
		Scores: scores(6, 6, 6, 6), Comments: []grading.Comment{},
	})
	var forbidden *service.ForbiddenError
	if !errors.As(err, &forbidden) {
		t.Fatalf("expected 403 ForbiddenError, got %v", err)
	}
	// Failure before commit → zero side effects: no outbox job, submission untouched.
	if n := e.countJobs(t); n != 0 {
		t.Errorf("403 leaked side effects: %d outbox jobs, want 0", n)
	}
	if got := e.submissionStatus(t); got != "submitted" {
		t.Errorf("403 mutated submission: status=%q, want submitted", got)
	}
}

func TestResultGradeBlock_ReleasedFlip(t *testing.T) {
	e := setupGradingEnv(t, "Essay.")
	ctx := context.Background()

	// Before grading: released=false, grade=nil.
	before, err := e.submissionSvc.GetStudentSubmissionReview(ctx, e.studentTC, e.assignmentID)
	if err != nil {
		t.Fatalf("review before grade: %v", err)
	}
	if before.Released || before.Grade != nil {
		t.Errorf("pre-grade: released=%v grade=%v, want false/nil", before.Released, before.Grade)
	}

	feedback := "Feedback."
	if _, err := e.gradingSvc.GradeWriting(ctx, e.ownerTC, e.submissionID, service.GradeWriteInput{
		Scores: scores(6.5, 6.5, 6.5, 6.5), Comments: []grading.Comment{}, Feedback: &feedback,
	}); err != nil {
		t.Fatalf("grade: %v", err)
	}

	after, err := e.submissionSvc.GetStudentSubmissionReview(ctx, e.studentTC, e.assignmentID)
	if err != nil {
		t.Fatalf("review after grade: %v", err)
	}
	if !after.Released || after.Grade == nil {
		t.Fatalf("post-grade: released=%v grade=%v, want true/non-nil", after.Released, after.Grade)
	}
	if after.Grade.OverallBand != 6.5 {
		t.Errorf("student grade overallBand = %v, want 6.5", after.Grade.OverallBand)
	}
}

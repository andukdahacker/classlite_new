// Story 6.3a (AC5/AC8/AC10 · D1/D2/D3/D4). GradeSpeaking service
// integration over the REAL DB in a tx (SetupDB, RLS enforced under classlite_app).
// Mirrors grading_service_test.go (setupGradingEnv) but for the SPEAKING branch.
//
// Build-tagged `atdd_red_phase`: excluded from `go test ./...`; run with
//   go test -tags=atdd_red_phase ./internal/test/...
// FAILS TO COMPILE today (GradeSpeaking / ReviseSpeakingGrade / .WithStorage /
// SpeakingGradeWriteInput / grading.SpeakingCriterionScores etc. do not exist).
//
// WF-8 HARD GATE (risk 6) — this file owns the red-first R1 grade-write isolation +
// the SEC-7 service-layer branch guards. The R9 audio-presign authz is in the
// sibling speaking_audio_authz_atdd_test.go. R16 (immutability trigger) and the
// grades-table cross-tenant RLS PRIMITIVE are DISCHARGED BY INHERITANCE
// (submission_immutable_trigger_test.go / grades_rls_test.go, 6.1) — the tests here
// exercise them through the NEW speaking write path, not by re-seeding the primitive.
//
// SEAMS (dev, green phase — the ONE place to reconcile):
//   - service.NewGradingService(db, audit, clk).WithStorage(mock)  ← NEW .WithStorage
//       builder (D5 — GradingService has NO storage today; main.go:580 rewired)
//   - (*GradingService).GradeSpeaking(ctx, tc, submissionID uuid.UUID,
//         in service.SpeakingGradeWriteInput) (*service.GradeView, error)
//   - (*GradingService).ReviseSpeakingGrade(ctx, tc, submissionID, service.SpeakingGradeWriteInput) (*service.GradeView, error)
//   - service.SpeakingGradeWriteInput{ Scores grading.SpeakingCriterionScores;
//         Comments []grading.TimestampedComment; Feedback *string; Reason string }
//   - assertSpeakingExercise → model.ConflictError{Code:"SUBMISSION_NOT_SPEAKING"}
//       on a non-speaking submission (sibling of assertWritingExercise's
//       SUBMISSION_NOT_WRITING); checked INSIDE the tx → zero side effects.
//   - GradeSpeaking reuses insertGradeRow / GradeSubmission flip / outbox /
//       23505+P0001 translation UNCHANGED (D1 — no grades migration).
package test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/service/grading"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// speakingScores is the SPEAKING analog of grading_service_test.go::scores().
func speakingScores(fc, lr, gr, pr float64) grading.SpeakingCriterionScores {
	return grading.SpeakingCriterionScores{
		FluencyCoherence: fc, LexicalResource: lr, GrammaticalRange: gr, Pronunciation: pr,
	}
}

func tsPtr(v int) *int { return &v }

// insertSpeakingSubmission seeds a speaking submission whose content carries an
// audioKey (under the center prefix, SEC-8) + a persisted durationSec (5.4).
func insertSpeakingSubmission(t *testing.T, db *TxDB, centerID, assignmentID, studentID uuid.UUID, status string, durationSec int) uuid.UUID {
	t.Helper()
	id := uuid.New()
	raw, _ := json.Marshal(map[string]any{
		"audioKey":    centerID.String() + "/speaking/" + uuid.NewString() + ".webm",
		"durationSec": durationSec,
	})
	if _, err := db.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, submitted_at)
		 VALUES ($1, $2, $3, $4, $5, $6, 1, now())`,
		id, centerID, assignmentID, studentID, status, raw); err != nil {
		t.Fatalf("insert speaking submission: %v", err)
	}
	return id
}

type speakingGradingEnv struct {
	db             *TxDB
	centerID       uuid.UUID
	ownerTC        model.TenantContext
	otherTeacherTC model.TenantContext
	studentTC      model.TenantContext
	assignmentID   uuid.UUID
	classID        uuid.UUID
	submissionID   uuid.UUID // speaking, submitted, durationSec=58
	writingSubID   uuid.UUID // writing, submitted — for the regression / branch-guard direction
	gradingSvc     *service.GradingService
	mock           *service.MockStorageService // to assert zero-mint on gated failure (R9)
}

// setupSpeakingGradingEnv mirrors setupGradingEnv: owner (class teacher), a second
// same-tenant teacher (NOT the class teacher), a student, a SPEAKING submission and a
// WRITING submission under the SAME class. GradingService is built WithStorage(mock).
func setupSpeakingGradingEnv(t *testing.T) speakingGradingEnv {
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
	// Speaking exercise + assignment.
	speakingExID := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1, $2, $3, $4, 'Speaking Task', 'speaking', '{"sections":[]}', 1)`,
		speakingExID, centerID, ownerID, "EX-SPK-"+speakingExID.String()[:8]); err != nil {
		t.Fatalf("insert speaking exercise: %v", err)
	}
	// Writing exercise + assignment (regression / branch-guard direction).
	writingExID := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1, $2, $3, $4, 'Writing Task', 'writing', '{"sections":[]}', 1)`,
		writingExID, centerID, ownerID, "EX-WRI-"+writingExID.String()[:8]); err != nil {
		t.Fatalf("insert writing exercise: %v", err)
	}
	if _, err := db.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1, $2, $3, $4, 'active')`,
		uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("insert enrollment: %v", err)
	}
	speakingAssignmentID := rlsInsertAssignment(t, db, centerID, speakingExID, classID, ownerID)
	writingAssignmentID := rlsInsertAssignment(t, db, centerID, writingExID, classID, ownerID)

	submissionID := insertSpeakingSubmission(t, db, centerID, speakingAssignmentID, studentID, "submitted", 58)
	writingSubID := insertWritingSubmission(t, db, centerID, writingAssignmentID, studentID, "submitted", "The quick brown fox essay.")

	audit := service.NewAuditService(db)
	clk := clock.RealClock{}
	mock := service.NewMockStorageService()

	return speakingGradingEnv{
		db:             db,
		centerID:       centerID,
		ownerTC:        model.TenantContext{CenterID: centerID.String(), UserID: ownerID.String(), Role: model.RoleOwner, EmailVerified: true},
		otherTeacherTC: model.TenantContext{CenterID: centerID.String(), UserID: otherTeacherID.String(), Role: model.RoleTeacher, EmailVerified: true},
		studentTC:      model.TenantContext{CenterID: centerID.String(), UserID: studentID.String(), Role: model.RoleStudent, EmailVerified: true},
		assignmentID:   speakingAssignmentID,
		classID:        classID,
		submissionID:   submissionID,
		writingSubID:   writingSubID,
		gradingSvc:     service.NewGradingService(db, audit, clk).WithStorage(mock),
		mock:           mock,
	}
}

func (e speakingGradingEnv) outboxJobCount(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.db.QueryRow(context.Background(),
		`SELECT count(*) FROM jobs WHERE type='grade_release_email' AND center_id=$1`, e.centerID).Scan(&n); err != nil {
		t.Fatalf("count jobs: %v", err)
	}
	return n
}

func (e speakingGradingEnv) gradeRowCount(t *testing.T, submissionID uuid.UUID) int {
	t.Helper()
	var n int
	if err := e.db.QueryRow(context.Background(),
		`SELECT count(*) FROM grades WHERE submission_id=$1`, submissionID).Scan(&n); err != nil {
		t.Fatalf("count grades: %v", err)
	}
	return n
}

// -----------------------------------------------------------------------------
// AC8/AC5 — happy path: server-authoritative band, flip, outbox, comments persisted.
// -----------------------------------------------------------------------------

func TestGradeSpeaking_HappyPath_ServerBand_Outbox_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	ctx := context.Background()

	fb := "Solid response."
	grade, err := e.gradingSvc.GradeSpeaking(ctx, e.ownerTC, e.submissionID, service.SpeakingGradeWriteInput{
		Scores: speakingScores(6.5, 6.5, 7, 7),
		Comments: []grading.TimestampedComment{
			{Type: "praise", Criterion: grading.CriterionFluencyCoherence, TimestampMs: tsPtr(12_000), Text: "clear opening"},
			{Type: "error", Criterion: grading.CriterionPronunciation, TimestampMs: nil, Text: "general vowel note"},
		},
		Feedback: &fb,
	})
	if err != nil {
		t.Fatalf("GradeSpeaking happy path: %v", err)
	}
	// Server authority: 6.5/6.5/7/7 → 6.75 → next whole → 7.0 (IELTS .75 special-up).
	if grade.OverallBand != 7.0 {
		t.Errorf("server overallBand = %v, want 7.0 (authoritative, client value advisory)", grade.OverallBand)
	}
	var status string
	if err := e.db.QueryRow(ctx, `SELECT status FROM submissions WHERE id=$1`, e.submissionID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "graded" {
		t.Errorf("submission status = %q, want graded", status)
	}
	if n := e.outboxJobCount(t); n != 1 {
		t.Errorf("grade-release outbox rows = %d, want 1 (reused enqueueGradeReleaseOutbox)", n)
	}
}

// -----------------------------------------------------------------------------
// AC10 / R1=9 — cross-tenant grade READ + WRITE isolation (TEST-BE-1).
// A tenant-A teacher cannot read or write a grade for a tenant-B speaking submission.
// -----------------------------------------------------------------------------

func TestGradeSpeaking_CrossTenant_ReadWrite_Isolated_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	ctx := context.Background()

	// Seed a SPEAKING submission under tenant B.
	centerB := CreateCenterWithID(t, e.db, TenantBID, "Center B", "center-b")
	centerBID := uuid.UUID(centerB.ID.Bytes)
	TenantContext(t, e.db, centerB.ID)
	bTeacher := rlsInsertUserAS(t, e.db, "b-teacher-"+uuid.NewString()+"@example.com")
	bStudent := rlsInsertUserAS(t, e.db, "b-student-"+uuid.NewString()+"@example.com")
	CreateCenterMember(t, e.db, pgUUIDFromGo(bTeacher), centerB.ID, "owner")
	CreateCenterMember(t, e.db, pgUUIDFromGo(bStudent), centerB.ID, "student")
	bClass := uuid.New()
	if _, err := e.db.Exec(ctx, `INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'B Class','active',$3)`, bClass, centerBID, bTeacher); err != nil {
		t.Fatalf("seed B class: %v", err)
	}
	bEx := uuid.New()
	if _, err := e.db.Exec(ctx, `INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version) VALUES ($1,$2,$3,$4,'B Speaking','speaking','{"sections":[]}',1)`, bEx, centerBID, bTeacher, "EX-B-"+bEx.String()[:8]); err != nil {
		t.Fatalf("seed B exercise: %v", err)
	}
	if _, err := e.db.Exec(ctx, `INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`, uuid.New(), centerBID, bStudent, bClass); err != nil {
		t.Fatalf("seed B enrollment: %v", err)
	}
	bAssignment := rlsInsertAssignment(t, e.db, centerBID, bEx, bClass, bTeacher)
	bSubmission := insertSpeakingSubmission(t, e.db, centerBID, bAssignment, bStudent, "submitted", 40)

	// Back to tenant A; the A owner attempts to read + write B's submission.
	TenantContext(t, e.db, pgtype.UUID{Bytes: [16]byte(e.centerID), Valid: true})

	// READ isolation: GetSubmissionForGrading for B's id → NOT FOUND (RLS 404).
	if _, rerr := e.gradingSvc.GetSubmissionForGrading(ctx, e.ownerTC, bSubmission); rerr == nil {
		t.Error("R1 READ leak: tenant A read tenant B's speaking grading view (want not-found)")
	}
	// WRITE isolation: GradeSpeaking for B's id → error, and ZERO grade rows in B.
	if _, werr := e.gradingSvc.GradeSpeaking(ctx, e.ownerTC, bSubmission, service.SpeakingGradeWriteInput{
		Scores: speakingScores(6, 6, 6, 6), Comments: []grading.TimestampedComment{},
	}); werr == nil {
		t.Error("R1 WRITE leak: tenant A graded tenant B's speaking submission (want not-found)")
	}
	TenantContext(t, e.db, centerB.ID)
	if n := e.gradeRowCount(t, bSubmission); n != 0 {
		t.Errorf("R1 WRITE leak: %d grade rows written to tenant B, want 0", n)
	}
}

// -----------------------------------------------------------------------------
// AC8/AC10 / R1 — same-tenant WRONG-teacher → 403 + ZERO side effects.
// otherTeacher is a 'teacher' member but NOT the class teacher (class.teacher_id=owner).
// -----------------------------------------------------------------------------

func TestGradeSpeaking_WrongTeacher_403_ZeroSideEffects_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	_, err := e.gradingSvc.GradeSpeaking(context.Background(), e.otherTeacherTC, e.submissionID, service.SpeakingGradeWriteInput{
		Scores: speakingScores(6, 6, 6, 6), Comments: []grading.TimestampedComment{},
	})
	var forbidden *service.ForbiddenError
	if !errors.As(err, &forbidden) {
		t.Fatalf("expected 403 ForbiddenError for a same-tenant non-class teacher, got %v", err)
	}
	if n := e.outboxJobCount(t); n != 0 {
		t.Errorf("403 leaked side effects: %d outbox jobs, want 0", n)
	}
	if n := e.gradeRowCount(t, e.submissionID); n != 0 {
		t.Errorf("403 leaked side effects: %d grade rows, want 0", n)
	}
}

// -----------------------------------------------------------------------------
// SEC-7 (service layer) — the branch is chosen from the DB skill, not a client field.
// Neither direction can be mis-graded, and the failing direction commits ZERO rows.
// -----------------------------------------------------------------------------

func TestGradeSpeaking_OnWritingSubmission_Conflict_ZeroSideEffects_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	_, err := e.gradingSvc.GradeSpeaking(context.Background(), e.ownerTC, e.writingSubID, service.SpeakingGradeWriteInput{
		Scores: speakingScores(6, 6, 6, 6), Comments: []grading.TimestampedComment{},
	})
	var conflict model.ConflictError
	if !errors.As(err, &conflict) || conflict.Code != "SUBMISSION_NOT_SPEAKING" {
		t.Fatalf("GradeSpeaking on a WRITING submission → want ConflictError SUBMISSION_NOT_SPEAKING, got %v", err)
	}
	if n := e.gradeRowCount(t, e.writingSubID); n != 0 {
		t.Errorf("skill-guard leaked: %d grade rows on the writing submission, want 0", n)
	}
}

// The writing path stays unbroken: GradeWriting on the SPEAKING submission still
// 409s (SUBMISSION_NOT_WRITING) — the existing guard is not weakened by the branch.
func TestGradeWriting_OnSpeakingSubmission_StillConflicts_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	_, err := e.gradingSvc.GradeWriting(context.Background(), e.ownerTC, e.submissionID, service.GradeWriteInput{
		Scores: grading.CriterionScores{TaskResponse: 6, CoherenceCohesion: 6, LexicalResource: 6, GrammaticalRange: 6},
	})
	var conflict model.ConflictError
	if !errors.As(err, &conflict) || conflict.Code != "SUBMISSION_NOT_WRITING" {
		t.Fatalf("GradeWriting on a SPEAKING submission → want SUBMISSION_NOT_WRITING (regression guard), got %v", err)
	}
}

// -----------------------------------------------------------------------------
// AC5 — band off-grid via the twin validator → validation error (422), zero rows.
// -----------------------------------------------------------------------------

func TestGradeSpeaking_OffGridBand_422_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	_, err := e.gradingSvc.GradeSpeaking(context.Background(), e.ownerTC, e.submissionID, service.SpeakingGradeWriteInput{
		Scores: speakingScores(6.25, 6, 6, 6), Comments: []grading.TimestampedComment{},
	})
	if err == nil {
		t.Fatal("off-grid speaking band must be rejected by ValidateSpeakingCriterionScores (422)")
	}
	if n := e.gradeRowCount(t, e.submissionID); n != 0 {
		t.Errorf("rejected grade leaked %d rows, want 0", n)
	}
}

// -----------------------------------------------------------------------------
// AC7 / D4 — plausible pin past the rounded-down persisted duration is KEPT through
// the service write (the FE-decoded-vs-BE-persisted divergence). Persist=58s here;
// a 59s pin must survive as a pinned comment.
// -----------------------------------------------------------------------------

func TestGradeSpeaking_TimestampComment_PlausiblePastPersist_Kept_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	ctx := context.Background()
	if _, err := e.gradingSvc.GradeSpeaking(ctx, e.ownerTC, e.submissionID, service.SpeakingGradeWriteInput{
		Scores: speakingScores(6, 6, 6, 6),
		Comments: []grading.TimestampedComment{
			{Type: "error", Criterion: grading.CriterionPronunciation, TimestampMs: tsPtr(59_000), Text: "th→f slip"},
		},
	}); err != nil {
		t.Fatalf("GradeSpeaking: %v", err)
	}
	var comments []byte
	if err := e.db.QueryRow(ctx, `SELECT comments FROM grades WHERE submission_id=$1`, e.submissionID).Scan(&comments); err != nil {
		t.Fatalf("read comments: %v", err)
	}
	var parsed []map[string]any
	if err := json.Unmarshal(comments, &parsed); err != nil {
		t.Fatalf("unmarshal comments: %v", err)
	}
	if len(parsed) != 1 {
		t.Fatalf("want 1 persisted comment, got %d", len(parsed))
	}
	if parsed[0]["timestampMs"] == nil {
		t.Error("plausible pin at 59s (persist 58s) was demoted to general — D4 lenient bound violated through the service")
	}
}

// -----------------------------------------------------------------------------
// AC8 — immutability reuse (inherited P0001 trigger) + revise happy-path.
// -----------------------------------------------------------------------------

func TestGradeSpeaking_ReleasedThenRegrade_409_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	ctx := context.Background()
	if _, err := e.gradingSvc.GradeSpeaking(ctx, e.ownerTC, e.submissionID, service.SpeakingGradeWriteInput{
		Scores: speakingScores(6, 6, 6, 6), Comments: []grading.TimestampedComment{},
	}); err != nil {
		t.Fatalf("first grade: %v", err)
	}
	// Re-grade a released submission → the shared submission_immutable_after_release
	// trigger fires (P0001) → translated to 409. (Trigger itself proven at 6.1.)
	_, err := e.gradingSvc.GradeSpeaking(ctx, e.ownerTC, e.submissionID, service.SpeakingGradeWriteInput{
		Scores: speakingScores(7, 7, 7, 7), Comments: []grading.TimestampedComment{},
	})
	if err == nil {
		t.Fatal("re-grade of a released speaking submission must 409 (inherited immutability trigger)")
	}
}

func TestReviseSpeakingGrade_NewVersionRow_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	ctx := context.Background()
	if _, err := e.gradingSvc.GradeSpeaking(ctx, e.ownerTC, e.submissionID, service.SpeakingGradeWriteInput{
		Scores: speakingScores(6, 6, 6, 6), Comments: []grading.TimestampedComment{},
	}); err != nil {
		t.Fatalf("v1 grade: %v", err)
	}
	v2, err := e.gradingSvc.ReviseSpeakingGrade(ctx, e.ownerTC, e.submissionID, service.SpeakingGradeWriteInput{
		Scores: speakingScores(7, 7, 7, 7), Comments: []grading.TimestampedComment{}, Reason: "re-listened",
	})
	if err != nil {
		t.Fatalf("ReviseSpeakingGrade: %v", err)
	}
	if v2.Version != 2 {
		t.Errorf("revised grade version = %d, want 2 (prior version retained)", v2.Version)
	}
	if n := e.gradeRowCount(t, e.submissionID); n != 2 {
		t.Errorf("revise must INSERT a new version row (append-only): %d rows, want 2", n)
	}
}

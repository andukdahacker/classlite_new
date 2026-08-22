// Story 6.3a — Speaking grading test helpers. A bare-mux grading test server over the
// open authenticated + staff-gated chain (extractTenant → requireVerified →
// requireCenter → RequireRole staff → ErrorMapper), plus committed speaking/writing
// submission fixtures seeded via the superuser pool so an HTTP request in its own tx
// can read them (the D2 decode-order + SEC-7 skill-branch reds).
package test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewGradingHandlerTestServer wires the grade + grade/revise + grading-read + teacher
// audio-refresh routes over the production grading chain (staff-gated) without auth
// injection, so a test supplies its own bearer token. GradingService is built
// WithStorage(mock) so the teacher-audio route is exercisable.
func NewGradingHandlerTestServer(t *testing.T, pool *pgxpool.Pool) http.Handler {
	t.Helper()
	gradingSvc := service.NewGradingService(pool, service.NewAuditService(pool), clock.RealClock{}).
		WithStorage(service.NewMockStorageService())
	gradingHandler := handler.NewGradingHandler(gradingSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(pool, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	requireStaff := middleware.RequireRole("owner", "admin", "teacher")
	chain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(
					requireStaff(http.HandlerFunc(middleware.ErrorMapper(h))),
				),
			),
		)
	}
	mux := http.NewServeMux()
	mux.Handle("POST /api/submissions/{submissionId}/grade", chain(gradingHandler.Grade))
	mux.Handle("POST /api/submissions/{submissionId}/grade/revise", chain(gradingHandler.Revise))
	mux.Handle("GET /api/submissions/{submissionId}/grading", chain(gradingHandler.GetGrading))
	mux.Handle("GET /api/classes/{classId}/grading/{assignmentId}/{submissionId}/audio", chain(gradingHandler.GetTeacherAudio))
	return mux
}

// seedGradableSubmissionOnPool inserts a committed class (teacher=classTeacherID) +
// exercise (of skill) + enrollment + open assignment + submitted submission via the
// superuser pool (cross-tx visible). Returns (assignmentID, submissionID) as strings.
func seedGradableSubmissionOnPool(
	t *testing.T, centerID, classTeacherID, studentID, skill string, content []byte,
) (string, string) {
	t.Helper()
	sp := superuserPool(t)
	ctx := context.Background()

	classID := uuid.NewString()
	if _, err := sp.Exec(ctx,
		`INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'S Class','active',$3)`,
		classID, centerID, classTeacherID); err != nil {
		t.Fatalf("seed class: %v", err)
	}
	exerciseID := uuid.NewString()
	if _, err := sp.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1,$2,$3,$4,'Task',$5,'{"sections":[]}',1)`,
		exerciseID, centerID, classTeacherID, "EX-"+exerciseID[:8], skill); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`,
		uuid.NewString(), centerID, studentID, classID); err != nil {
		t.Fatalf("seed enrollment: %v", err)
	}
	assignmentID := uuid.NewString()
	if _, err := sp.Exec(ctx,
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, late_penalty)
		 VALUES ($1,$2,$3,$4,$5,'open', now() + interval '7 days', 1.5)`,
		assignmentID, centerID, exerciseID, classID, classTeacherID); err != nil {
		t.Fatalf("seed assignment: %v", err)
	}
	submissionID := uuid.NewString()
	if _, err := sp.Exec(ctx,
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, submitted_at)
		 VALUES ($1,$2,$3,$4,'submitted',$5,1, now())`,
		submissionID, centerID, assignmentID, studentID, content); err != nil {
		t.Fatalf("seed submission: %v", err)
	}
	t.Cleanup(func() {
		_, _ = sp.Exec(context.Background(), `DELETE FROM grades WHERE submission_id=$1`, submissionID)
		_, _ = sp.Exec(context.Background(), `DELETE FROM jobs WHERE center_id=$1 AND type='grade_release_email'`, centerID)
		_, _ = sp.Exec(context.Background(), `DELETE FROM submissions WHERE id=$1`, submissionID)
		_, _ = sp.Exec(context.Background(), `DELETE FROM assignments WHERE id=$1`, assignmentID)
		_, _ = sp.Exec(context.Background(), `DELETE FROM enrollments WHERE class_id=$1`, classID)
		_, _ = sp.Exec(context.Background(), `DELETE FROM exercises WHERE id=$1`, exerciseID)
		_, _ = sp.Exec(context.Background(), `DELETE FROM classes WHERE id=$1`, classID)
	})
	return assignmentID, submissionID
}

// SeedSpeakingSubmissionOnPool seeds a committed SPEAKING submission whose content
// carries an audioKey (under the center prefix, SEC-8) + a persisted durationSec (5.4).
func SeedSpeakingSubmissionOnPool(t *testing.T, _ *pgxpool.Pool, centerID, classTeacherID, studentID string) (string, string) {
	t.Helper()
	content, _ := json.Marshal(map[string]any{
		"audioKey":    centerID + "/speaking/" + uuid.NewString() + ".webm",
		"durationSec": 278,
	})
	return seedGradableSubmissionOnPool(t, centerID, classTeacherID, studentID, "speaking", content)
}

// SeedWritingSubmissionOnPool seeds a committed WRITING submission (content.text).
func SeedWritingSubmissionOnPool(t *testing.T, _ *pgxpool.Pool, centerID, classTeacherID, studentID string) (string, string) {
	t.Helper()
	content, _ := json.Marshal(map[string]any{"text": "The quick brown fox essay."})
	return seedGradableSubmissionOnPool(t, centerID, classTeacherID, studentID, "writing", content)
}

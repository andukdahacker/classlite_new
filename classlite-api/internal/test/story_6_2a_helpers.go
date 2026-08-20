// Story 6.2a — AI Writing-grade test helpers. SeedWritingSubmissionForTenant is the
// exported fixture the worker ATDD scaffolds (worker_test) and the enqueue/read tests
// (package test) both seed from: a full class → exercise(writing) → assignment →
// student → submission chain under a given tenant, whose essay text is EXACTLY
// gemini.WritingGradeFixtureEssay so the MockValidWritingGrade comment offsets (an
// orphan at len(essay)+5; one straddling the 🦊 surrogate pair) align with a KNOWN
// essay — the demotion assertions cannot go vacuously green.
//
// This lives in a NON-test .go file (so worker_test can import it via testpkg), which
// means it cannot use the file-local rls* seeders defined in _test.go files — the
// class/exercise/assignment/user inserts are therefore inlined here as raw SQL.
package test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ducdo/classlite-api/internal/gemini"
)

// SeedWritingSubmissionForTenant seeds a submitted Writing submission (content.text =
// gemini.WritingGradeFixtureEssay) under centerID and returns its id. The center must
// already exist (call CreateCenterWithID first). Sets the tenant context to centerID
// for the RLS-scoped inserts.
func SeedWritingSubmissionForTenant(t *testing.T, db *TxDB, centerID uuid.UUID) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	TenantContext(t, db, pgtype.UUID{Bytes: centerID, Valid: true})

	teacherID := seedWritingUser(t, db, "teacher-"+uuid.NewString()+"@example.com")
	studentID := seedWritingUser(t, db, "student-"+uuid.NewString()+"@example.com")

	classID := uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO classes (id, center_id, name, status, teacher_id)
		 VALUES ($1, $2, 'AI Grade Class', 'active', $3)`, classID, centerID, teacherID); err != nil {
		t.Fatalf("seed writing submission: insert class: %v", err)
	}
	exerciseID := uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1, $2, $3, $4, 'Writing Task', 'writing', '{"sections":[]}', 1)`,
		exerciseID, centerID, teacherID, "EX-AIG-"+exerciseID.String()[:8]); err != nil {
		t.Fatalf("seed writing submission: insert exercise: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status)
		 VALUES ($1, $2, $3, $4, 'active')`, uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("seed writing submission: insert enrollment: %v", err)
	}
	assignmentID := uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, late_penalty)
		 VALUES ($1, $2, $3, $4, $5, 'open', now() + interval '7 days', 1.5)`,
		assignmentID, centerID, exerciseID, classID, teacherID); err != nil {
		t.Fatalf("seed writing submission: insert assignment: %v", err)
	}

	submissionID := uuid.New()
	content, err := json.Marshal(map[string]string{"text": gemini.WritingGradeFixtureEssay})
	if err != nil {
		t.Fatalf("seed writing submission: marshal content: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, submitted_at)
		 VALUES ($1, $2, $3, $4, 'submitted', $5, 1, now())`,
		submissionID, centerID, assignmentID, studentID, content); err != nil {
		t.Fatalf("seed writing submission: insert submission: %v", err)
	}
	return submissionID
}

// seedWritingUser inserts a global (RLS-free) user for the writing-grade fixtures.
func seedWritingUser(t *testing.T, db *TxDB, email string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO users (id, email, full_name, password_hash, email_verified)
		 VALUES ($1, $2, 'Writing Fixture User', 'x', true)`, id, email); err != nil {
		t.Fatalf("seed writing user: %v", err)
	}
	return id
}

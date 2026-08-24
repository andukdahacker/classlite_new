// Story 6.3b — AI Speaking-grade test helpers. The SPEAKING twin of
// story_6_2a_helpers.go: SeedSpeakingSubmissionForTenant seeds a full class →
// exercise(speaking) → assignment → student → submission chain under a tenant, with
// content.audioKey under the center prefix (SEC-8) and content.durationSec ==
// gemini.SpeakingGradeFixtureDurationSec so the MockValidSpeakingGrade moment offsets
// (the OUT-of-bound pin) align with a KNOWN duration — the demote assertion cannot go
// vacuously green. SeedSpeakingSubmissionWithAudioKey takes a caller-supplied audioKey
// (the T-B poisoned key carries a FOREIGN center prefix while the submission is legit
// under A).
//
// Lives in a NON-test .go file (so worker_test can import it via testpkg), so the
// class/exercise/assignment/user inserts are raw SQL (it cannot use the _test.go rls*
// seeders), mirroring SeedWritingSubmissionForTenant.
package test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ducdo/classlite-api/internal/gemini"
)

// SeedSpeakingSubmissionForTenant seeds a submitted Speaking submission under centerID
// with a center-owned audioKey (SEC-8) + content.durationSec ==
// gemini.SpeakingGradeFixtureDurationSec, and returns (submissionID, audioKey). The
// center must already exist (call CreateCenterWithID first).
func SeedSpeakingSubmissionForTenant(t *testing.T, db *TxDB, centerID uuid.UUID) (uuid.UUID, string) {
	t.Helper()
	audioKey := centerID.String() + "/speaking/" + uuid.NewString() + ".webm"
	return seedSpeakingSubmission(t, db, centerID, audioKey), audioKey
}

// SeedSpeakingSubmissionWithAudioKey seeds a submitted Speaking submission legitimately
// under centerID but with a CALLER-SUPPLIED audioKey (the T-B poisoned-key probe: the
// submission is under A, but its audioKey carries B's prefix). Returns the submission id.
func SeedSpeakingSubmissionWithAudioKey(t *testing.T, db *TxDB, centerID uuid.UUID, audioKey string) uuid.UUID {
	t.Helper()
	return seedSpeakingSubmission(t, db, centerID, audioKey)
}

func seedSpeakingSubmission(t *testing.T, db *TxDB, centerID uuid.UUID, audioKey string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	TenantContext(t, db, pgtype.UUID{Bytes: centerID, Valid: true})

	teacherID := seedWritingUser(t, db, "teacher-"+uuid.NewString()+"@example.com")
	studentID := seedWritingUser(t, db, "student-"+uuid.NewString()+"@example.com")

	classID := uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO classes (id, center_id, name, status, teacher_id)
		 VALUES ($1, $2, 'AI Speaking Class', 'active', $3)`, classID, centerID, teacherID); err != nil {
		t.Fatalf("seed speaking submission: insert class: %v", err)
	}
	exerciseID := uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1, $2, $3, $4, 'Speaking Task', 'speaking', '{"sections":[]}', 1)`,
		exerciseID, centerID, teacherID, "EX-AIS-"+exerciseID.String()[:8]); err != nil {
		t.Fatalf("seed speaking submission: insert exercise: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status)
		 VALUES ($1, $2, $3, $4, 'active')`, uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("seed speaking submission: insert enrollment: %v", err)
	}
	assignmentID := uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, late_penalty)
		 VALUES ($1, $2, $3, $4, $5, 'open', now() + interval '7 days', 1.5)`,
		assignmentID, centerID, exerciseID, classID, teacherID); err != nil {
		t.Fatalf("seed speaking submission: insert assignment: %v", err)
	}

	submissionID := uuid.New()
	content, err := json.Marshal(map[string]any{
		"audioKey":    audioKey,
		"durationSec": gemini.SpeakingGradeFixtureDurationSec,
	})
	if err != nil {
		t.Fatalf("seed speaking submission: marshal content: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, submitted_at)
		 VALUES ($1, $2, $3, $4, 'submitted', $5, 1, now())`,
		submissionID, centerID, assignmentID, studentID, content); err != nil {
		t.Fatalf("seed speaking submission: insert submission: %v", err)
	}
	return submissionID
}

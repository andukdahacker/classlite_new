// Story 6.1 (AC4/AC6, B3) — TRUE 2-connection grade/revise races on the raw pool.
// GRADE: the submission FOR UPDATE lock serializes; the loser sees status='graded'
// → 409 with zero side effects (one grade row, one outbox job). REVISE: no
// serializing lock — both compute version N+1 and UNIQUE(submission_id,version)
// rejects the loser (23505 → 409 GRADE_REVISE_CONFLICT), leaving versions {1,2}.
package test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/service/grading"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type gradingRaceEnv struct {
	svc          *service.GradingService
	tc           model.TenantContext
	centerID     uuid.UUID
	submissionID uuid.UUID
}

func seedGradingRaceEnv(t *testing.T, su, pool *pgxpool.Pool) gradingRaceEnv {
	return seedGradingRaceEnvSkill(t, su, pool, "writing")
}

func seedGradingRaceEnvSkill(t *testing.T, su, pool *pgxpool.Pool, skill string) gradingRaceEnv {
	t.Helper()
	ctx := context.Background()
	centerID := uuid.New()
	ownerID := uuid.New()
	studentID := uuid.New()
	classID := uuid.New()
	exerciseID := uuid.New()
	assignmentID := uuid.New()
	submissionID := uuid.New()
	short := "grace-" + centerID.String()[:8]

	mustExec(t, su, ctx, `INSERT INTO centers (id, name, short_code) VALUES ($1,$2,$3)`, centerID, "Grade Race", short)
	mustExec(t, su, ctx, `INSERT INTO users (id, email, full_name, password_hash, email_verified) VALUES ($1,$2,'O','x',true)`, ownerID, "o-"+short+"@e.com")
	mustExec(t, su, ctx, `INSERT INTO users (id, email, full_name, password_hash, email_verified) VALUES ($1,$2,'S','x',true)`, studentID, "s-"+short+"@e.com")
	mustExec(t, su, ctx, `INSERT INTO center_members (center_id, user_id, role) VALUES ($1,$2,'owner')`, centerID, ownerID)
	mustExec(t, su, ctx, `INSERT INTO center_members (center_id, user_id, role) VALUES ($1,$2,'student')`, centerID, studentID)
	mustExec(t, su, ctx, `INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'C','active',$3)`, classID, centerID, ownerID)
	mustExec(t, su, ctx, `INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version) VALUES ($1,$2,$3,$4,'Ex',$5,'{"sections":[]}',1)`, exerciseID, centerID, ownerID, "EX-"+short, skill)
	mustExec(t, su, ctx, `INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`, uuid.New(), centerID, studentID, classID)
	mustExec(t, su, ctx, `INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, late_penalty) VALUES ($1,$2,$3,$4,$5,'open', now() + interval '7 days', 0)`, assignmentID, centerID, exerciseID, classID, ownerID)
	mustExec(t, su, ctx, `INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, submitted_at) VALUES ($1,$2,$3,$4,'submitted','{"text":"essay"}',1, now())`, submissionID, centerID, assignmentID, studentID)

	t.Cleanup(func() {
		_, _ = su.Exec(ctx, `DELETE FROM jobs WHERE center_id=$1`, centerID)
		_, _ = su.Exec(ctx, `DELETE FROM grades WHERE center_id=$1`, centerID)
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

	return gradingRaceEnv{
		svc:          service.NewGradingService(pool, service.NewAuditService(pool), clock.RealClock{}),
		tc:           model.TenantContext{CenterID: centerID.String(), UserID: ownerID.String(), Role: model.RoleOwner, EmailVerified: true},
		centerID:     centerID,
		submissionID: submissionID,
	}
}

func raceScores() grading.CriterionScores {
	return grading.CriterionScores{TaskResponse: 6, CoherenceCohesion: 6, LexicalResource: 6, GrammaticalRange: 6}
}

func TestGradeWriting_ConcurrentDoubleGrade_OneWins(t *testing.T) {
	su := SuperuserPool(t)
	pool := SetupRawPool(t)
	env := seedGradingRaceEnv(t, su, pool)
	ctx := context.Background()

	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			_, errs[idx] = env.svc.GradeWriting(ctx, env.tc, env.submissionID, service.GradeWriteInput{
				Scores: raceScores(), Comments: []grading.Comment{},
			})
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
		if errors.As(err, &c) && c.Code == "SUBMISSION_ALREADY_GRADED" {
			conflicts++
		} else {
			t.Fatalf("unexpected error from concurrent grade: %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent grade: %d wins / %d conflicts, want 1/1", successes, conflicts)
	}
	// Exactly one grade row + one outbox job (the loser committed zero side effects).
	var grades, jobs int
	su.QueryRow(ctx, `SELECT count(*) FROM grades WHERE submission_id=$1`, env.submissionID).Scan(&grades)
	su.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE center_id=$1 AND type='grade_release_email'`, env.centerID).Scan(&jobs)
	if grades != 1 {
		t.Errorf("expected 1 grade row after concurrent grade, got %d", grades)
	}
	if jobs != 1 {
		t.Errorf("expected 1 outbox job after concurrent grade, got %d", jobs)
	}
}

// TestGradeWriting_NonWritingSubmission_Rejected proves the P1 skill guard AND the
// Task-7 "failure before commit → zero side effects" contract: grading a non-Writing
// (speaking) submission is rejected inside the tx (409 SUBMISSION_NOT_WRITING), so no
// grade row, no outbox job (→ no event, no email post-commit), and the submission
// stays 'submitted' — the whole tx rolled back.
func TestGradeWriting_NonWritingSubmission_Rejected(t *testing.T) {
	su := SuperuserPool(t)
	pool := SetupRawPool(t)
	env := seedGradingRaceEnvSkill(t, su, pool, "speaking")
	ctx := context.Background()

	_, err := env.svc.GradeWriting(ctx, env.tc, env.submissionID, service.GradeWriteInput{
		Scores: raceScores(), Comments: []grading.Comment{},
	})
	var c model.ConflictError
	if !errors.As(err, &c) || c.Code != "SUBMISSION_NOT_WRITING" {
		t.Fatalf("grading a non-writing submission: want 409 SUBMISSION_NOT_WRITING, got %v", err)
	}

	// Zero side effects: no grade, no outbox job, submission untouched.
	var grades, jobs int
	var status string
	su.QueryRow(ctx, `SELECT count(*) FROM grades WHERE submission_id=$1`, env.submissionID).Scan(&grades)
	su.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE center_id=$1 AND type='grade_release_email'`, env.centerID).Scan(&jobs)
	su.QueryRow(ctx, `SELECT status FROM submissions WHERE id=$1`, env.submissionID).Scan(&status)
	if grades != 0 || jobs != 0 {
		t.Errorf("rejected grade left side effects: grades=%d jobs=%d, want 0/0", grades, jobs)
	}
	if status != "submitted" {
		t.Errorf("rejected grade mutated submission status = %q, want submitted", status)
	}
}

func TestReviseGrade_ConcurrentRevise_UniqueRejectsLoser(t *testing.T) {
	su := SuperuserPool(t)
	pool := SetupRawPool(t)
	env := seedGradingRaceEnv(t, su, pool)
	ctx := context.Background()

	// Establish v1.
	if _, err := env.svc.GradeWriting(ctx, env.tc, env.submissionID, service.GradeWriteInput{
		Scores: raceScores(), Comments: []grading.Comment{},
	}); err != nil {
		t.Fatalf("initial grade: %v", err)
	}

	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			_, errs[idx] = env.svc.ReviseGrade(ctx, env.tc, env.submissionID, service.GradeWriteInput{
				Scores: raceScores(), Comments: []grading.Comment{}, Reason: "concurrent revise",
			})
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
		if errors.As(err, &c) && c.Code == "GRADE_REVISE_CONFLICT" {
			conflicts++
		} else {
			t.Fatalf("unexpected error from concurrent revise: %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent revise: %d wins / %d conflicts, want 1/1", successes, conflicts)
	}
	// Versions are exactly {1, 2} — the UNIQUE index prevented a duplicate v2.
	var maxVersion, count int
	su.QueryRow(ctx, `SELECT COALESCE(MAX(version),0), COUNT(*) FROM grades WHERE submission_id=$1`, env.submissionID).Scan(&maxVersion, &count)
	if maxVersion != 2 || count != 2 {
		t.Errorf("after concurrent revise: maxVersion=%d count=%d, want 2/2", maxVersion, count)
	}
}

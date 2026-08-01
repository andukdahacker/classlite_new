// Story 5.1 (AC7, Murat #4) — TRUE 2-connection double-start race. Two real
// connections call Start concurrently for the same (assignment, student); the
// shared advisory lock + UNIQUE(assignment_id, student_id) must yield EXACTLY ONE
// row and exactly one 201 (the other resumes). Uses the raw pool (SetupDB's
// savepoint tx cannot provide concurrent connections) with superuser seed/cleanup.
package test

import (
	"context"
	"sync"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestStartSubmission_ConcurrentDoubleStart_ExactlyOneRow(t *testing.T) {
	pool := SetupRawPool(t)
	su := SuperuserPool(t)
	ctx := context.Background()

	centerID := uuid.New()
	teacherID := uuid.New()
	studentID := uuid.New()
	classID := uuid.New()
	exerciseID := uuid.New()
	assignmentID := uuid.New()
	short := "race-" + centerID.String()[:8]

	// Seed everything as superuser (RLS bypassed).
	mustExec(t, su, ctx, `INSERT INTO centers (id, name, short_code) VALUES ($1,$2,$3)`, centerID, "Race Center", short)
	mustExec(t, su, ctx, `INSERT INTO users (id, email, full_name, password_hash, email_verified) VALUES ($1,$2,'T','x',true)`, teacherID, "t-"+short+"@e.com")
	mustExec(t, su, ctx, `INSERT INTO users (id, email, full_name, password_hash, email_verified) VALUES ($1,$2,'S','x',true)`, studentID, "s-"+short+"@e.com")
	mustExec(t, su, ctx, `INSERT INTO center_members (center_id, user_id, role) VALUES ($1,$2,'owner')`, centerID, teacherID)
	mustExec(t, su, ctx, `INSERT INTO center_members (center_id, user_id, role) VALUES ($1,$2,'student')`, centerID, studentID)
	mustExec(t, su, ctx, `INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'C','active',$3)`, classID, centerID, teacherID)
	mustExec(t, su, ctx, `INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version) VALUES ($1,$2,$3,$4,'Ex','reading','{"sections":[]}',1)`, exerciseID, centerID, teacherID, "EX-"+short)
	mustExec(t, su, ctx, `INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`, uuid.New(), centerID, studentID, classID)
	mustExec(t, su, ctx, `INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, late_penalty) VALUES ($1,$2,$3,$4,$5,'open', now() + interval '7 days', 0)`, assignmentID, centerID, exerciseID, classID, teacherID)

	t.Cleanup(func() {
		// Child-first cleanup honoring the FK RESTRICT chain.
		_, _ = su.Exec(ctx, `DELETE FROM submissions WHERE assignment_id=$1`, assignmentID)
		_, _ = su.Exec(ctx, `DELETE FROM assignments WHERE id=$1`, assignmentID)
		_, _ = su.Exec(ctx, `DELETE FROM enrollments WHERE class_id=$1`, classID)
		_, _ = su.Exec(ctx, `DELETE FROM exercises WHERE id=$1`, exerciseID)
		_, _ = su.Exec(ctx, `DELETE FROM classes WHERE id=$1`, classID)
		_, _ = su.Exec(ctx, `DELETE FROM center_members WHERE center_id=$1`, centerID)
		_, _ = su.Exec(ctx, `DELETE FROM audit_logs WHERE center_id=$1`, centerID)
		_, _ = su.Exec(ctx, `DELETE FROM centers WHERE id=$1`, centerID)
		_, _ = su.Exec(ctx, `DELETE FROM users WHERE id IN ($1,$2)`, teacherID, studentID)
	})

	svc := service.NewSubmissionService(pool, service.NewAuditService(pool), clock.RealClock{})
	tc := model.TenantContext{CenterID: centerID.String(), UserID: studentID.String(), Role: model.RoleStudent, EmailVerified: true}

	// Barrier: both goroutines fire Start as simultaneously as possible.
	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make([]service.SubmissionResult, 2)
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			results[idx], errs[idx] = svc.Start(ctx, tc, assignmentID)
		}(i)
	}
	close(start)
	wg.Wait()

	// Neither call may hard-error (one creates, one resumes).
	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d Start errored: %v", i, err)
		}
	}
	// Exactly one 201 (Created), one 200 (resume).
	createdCount := 0
	for _, r := range results {
		if r.Created {
			createdCount++
		}
	}
	if createdCount != 1 {
		t.Errorf("AC7 VIOLATION: %d of 2 concurrent starts created a row, want exactly 1", createdCount)
	}
	// Exactly one submissions row survives (prove the UNIQUE fired, not two rows).
	var rows int
	if err := su.QueryRow(ctx, `SELECT COUNT(*) FROM submissions WHERE assignment_id=$1 AND student_id=$2`, assignmentID, studentID).Scan(&rows); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if rows != 1 {
		t.Errorf("AC7 VIOLATION: %d submission rows after a concurrent double-start, want exactly 1", rows)
	}
	// Both callers converge on the same row id.
	if uuid.UUID(results[0].Row.ID.Bytes) != uuid.UUID(results[1].Row.ID.Bytes) {
		t.Error("AC7 VIOLATION: the two starts returned different submission rows")
	}
}

func mustExec(t *testing.T, pool *pgxpool.Pool, ctx context.Context, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("seed exec failed: %v\nSQL: %s", err, sql)
	}
}

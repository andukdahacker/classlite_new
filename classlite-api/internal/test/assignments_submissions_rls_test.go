// Story 5.1 (AC18,20) — RLS + integrity adversarial grid for assignments +
// submissions. Risk 8, WF-8: Murat's house rule — for EVERY 0-rows assertion
// write the re-read control (0 rows alone is not proof the write was blocked).
// Cloned from enrollments_rls_test.go. Runs under SET LOCAL ROLE classlite_app
// (SetupDB) so FORCE RLS is actually enforced (a superuser bypasses it).
package test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// --- file-local raw seeders (bypass the service; exercise the schema directly) ---

func rlsInsertUserAS(t *testing.T, db *TxDB, email string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	// users is a global table (no RLS) — insert directly.
	if _, err := db.Exec(context.Background(),
		`INSERT INTO users (id, email, full_name, password_hash, email_verified)
		 VALUES ($1, $2, 'RLS User', 'x', true)`, id, email); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return id
}

// rlsSeedGraph seeds, under the CURRENT tenant context, a class + exercise +
// student + active enrollment and returns their ids. Caller sets TenantContext first.
func rlsSeedGraph(t *testing.T, db *TxDB, centerID uuid.UUID) (classID, exerciseID, studentID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	teacherID := rlsInsertUserAS(t, db, "teacher-"+uuid.NewString()+"@example.com")
	studentID = rlsInsertUserAS(t, db, "student-"+uuid.NewString()+"@example.com")
	classID = uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO classes (id, center_id, name, status, teacher_id)
		 VALUES ($1, $2, 'RLS Class', 'active', $3)`, classID, centerID, teacherID); err != nil {
		t.Fatalf("insert class: %v", err)
	}
	exerciseID = uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1, $2, $3, $4, 'RLS Ex', 'reading', '{"sections":[]}', 1)`,
		exerciseID, centerID, teacherID, "EX-RLS-"+exerciseID.String()[:8]); err != nil {
		t.Fatalf("insert exercise: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status)
		 VALUES ($1, $2, $3, $4, 'active')`, uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("insert enrollment: %v", err)
	}
	return classID, exerciseID, studentID
}

func rlsInsertAssignment(t *testing.T, db *TxDB, centerID, exerciseID, classID, createdBy uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, late_penalty)
		 VALUES ($1, $2, $3, $4, $5, 'open', now() + interval '7 days', 1.5)`,
		id, centerID, exerciseID, classID, createdBy); err != nil {
		t.Fatalf("insert assignment: %v", err)
	}
	return id
}

func rlsInsertSubmission(t *testing.T, db *TxDB, centerID, assignmentID, studentID uuid.UUID, status string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version)
		 VALUES ($1, $2, $3, $4, $5, '{"answer":"b"}', 1)`,
		id, centerID, assignmentID, studentID, status); err != nil {
		t.Fatalf("insert submission: %v", err)
	}
	return id
}

// seedTenantBGraph seeds a full assignment+submission under tenant B and returns
// the ids. TenantContext is left set to B on return.
func seedTenantBGraph(t *testing.T, db *TxDB, centerB uuid.UUID) (assignmentID, submissionID, exerciseID, classID, teacherID, studentID uuid.UUID) {
	TenantContext(t, db, pgUUIDFromGo(centerB))
	classID, exerciseID, studentID = rlsSeedGraph(t, db, centerB)
	// createdBy = the class's teacher; re-read it for the assignment createdBy.
	var teacher uuid.UUID
	if err := db.QueryRow(context.Background(), `SELECT teacher_id FROM classes WHERE id=$1`, classID).Scan(&teacher); err != nil {
		t.Fatalf("read teacher: %v", err)
	}
	teacherID = teacher
	assignmentID = rlsInsertAssignment(t, db, centerB, exerciseID, classID, teacherID)
	submissionID = rlsInsertSubmission(t, db, centerB, assignmentID, studentID, "submitted")
	return
}

func pgUUIDFromGo(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

// --- assignments: 4-policy grid ---

func TestRLS_Assignments_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	seedTenantBGraph(t, db, uuid.UUID(centerB.ID.Bytes))

	TenantContext(t, db, centerA.ID)
	var count int
	if err := db.QueryRow(context.Background(), `SELECT COUNT(*) FROM assignments`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: tenant A sees %d assignments from tenant B, expected 0", count)
	}
}

func TestRLS_Assignments_CrossTenantInsertRejected(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	_, _, exerciseID, classID, teacherID, _ := seedTenantBGraph(t, db, uuid.UUID(centerB.ID.Bytes))

	// As tenant A, try to INSERT an assignments row carrying tenant B's center_id.
	TenantContext(t, db, centerA.ID)
	_, err := db.Exec(context.Background(),
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, late_penalty)
		 VALUES ($1, $2, $3, $4, $5, 'open', now() + interval '7 days', 0)`,
		uuid.New(), uuid.UUID(centerB.ID.Bytes), exerciseID, classID, teacherID)
	AssertRLSViolation(t, err, "tenant A INSERT spoofing tenant B center_id on assignments")
}

func TestRLS_Assignments_CrossTenantWrite_WithReReadControl(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	assignmentID, _, _, _, _, _ := seedTenantBGraph(t, db, uuid.UUID(centerB.ID.Bytes))

	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(context.Background(), `UPDATE assignments SET status='closed' WHERE id=$1`, assignmentID)
	if err != nil {
		t.Fatalf("UPDATE errored (expected silent 0-rows): %v", err)
	}
	if n := tag.RowsAffected(); n != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d tenant-B assignment rows, expected 0", n)
	}
	// Re-read control (0 rows alone is not proof — Murat #1).
	TenantContext(t, db, centerB.ID)
	var status string
	if err := db.QueryRow(context.Background(), `SELECT status FROM assignments WHERE id=$1`, assignmentID).Scan(&status); err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if status != "open" {
		t.Errorf("RLS VIOLATION: tenant B assignment status changed to %q by tenant A", status)
	}
}

func TestRLS_Assignments_CrossTenantDelete_WithSurvivesControl(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	assignmentID, _, _, _, _, _ := seedTenantBGraph(t, db, uuid.UUID(centerB.ID.Bytes))

	// A submission FK-references the assignment (RESTRICT), so delete the
	// submission first as tenant B to isolate the RLS delete test on assignments.
	TenantContext(t, db, centerB.ID)
	if _, err := db.Exec(context.Background(), `DELETE FROM submissions WHERE assignment_id=$1`, assignmentID); err != nil {
		t.Fatalf("cleanup submissions: %v", err)
	}

	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(context.Background(), `DELETE FROM assignments WHERE id=$1`, assignmentID)
	if err != nil {
		t.Fatalf("DELETE errored (expected silent 0-rows): %v", err)
	}
	if n := tag.RowsAffected(); n != 0 {
		t.Errorf("RLS VIOLATION: tenant A DELETE removed %d tenant-B assignment rows, expected 0", n)
	}
	TenantContext(t, db, centerB.ID)
	var survives int
	if err := db.QueryRow(context.Background(), `SELECT COUNT(*) FROM assignments WHERE id=$1`, assignmentID).Scan(&survives); err != nil {
		t.Fatalf("survives re-read: %v", err)
	}
	if survives != 1 {
		t.Errorf("RLS VIOLATION: tenant B assignment was deleted by tenant A (survives=%d)", survives)
	}
}

func TestRLS_Assignments_ReparentToOtherTenant_BlockedBothDirections(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	assignmentID, _, _, _, _, _ := seedTenantBGraph(t, db, uuid.UUID(centerB.ID.Bytes))

	// As tenant B, try to reparent our own row TO tenant A → WITH CHECK blocks it.
	TenantContext(t, db, centerB.ID)
	if _, err := db.Exec(context.Background(), `SAVEPOINT sp_reparent`); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	tag, err := db.Exec(context.Background(), `UPDATE assignments SET center_id=$1 WHERE id=$2`, centerA.ID, assignmentID)
	if err == nil && tag.RowsAffected() > 0 {
		t.Errorf("RLS VIOLATION: reparent B→A succeeded (%d rows)", tag.RowsAffected())
	}
	if _, rbErr := db.Exec(context.Background(), `ROLLBACK TO SAVEPOINT sp_reparent`); rbErr != nil {
		t.Fatalf("rollback savepoint: %v", rbErr)
	}
	// Re-read: unchanged.
	var owner uuid.UUID
	if err := db.QueryRow(context.Background(), `SELECT center_id FROM assignments WHERE id=$1`, assignmentID).Scan(&owner); err != nil {
		t.Fatalf("re-read center: %v", err)
	}
	if owner != uuid.UUID(centerB.ID.Bytes) {
		t.Errorf("RLS VIOLATION: assignment center_id moved to %s", owner)
	}
}

// --- submissions: the security-critical writes ---

func TestRLS_Submissions_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	seedTenantBGraph(t, db, uuid.UUID(centerB.ID.Bytes))

	TenantContext(t, db, centerA.ID)
	var count int
	if err := db.QueryRow(context.Background(), `SELECT COUNT(*) FROM submissions`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: tenant A sees %d submissions from tenant B, expected 0", count)
	}
}

func TestRLS_Submissions_CrossTenantWrite_ContentAndPenaltyReReadControl(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	_, submissionID, _, _, _, _ := seedTenantBGraph(t, db, uuid.UUID(centerB.ID.Bytes))

	TenantContext(t, db, centerA.ID)
	// Attempt to tamper content + applied_penalty across the tenant boundary.
	tag, err := db.Exec(context.Background(),
		`UPDATE submissions SET content='{"hacked":true}', applied_penalty=9.9, status='graded' WHERE id=$1`, submissionID)
	if err != nil {
		t.Fatalf("UPDATE errored (expected silent 0-rows): %v", err)
	}
	if n := tag.RowsAffected(); n != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d tenant-B submission rows, expected 0", n)
	}
	// Re-read as tenant B — byte-for-byte unchanged (content + penalty + status).
	TenantContext(t, db, centerB.ID)
	var content string
	var penalty float64
	var status string
	if err := db.QueryRow(context.Background(),
		`SELECT content::text, applied_penalty, status FROM submissions WHERE id=$1`, submissionID).Scan(&content, &penalty, &status); err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if content == `{"hacked":true}` || penalty == 9.9 || status == "graded" {
		t.Errorf("RLS VIOLATION: tenant B submission tampered (content=%q penalty=%v status=%q)", content, penalty, status)
	}
}

func TestRLS_Submissions_CrossTenantInsertRejected(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	assignmentID, _, _, _, _, studentID := seedTenantBGraph(t, db, uuid.UUID(centerB.ID.Bytes))

	TenantContext(t, db, centerA.ID)
	_, err := db.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version)
		 VALUES ($1, $2, $3, $4, 'in_progress', '{}', 1)`,
		uuid.New(), uuid.UUID(centerB.ID.Bytes), assignmentID, studentID)
	AssertRLSViolation(t, err, "tenant A INSERT spoofing tenant B center_id on submissions")
}

// --- integrity: FK RESTRICT + UNIQUE ---

func TestAssignmentDelete_WithSubmissions_Restricted(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	assignmentID, _, _, _, _, _ := seedTenantBGraph(t, db, uuid.UUID(center.ID.Bytes))

	// A submission exists; deleting the assignment must be RESTRICTed (D-fold #20).
	TenantContext(t, db, center.ID)
	_, err := db.Exec(context.Background(), `DELETE FROM assignments WHERE id=$1`, assignmentID)
	if err == nil {
		t.Fatal("expected FK RESTRICT to block deleting an assignment with submissions")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23503" {
		t.Fatalf("expected 23503 foreign_key_violation, got %v", err)
	}
}

func TestSubmissions_UniqueAssignmentStudent(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	assignmentID, _, _, _, _, studentID := seedTenantBGraph(t, db, uuid.UUID(center.ID.Bytes))

	// A submission already exists for (assignment, student) from the seed. A second
	// insert for the same pair must violate uq_submissions_assignment_student.
	TenantContext(t, db, center.ID)
	_, err := db.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version)
		 VALUES ($1, $2, $3, $4, 'in_progress', '{}', 1)`,
		uuid.New(), center.ID, assignmentID, studentID)
	if err == nil {
		t.Fatal("expected UNIQUE(assignment_id, student_id) to block a duplicate submission")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("expected 23505 unique_violation, got %v", err)
	}
}

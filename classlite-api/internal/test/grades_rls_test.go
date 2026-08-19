// Story 6.1 (AC1/AC2) — RLS + append-only adversarial grid for the grades ledger.
// Runs under SET LOCAL ROLE classlite_app (SetupDB) so FORCE RLS + the REVOKE
// privilege clamp are actually enforced (a superuser bypasses both). Mirrors
// audit_logs_rls_test.go (the append-only template) + the Murat re-read control.
package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// rlsInsertGradeAS inserts a released grade row under the CURRENT tenant context.
func rlsInsertGradeAS(t *testing.T, db *TxDB, centerID, submissionID, gradedBy uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO grades (id, submission_id, center_id, graded_by, version,
		   criterion_scores, overall_band, comments, feedback, released_at)
		 VALUES ($1, $2, $3, $4, 1,
		   '{"taskResponse":6,"coherenceCohesion":6,"lexicalResource":6,"grammaticalRange":6}'::jsonb,
		   6.0, '[]'::jsonb, NULL, now())`,
		id, submissionID, centerID, gradedBy); err != nil {
		t.Fatalf("insert grade: %v", err)
	}
	return id
}

// seedGradedTenantB seeds a graded submission + grade under tenant B, returning the
// ids. TenantContext is left set to B.
func seedGradedTenantB(t *testing.T, db *TxDB, centerB uuid.UUID) (submissionID, gradeID, gradedBy uuid.UUID) {
	_, submissionID, _, _, teacherID, _ := seedTenantBGraph(t, db, centerB)
	gradeID = rlsInsertGradeAS(t, db, centerB, submissionID, teacherID)
	return submissionID, gradeID, teacherID
}

func TestRLS_Grades_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	seedGradedTenantB(t, db, uuid.UUID(centerB.ID.Bytes))

	TenantContext(t, db, centerA.ID)
	var count int
	if err := db.QueryRow(context.Background(), `SELECT COUNT(*) FROM grades`).Scan(&count); err != nil {
		t.Fatalf("count grades: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: tenant A sees %d grades from tenant B, expected 0", count)
	}
	// The current_grades view (security_invoker) must NOT leak either.
	if err := db.QueryRow(context.Background(), `SELECT COUNT(*) FROM current_grades`).Scan(&count); err != nil {
		t.Fatalf("count current_grades: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION via view: tenant A sees %d current_grades from tenant B, expected 0 (security_invoker missing?)", count)
	}
}

func TestRLS_Grades_CrossTenantInsertRejected(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	submissionID, _, gradedBy := seedGradedTenantB(t, db, uuid.UUID(centerB.ID.Bytes))

	// As tenant A, INSERT a grades row carrying tenant B's center_id — the WITH CHECK
	// policy must reject it.
	TenantContext(t, db, centerA.ID)
	_, err := db.Exec(context.Background(),
		`INSERT INTO grades (id, submission_id, center_id, graded_by, version,
		   criterion_scores, overall_band, comments, released_at)
		 VALUES ($1, $2, $3, $4, 2,
		   '{"taskResponse":6,"coherenceCohesion":6,"lexicalResource":6,"grammaticalRange":6}'::jsonb,
		   6.0, '[]'::jsonb, now())`,
		uuid.New(), submissionID, uuid.UUID(centerB.ID.Bytes), gradedBy)
	AssertRLSViolation(t, err, "tenant A INSERT spoofing tenant B center_id on grades")
}

func TestRLS_Grades_NullTenant_FailClosed(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	_, submissionID, _, _, teacherID, _ := seedTenantBGraph(t, db, uuid.UUID(centerA.ID.Bytes))
	rlsInsertGradeAS(t, db, uuid.UUID(centerA.ID.Bytes), submissionID, teacherID)

	// Clear the tenant GUC → NULLIF(...,'')::uuid IS NULL → predicate NULL → 0 rows.
	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(context.Background(), `SELECT COUNT(*) FROM grades`).Scan(&count); err != nil {
		t.Fatalf("count grades: %v", err)
	}
	if count != 0 {
		t.Errorf("FAIL-OPEN: null tenant sees %d grades, expected 0 (fail-closed)", count)
	}
}

func TestRLS_Grades_UpdateAndDeleteRejected(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	_, submissionID, _, _, teacherID, _ := seedTenantBGraph(t, db, uuid.UUID(centerA.ID.Bytes))
	gradeID := rlsInsertGradeAS(t, db, uuid.UUID(centerA.ID.Bytes), submissionID, teacherID)

	// Append-only: even the owning tenant cannot UPDATE or DELETE (REVOKE at the
	// privilege layer — permission denied). Each failing statement poisons the tx,
	// so wrap in savepoints to keep the second assertion meaningful.
	ctx := context.Background()
	mustSavepoint(t, db, "grade_upd")
	if _, err := db.Exec(ctx, `UPDATE grades SET overall_band = 9.0 WHERE id = $1`, gradeID); err == nil {
		t.Error("APPEND-ONLY VIOLATION: UPDATE on grades should be rejected at the privilege layer")
	}
	rollbackToSavepoint(t, db, "grade_upd")

	mustSavepoint(t, db, "grade_del")
	if _, err := db.Exec(ctx, `DELETE FROM grades WHERE id = $1`, gradeID); err == nil {
		t.Error("APPEND-ONLY VIOLATION: DELETE on grades should be rejected at the privilege layer")
	}
	rollbackToSavepoint(t, db, "grade_del")
}

func mustSavepoint(t *testing.T, db *TxDB, name string) {
	t.Helper()
	if _, err := db.Exec(context.Background(), "SAVEPOINT "+name); err != nil {
		t.Fatalf("savepoint %s: %v", name, err)
	}
}

func rollbackToSavepoint(t *testing.T, db *TxDB, name string) {
	t.Helper()
	if _, err := db.Exec(context.Background(), "ROLLBACK TO SAVEPOINT "+name); err != nil {
		t.Fatalf("rollback to savepoint %s: %v", name, err)
	}
}

func TestRLS_Grades_DeleteOfGradedSubmission_Restricted(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	_, submissionID, _, _, teacherID, _ := seedTenantBGraph(t, db, uuid.UUID(centerA.ID.Bytes))
	rlsInsertGradeAS(t, db, uuid.UUID(centerA.ID.Bytes), submissionID, teacherID)

	// The grades FK is ON DELETE RESTRICT — a submission with a grade row cannot be
	// deleted out from under the ledger (Murat B5).
	if _, err := db.Exec(context.Background(),
		`DELETE FROM submissions WHERE id = $1`, submissionID); err == nil {
		t.Error("FK VIOLATION: deleting a graded submission should be RESTRICTed by the grades FK")
	}
}

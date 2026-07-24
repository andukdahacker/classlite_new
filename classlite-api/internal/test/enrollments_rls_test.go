// Story 3.4.5 — RLS adversarial grid for the NEW `enrollments` table + the
// partial-unique active guard + FK behaviors (AC4, AC5, TEST-BE-1).
//
// `enrollments` is center-scoped, no dual-scope, no trigger — the standard
// 4-policy grid mirroring `classes`/`sessions` (sessions_rls_test.go is the
// reference). The migration `20260722120000_create_enrollments` MUST enforce:
//
//	enrollments_select FOR SELECT USING (center_id = tenant)
//	enrollments_insert FOR INSERT WITH CHECK (center_id = tenant)
//	enrollments_update FOR UPDATE USING (...) WITH CHECK (...)
//	enrollments_delete FOR DELETE USING (center_id = tenant)
//
// plus uq_enrollments_active (class_id, student_id) WHERE status='active'.
package test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

// insertUserRaw inserts a users row (users has no RLS) and returns its id.
func insertUserRaw(t *testing.T, db *TxDB, email, fullName string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.Exec(context.Background(),
		`INSERT INTO users (id, email, full_name) VALUES ($1, $2, $3)`,
		id, email, fullName,
	)
	if err != nil {
		t.Fatalf("insert user row: %v", err)
	}
	return id
}

// insertEnrollmentRaw inserts an enrollments row via raw SQL with the given
// status. Tenant context must be set by the caller. Returns the row id.
func insertEnrollmentRaw(t *testing.T, db *TxDB, centerID, studentID, classID uuid.UUID, status string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status)
		 VALUES ($1, $2, $3, $4, $5)`,
		id, centerID, studentID, classID, status,
	)
	if err != nil {
		t.Fatalf("insert enrollments row: %v", err)
	}
	return id
}

// seedEnrollmentDeps creates the (class, student) a well-formed enrollment needs
// in the current tenant. Tenant context must be set by the caller.
func seedEnrollmentDeps(t *testing.T, db *TxDB, centerID uuid.UUID) (classID, studentID uuid.UUID) {
	t.Helper()
	classID = insertClassRaw(t, db, centerID, "Enrollment Parent Class")
	studentID = insertUserRaw(t, db, "student-"+uuid.NewString()[:8]+"@example.com", "Student S")
	return classID, studentID
}

// -----------------------------------------------------------------------------
// Pattern 1 — CrossTenantRead
// -----------------------------------------------------------------------------
func TestRLS_Enrollment_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	classB, studentB := seedEnrollmentDeps(t, db, centerBUUID)
	insertEnrollmentRaw(t, db, centerBUUID, studentB, classB, "active")

	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM enrollments WHERE center_id = $1", centerB.ID,
	).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B enrollments rows, expected 0", visible)
	}
}

// -----------------------------------------------------------------------------
// Pattern 2 — CrossTenantInsert (WITH CHECK rejects center_id spoof)
// -----------------------------------------------------------------------------
func TestRLS_Enrollment_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Parent class + student must exist in B for the FKs; seed as B.
	TenantContext(t, db, centerB.ID)
	classB, studentB := seedEnrollmentDeps(t, db, uuid.UUID(centerB.ID.Bytes))

	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status)
		 VALUES ($1, $2, $3, $4, 'active')`,
		id, centerB.ID, studentB, classB,
	)
	AssertRLSViolation(t, err, "enrollments cross-tenant INSERT")
}

// -----------------------------------------------------------------------------
// Pattern 3 — CrossTenantWrite (silent 0-rows, target unchanged)
// -----------------------------------------------------------------------------
func TestRLS_Enrollment_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	classB, studentB := seedEnrollmentDeps(t, db, centerBUUID)
	originalID := insertEnrollmentRaw(t, db, centerBUUID, studentB, classB, "active")

	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx, `UPDATE enrollments SET status = 'withdrawn' WHERE id = $1`, originalID)
	if err != nil {
		t.Fatalf("UPDATE returned error (expected silent 0-rows): %v", err)
	}
	if rows := tag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d enrollments rows on tenant B, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var status string
	if err := db.QueryRow(ctx, `SELECT status FROM enrollments WHERE id = $1`, originalID).Scan(&status); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if status != "active" {
		t.Errorf("RLS VIOLATION: tenant A UPDATE against tenant B enrollments row succeeded (status=%q)", status)
	}
}

// -----------------------------------------------------------------------------
// Pattern 4 — CrossTenantDelete (silent 0-rows, target survives)
// -----------------------------------------------------------------------------
func TestRLS_Enrollment_CrossTenantDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	classB, studentB := seedEnrollmentDeps(t, db, centerBUUID)
	targetID := insertEnrollmentRaw(t, db, centerBUUID, studentB, classB, "active")

	TenantContext(t, db, centerA.ID)
	delTag, err := db.Exec(ctx, `DELETE FROM enrollments WHERE id = $1`, targetID)
	if err != nil {
		t.Fatalf("DELETE returned error (expected silent 0-rows): %v", err)
	}
	if rows := delTag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A DELETE affected %d enrollments rows on tenant B, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var stillExists int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM enrollments WHERE id = $1", targetID).Scan(&stillExists); err != nil {
		t.Fatalf("count target row as tenant B: %v", err)
	}
	if stillExists != 1 {
		t.Errorf("RLS VIOLATION: cross-tenant DELETE succeeded — tenant B enrollments row is gone")
	}
}

// -----------------------------------------------------------------------------
// Pattern 5 — NullTenant
// -----------------------------------------------------------------------------
func TestRLS_Enrollment_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)
	insertEnrollmentRaw(t, db, centerUUID, student, class, "active")

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM enrollments WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d enrollments rows, expected 0", count)
	}
}

// -----------------------------------------------------------------------------
// Pattern 6 — UnsetTenant
// -----------------------------------------------------------------------------
func TestRLS_Enrollment_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)
	insertEnrollmentRaw(t, db, centerUUID, student, class, "active")

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM enrollments WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d enrollments rows, expected 0", count)
	}
}

// -----------------------------------------------------------------------------
// WITH CHECK on UPDATE (tenant cannot reparent own enrollment to another center).
// Dropping WITH CHECK would pass every other RLS test silently.
// -----------------------------------------------------------------------------
func TestRLS_Enrollment_TenantCannotReparentOwnRow(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	centerAUUID := uuid.UUID(centerA.ID.Bytes)
	classA, studentA := seedEnrollmentDeps(t, db, centerAUUID)
	rowID := insertEnrollmentRaw(t, db, centerAUUID, studentA, classA, "active")

	if _, err := db.Exec(ctx, "SAVEPOINT sp_enr_reparent"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	_, updateErr := db.Exec(ctx, `UPDATE enrollments SET center_id = $1 WHERE id = $2`, centerB.ID, rowID)
	if updateErr != nil {
		if _, rbErr := db.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_enr_reparent"); rbErr != nil {
			t.Fatalf("rollback savepoint: %v", rbErr)
		}
	} else {
		if _, relErr := db.Exec(ctx, "RELEASE SAVEPOINT sp_enr_reparent"); relErr != nil {
			t.Fatalf("release savepoint: %v", relErr)
		}
	}
	var storedCenter uuid.UUID
	if scanErr := db.QueryRow(ctx, `SELECT center_id FROM enrollments WHERE id = $1`, rowID).Scan(&storedCenter); scanErr != nil {
		t.Fatalf("re-read after UPDATE (err=%v): %v", updateErr, scanErr)
	}
	if storedCenter != centerAUUID {
		t.Errorf("RLS VIOLATION: tenant A reparented own enrollment row to tenant B (stored=%v, expected=%v)", storedCenter, centerAUUID)
	}
}

// -----------------------------------------------------------------------------
// AC4 — partial-unique active guard: a second ACTIVE enrollment for the same
// (class, student) is rejected; a historical withdrawn row may coexist.
// -----------------------------------------------------------------------------
func TestEnrollments_DoubleActiveRejected(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)
	insertEnrollmentRaw(t, db, centerUUID, student, class, "active")

	if _, err := db.Exec(ctx, "SAVEPOINT sp_dup_active"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status)
		 VALUES ($1, $2, $3, $4, 'active')`,
		id, centerUUID, student, class,
	)
	if err == nil {
		t.Error("UNIQUE VIOLATION expected: a second ACTIVE enrollment for the same (class, student) must be rejected by uq_enrollments_active")
	}
	if _, rbErr := db.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_dup_active"); rbErr != nil {
		t.Fatalf("rollback savepoint: %v", rbErr)
	}
}

// AC4 (belt-and-suspenders) — the duplicate ACTIVE insert must fail with SQLSTATE
// 23505 (unique_violation) specifically. This is the exact code the service belt
// (EnrollmentService.CreateEnrollment) matches on `pgUniqueViolationCode` to map a
// concurrent double-enroll to 409 ALREADY_ENROLLED instead of leaking a 500. If
// the constraint ever raised a different SQLSTATE, the belt would silently break.
func TestEnrollments_DoubleActive_SQLSTATE23505(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)
	insertEnrollmentRaw(t, db, centerUUID, student, class, "active")

	if _, err := db.Exec(ctx, "SAVEPOINT sp_dup_sqlstate"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	_, err := db.Exec(ctx,
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status)
		 VALUES ($1, $2, $3, $4, 'active')`,
		uuid.New(), centerUUID, student, class,
	)
	if _, rbErr := db.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_dup_sqlstate"); rbErr != nil {
		t.Fatalf("rollback savepoint: %v", rbErr)
	}

	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected *pgconn.PgError from duplicate active insert, got %T: %v", err, err)
	}
	if pgErr.Code != "23505" {
		t.Errorf("duplicate active enrollment SQLSTATE = %q, want 23505 (the code the service belt maps to 409 ALREADY_ENROLLED)", pgErr.Code)
	}
}

func TestEnrollments_WithdrawnCoexistsWithActive(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)
	// A withdrawn history row + a fresh active row for the same pair must coexist
	// (so a future 7.3 re-enrollment after withdrawal is possible).
	insertEnrollmentRaw(t, db, centerUUID, student, class, "withdrawn")
	insertEnrollmentRaw(t, db, centerUUID, student, class, "active")

	var total int
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM enrollments WHERE class_id = $1 AND student_id = $2`, class, student,
	).Scan(&total); err != nil {
		t.Fatalf("count enrollments: %v", err)
	}
	if total != 2 {
		t.Errorf("expected withdrawn + active to coexist (2 rows), got %d", total)
	}
}

// -----------------------------------------------------------------------------
// class_id ON DELETE CASCADE (AC1) — deleting a class takes its enrollments.
// -----------------------------------------------------------------------------
func TestEnrollments_ClassDeleteCascades(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)
	enrollID := insertEnrollmentRaw(t, db, centerUUID, student, class, "active")

	if _, err := db.Exec(ctx, `DELETE FROM classes WHERE id = $1`, class); err != nil {
		t.Fatalf("delete class (expected CASCADE, not RESTRICT): %v", err)
	}
	var stillExists int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM enrollments WHERE id = $1`, enrollID).Scan(&stillExists); err != nil {
		t.Fatalf("count enrollment after class delete: %v", err)
	}
	if stillExists != 0 {
		t.Errorf("AC1 CASCADE VIOLATION: enrollment survived its class deletion (want 0 rows, got %d)", stillExists)
	}
}

// -----------------------------------------------------------------------------
// student_id NO ACTION (AC1) — a user with enrollments cannot be hard-deleted
// (preserve enrollment history; matches classes.teacher_id precedent).
// -----------------------------------------------------------------------------
func TestEnrollments_StudentDeleteRestricted(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)
	insertEnrollmentRaw(t, db, centerUUID, student, class, "active")

	_, err := db.Exec(ctx, `DELETE FROM users WHERE id = $1`, student)
	if err == nil {
		t.Error("FK VIOLATION expected: deleting a user WITH enrollments must be blocked (student_id has no ON DELETE CASCADE — preserve history)")
	}
}

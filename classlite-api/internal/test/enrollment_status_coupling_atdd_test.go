// Story 7.3a (AC9 · CR-3-4-5-1 · risk=7) — the status↔withdrawn_at coupling CHECK
// that Story 3.4.5 shipped WITHOUT (its enrollments table only ever wrote
// status='active' with withdrawn_at NULL, so the gap was unreachable there —
// deferred to 7.3 which introduces the withdraw/transfer transitions that make a
// terminal status possible). Without this CHECK, 7.3's transitions inherit no
// DB-level guard tying a terminal status to its timestamp — a `withdrawn` row
// with NULL withdrawn_at (or an `active` row with a stray timestamp) would be a
// silent data-integrity hole in the audit spine.
//
// De-tagged at green (7-3a shipped add_enrollments_status_withdrawn_at_check, a NEW
// pair — never edit 20260722120000, WF-2); now part of the permanent suite.
//
// GREEN SEAMS (Task 1 migration):
//
//	ALTER TABLE enrollments ADD CONSTRAINT enrollments_status_withdrawal_coupled
//	  CHECK ( (status = 'active'  AND withdrawn_at IS NULL)
//	       OR (status IN ('withdrawn','transferred') AND withdrawn_at IS NOT NULL) );
//	-- existing rows (all active, withdrawn_at NULL) satisfy it; safe to add NOT VALID→VALIDATE or plain.
package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// attemptEnrollmentInsert inserts an enrollments row with an explicit status +
// withdrawn_at inside a savepoint so a rejection (or a wrongly-accepted row) never
// pollutes sibling assertions. Returns the insert error (nil = accepted).
func attemptEnrollmentInsert(t *testing.T, db *TxDB, centerID, studentID, classID uuid.UUID, status string, withdrawnAtSQL string) error {
	t.Helper()
	ctx := context.Background()
	sp := "sp_coupling_" + uuid.NewString()[:8]
	if _, err := db.Exec(ctx, "SAVEPOINT "+sp); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	_, insErr := db.Exec(ctx,
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status, withdrawn_at)
		 VALUES ($1, $2, $3, $4, $5, `+withdrawnAtSQL+`)`,
		uuid.New(), centerID, studentID, classID, status,
	)
	if _, err := db.Exec(ctx, "ROLLBACK TO SAVEPOINT "+sp); err != nil {
		t.Fatalf("rollback savepoint: %v", err)
	}
	return insErr
}

// AC9 — a terminal status without a withdrawal timestamp must be rejected.
func TestEnrollments_StatusCoupling_WithdrawnRequiresTimestamp(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)

	if err := attemptEnrollmentInsert(t, db, centerUUID, student, class, "withdrawn", "NULL"); err == nil {
		t.Error("COUPLING VIOLATION (CR-3-4-5-1): status='withdrawn' with withdrawn_at IS NULL must be rejected by the coupling CHECK")
	}
}

// AC9 — an active status carrying a withdrawal timestamp must be rejected.
func TestEnrollments_StatusCoupling_ActiveForbidsTimestamp(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)

	if err := attemptEnrollmentInsert(t, db, centerUUID, student, class, "active", "now()"); err == nil {
		t.Error("COUPLING VIOLATION (CR-3-4-5-1): status='active' with a non-null withdrawn_at must be rejected by the coupling CHECK")
	}
}

// AC9 — the valid combinations must still be accepted (guard against an
// over-tight CHECK). active+NULL, withdrawn+ts, transferred+ts.
func TestEnrollments_StatusCoupling_ValidCombosAccepted(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)

	if err := attemptEnrollmentInsert(t, db, centerUUID, student, class, "active", "NULL"); err != nil {
		t.Errorf("valid combo active+NULL was rejected: %v", err)
	}
	if err := attemptEnrollmentInsert(t, db, centerUUID, student, class, "withdrawn", "now()"); err != nil {
		t.Errorf("valid combo withdrawn+timestamp was rejected: %v", err)
	}
	if err := attemptEnrollmentInsert(t, db, centerUUID, student, class, "transferred", "now()"); err != nil {
		t.Errorf("valid combo transferred+timestamp was rejected: %v", err)
	}
}

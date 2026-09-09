// Story 7.3a (AC5/AC6/AC8/AC11 · R17 · risk=7 · WF-8 HARD GATE) — the NET-NEW
// immutable `enrollment_history` audit table. This is the R17 risk driver: an
// enrollment audit trail is worthless if it can be edited or wiped, so
// immutability is enforced at the PRIVILEGE layer (REVOKE UPDATE/DELETE/TRUNCATE
// from PUBLIC + classlite_app), NOT a trigger and NOT merely an RLS row-scope.
// Real DB in tx under FORCE RLS. This file is the exact analog of
// audit_logs_rls_test.go (Story 1.3b) — the idiom 7.3a must clone verbatim.
//
// Two distinct failure shapes are asserted, and they are NOT interchangeable:
//   - append-only mutations (UPDATE/DELETE/TRUNCATE) fail with a HARD privilege
//     error (err != nil, SQLSTATE 42501) — a REVOKE fires before RLS runs;
//   - cross-tenant reads/inserts fail the RLS way (0 rows / WITH CHECK reject).
//
// A test that asserted silent 0-rows for the mutations would GREEN a table that
// merely lacks an UPDATE policy while classlite_app still holds UPDATE — the
// REVOKE is what makes it truly append-only, so we assert the hard error.
//
// De-tagged at green (7-3a shipped the create_enrollment_history migration + the
// ListEnrollmentHistoryPaged store seam); now part of the permanent suite.
//
// GREEN SEAMS (Task 1 migration + Task 2 queries/enrollment_history.sql):
//
//	Migration create_enrollment_history:
//	  enrollment_history(id, center_id, student_id, action('add'|'transfer'|'withdraw'),
//	    from_class_id nullable, to_class_id nullable, effective_date date, note nullable,
//	    performed_by nullable, performed_at timestamptz, created_at timestamptz)
//	  ENABLE + FORCE ROW LEVEL SECURITY;
//	  POLICY enrollment_history_select FOR SELECT USING (center_id = tenant);
//	  POLICY enrollment_history_insert FOR INSERT WITH CHECK (center_id = tenant);
//	  -- NO update/delete policy —
//	  REVOKE UPDATE, DELETE, TRUNCATE ON enrollment_history FROM PUBLIC;
//	  REVOKE UPDATE, DELETE, TRUNCATE ON enrollment_history FROM classlite_app;
//	ListEnrollmentHistoryPaged(ctx, {Limit int32, Offset int32, ...optional StudentID/ClassID nargs})
//	  → []Row  -- newest-first (performed_at DESC, id DESC), RLS center-scoped, denormalized.
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
)

// insertEnrollmentHistoryRaw inserts a well-formed enrollment_history row via raw
// SQL (no sqlc dependency, so the immutability assertions stay robust to the
// generated param shape). Tenant context must be set by the caller. Runtime-red
// until the create_enrollment_history migration lands the table.
func insertEnrollmentHistoryRaw(t *testing.T, db *TxDB, centerID, studentID, toClassID uuid.UUID, action string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.Exec(context.Background(),
		`INSERT INTO enrollment_history
		   (id, center_id, student_id, action, from_class_id, to_class_id,
		    effective_date, note, performed_by, performed_at)
		 VALUES ($1, $2, $3, $4, NULL, $5, CURRENT_DATE, NULL, NULL, now())`,
		id, centerID, studentID, action, toClassID,
	)
	if err != nil {
		t.Fatalf("insert enrollment_history row (greenfield — is the create_enrollment_history migration applied?): %v", err)
	}
	return id
}

// -----------------------------------------------------------------------------
// AC6 — append-only at the privilege layer. Mirrors
// audit_logs_rls_test.go:195-238. Hard error (not silent 0-rows) is required.
// -----------------------------------------------------------------------------

func TestEnrollmentHistory_AppendOnly_UpdateDenied(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)
	row := insertEnrollmentHistoryRaw(t, db, centerUUID, student, class, "add")

	_, err := db.Exec(ctx, "UPDATE enrollment_history SET action = 'transfer' WHERE id = $1", row)
	if err == nil {
		t.Error("APPEND-ONLY VIOLATION (R17): UPDATE on enrollment_history must be rejected at the privilege layer (REVOKE UPDATE FROM classlite_app)")
	}
}

func TestEnrollmentHistory_AppendOnly_DeleteDenied(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)
	row := insertEnrollmentHistoryRaw(t, db, centerUUID, student, class, "add")

	_, err := db.Exec(ctx, "DELETE FROM enrollment_history WHERE id = $1", row)
	if err == nil {
		t.Error("APPEND-ONLY VIOLATION (R17): DELETE on enrollment_history must be rejected at the privilege layer (REVOKE DELETE FROM classlite_app)")
	}
}

func TestEnrollmentHistory_AppendOnly_TruncateDenied(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	// No row needed — TRUNCATE is a table-level privilege.
	_, err := db.Exec(ctx, "TRUNCATE TABLE enrollment_history")
	if err == nil {
		t.Error("APPEND-ONLY VIOLATION (R17): TRUNCATE on enrollment_history must be rejected at the privilege layer (REVOKE TRUNCATE FROM classlite_app)")
	}
}

// -----------------------------------------------------------------------------
// AC8 — cross-tenant isolation on the history table (standard grid).
// -----------------------------------------------------------------------------

func TestRLS_EnrollmentHistory_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	classB, studentB := seedEnrollmentDeps(t, db, centerBUUID)
	insertEnrollmentHistoryRaw(t, db, centerBUUID, studentB, classB, "add")

	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM enrollment_history WHERE center_id = $1", centerB.ID,
	).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B enrollment_history rows, expected 0", visible)
	}
}

func TestRLS_EnrollmentHistory_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Seed the FK parents (class + student) in B.
	TenantContext(t, db, centerB.ID)
	classB, studentB := seedEnrollmentDeps(t, db, uuid.UUID(centerB.ID.Bytes))

	// As tenant A, attempt to write a history row stamped for center B.
	TenantContext(t, db, centerA.ID)
	_, err := db.Exec(ctx,
		`INSERT INTO enrollment_history
		   (id, center_id, student_id, action, from_class_id, to_class_id,
		    effective_date, note, performed_by, performed_at)
		 VALUES ($1, $2, $3, 'add', NULL, $4, CURRENT_DATE, NULL, NULL, now())`,
		uuid.New(), centerB.ID, studentB, classB,
	)
	AssertRLSViolation(t, err, "enrollment_history cross-tenant INSERT")
}

// -----------------------------------------------------------------------------
// AC11 — the paginated history read (compile-red anchor for the store seam).
// Positive control: the inserted row is returned to its own tenant.
// -----------------------------------------------------------------------------

func TestEnrollmentHistory_ListPaged_ReturnsInsertedRow(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class, student := seedEnrollmentDeps(t, db, centerUUID)
	insertEnrollmentHistoryRaw(t, db, centerUUID, student, class, "add")

	rows, err := generated.New(db).ListEnrollmentHistoryPaged(ctx, generated.ListEnrollmentHistoryPagedParams{
		Limit:  50,
		Offset: 0,
	})
	if err != nil {
		t.Fatalf("ListEnrollmentHistoryPaged: %v", err)
	}
	if len(rows) < 1 {
		t.Errorf("AC11: expected the inserted history row in the tenant's paged list, got %d rows", len(rows))
	}
}

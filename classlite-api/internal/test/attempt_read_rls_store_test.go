// Story 5.2a (AC13 / Task 7.6) — store-level RLS guard for the student assignment
// list query. The HTTP handler can never reach an unset tenant (requireCenter
// gates it), so the "null/unset tenant context = 0 rows" assertion lives here,
// exercising generated.ListStudentAssignments/CountStudentAssignments directly
// under SetupDB (SET LOCAL ROLE classlite_app → FORCE RLS enforced). Clones the
// Pattern-5 NullTenant shape from enrollments_rls_test.go and reuses the raw
// seeders from assignments_submissions_rls_test.go.
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
)

func TestListStudentAssignments_NullTenant_ZeroRows(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)

	// Seed a class + exercise + student + active enrollment, then an assignment —
	// all under tenant A's context.
	classID, exerciseID, studentID := rlsSeedGraph(t, db, centerUUID)
	rlsInsertAssignment(t, db, centerUUID, exerciseID, classID, studentID)

	queries := generated.New(db)
	params := generated.ListStudentAssignmentsParams{
		StudentID:  pgUUIDFromGo(studentID),
		PageLimit:  20,
		PageOffset: 0,
	}

	// Control: with tenant A set, the student's assignment is visible (proves the
	// seed + query wiring, so the zero below is RLS suppression, not an empty seed).
	rows, err := queries.ListStudentAssignments(ctx, params)
	if err != nil {
		t.Fatalf("list under tenant A: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("under tenant A: rows = %d, want 1 (seed/query control)", len(rows))
	}

	// Null tenant (SET LOCAL app.current_tenant_id = '') → RLS null-guard → 0 rows,
	// and the sibling count agrees.
	resetTenantContext(t, db)
	rows, err = queries.ListStudentAssignments(ctx, params)
	if err != nil {
		t.Fatalf("list with null tenant: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d student-assignment rows, expected 0", len(rows))
	}
	count, err := queries.CountStudentAssignments(ctx, pgUUIDFromGo(studentID))
	if err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant count = %d, expected 0", count)
	}
}

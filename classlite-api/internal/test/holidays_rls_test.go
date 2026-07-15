// Story 2.5b — R1 discharge (Task 2, AC8 + AC12): RLS matrix for `holidays`.
//
// Two patterns per the story-spec 8-row minimum split (see the header in
// `terms_rls_test.go` for the full grid). Cross-tenant Read + Insert are
// the two most load-bearing patterns for a tenant-scoped read/write
// resource; Update/Delete symmetry is covered by terms + rooms per Task 2.
//
//   Pattern 1  CrossTenantRead   — tenant A cannot SELECT tenant B's rows.
//   Pattern 2  CrossTenantInsert — tenant A INSERT with center_id = tenantB
//                                  rejected by WITH CHECK (SQLSTATE 42501).
//
// Migration: 20260714120200_create_holidays.up.sql (Task 1).
//
// Expected RED against the current codebase: `relation "holidays" does not
// exist`. Amelia flips green by landing Task 1.1 (migration) + Task 2.

package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// insertHolidayRaw inserts a holidays row via raw SQL. Tenant context must
// already be set.
func insertHolidayRaw(t *testing.T, db *TxDB, centerID uuid.UUID, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.Exec(context.Background(),
		`INSERT INTO holidays (id, center_id, name, date)
		 VALUES ($1, $2, $3, DATE '2026-09-02')`,
		id, centerID, name,
	)
	if err != nil {
		t.Fatalf("insert holidays row (%s): %v", name, err)
	}
	return id
}

// -----------------------------------------------------------------------------
// Pattern 1 — CrossTenantRead
// -----------------------------------------------------------------------------
func TestRLS_Holiday_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	insertHolidayRaw(t, db, uuid.UUID(centerB.ID.Bytes), "National Day (B)")

	TenantContext(t, db, centerA.ID)
	var visibleB int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM holidays WHERE center_id = $1",
		centerB.ID,
	).Scan(&visibleB); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visibleB != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B holidays rows, expected 0", visibleB)
	}
}

// -----------------------------------------------------------------------------
// Pattern 2 — CrossTenantInsert (WITH CHECK guard)
// -----------------------------------------------------------------------------
func TestRLS_Holiday_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO holidays (id, center_id, name, date)
		 VALUES ($1, $2, 'hostile', DATE '2026-09-02')`,
		id, centerB.ID,
	)
	AssertRLSViolation(t, err, "holidays cross-tenant INSERT with WITH CHECK forced center_id=tenantB")
}

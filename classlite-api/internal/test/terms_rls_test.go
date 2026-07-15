// Story 2.5b — R1 discharge (Task 2, AC8 + AC12): RLS matrix for `terms`.
//
// Four patterns from the J15 grid, mirrored from Story 2.2's
// `class_templates_rls_test.go`. Terms is single-scope tenant-scoped (no
// system seeds), so patterns 5/6 (NullTenant / UnsetTenant) collapse to
// "zero rows visible" — covered inside CrossTenantRead.
//
//   Pattern 1  CrossTenantRead   — tenant A cannot SELECT tenant B's rows.
//   Pattern 2  CrossTenantInsert — tenant A INSERT with center_id = tenantB
//                                  rejected by WITH CHECK (SQLSTATE 42501).
//   Pattern 3  CrossTenantWrite  — tenant A UPDATE against tenant B's row →
//                                  RowsAffected() == 0 (silent USING drop)
//                                  AND re-read as tenant B shows original.
//   Pattern 4  CrossTenantDelete — tenant A DELETE against tenant B's row →
//                                  RowsAffected() == 0 AND row still exists.
//
// AC12 story-spec compromise pins the minimum matrix at 8 rows across the 3
// new tables. Split: 4 tests here (terms), 2 in holidays_rls_test.go, 4 in
// rooms_rls_test.go (which adds the AC6 UNIQUE(center_id, LOWER(name))
// pre-check). Total = 10 (>= 8 minimum).
//
// Uses raw SQL because sqlc queries land in Task 1 (green-phase). RLS
// policies land in migration 20260714120100_create_terms.up.sql (Task 1).
//
// Expected RED against the current codebase: the migration does NOT exist,
// so every INSERT/SELECT fails with `relation "terms" does not exist`.
// Amelia flips green by landing Task 1.1 (migration) + Task 2 (this file
// green).

package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// insertTermRaw inserts a terms row via raw SQL. Tenant context must
// already be set by the caller.
func insertTermRaw(t *testing.T, db *TxDB, centerID uuid.UUID, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.Exec(context.Background(),
		`INSERT INTO terms (id, center_id, name, start_date, end_date)
		 VALUES ($1, $2, $3, DATE '2026-08-01', DATE '2026-12-15')`,
		id, centerID, name,
	)
	if err != nil {
		t.Fatalf("insert terms row (%s): %v", name, err)
	}
	return id
}

// -----------------------------------------------------------------------------
// Pattern 1 — CrossTenantRead
// -----------------------------------------------------------------------------
func TestRLS_Term_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	insertTermRaw(t, db, uuid.UUID(centerB.ID.Bytes), "Fall 2026 (B)")

	TenantContext(t, db, centerA.ID)
	var visibleB int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM terms WHERE center_id = $1",
		centerB.ID,
	).Scan(&visibleB); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visibleB != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B terms rows, expected 0", visibleB)
	}
}

// -----------------------------------------------------------------------------
// Pattern 2 — CrossTenantInsert (WITH CHECK guard)
// -----------------------------------------------------------------------------
func TestRLS_Term_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO terms (id, center_id, name, start_date, end_date)
		 VALUES ($1, $2, 'hostile', DATE '2026-08-01', DATE '2026-12-15')`,
		id, centerB.ID,
	)
	AssertRLSViolation(t, err, "terms cross-tenant INSERT with WITH CHECK forced center_id=tenantB")
}

// -----------------------------------------------------------------------------
// Pattern 3 — CrossTenantWrite (UPDATE)
// -----------------------------------------------------------------------------
func TestRLS_Term_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	rowID := insertTermRaw(t, db, uuid.UUID(centerB.ID.Bytes), "Original Term")

	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx,
		`UPDATE terms SET name = 'Hacked' WHERE id = $1`, rowID,
	)
	if err != nil {
		t.Fatalf("UPDATE returned error (expected silent 0-rows): %v", err)
	}
	if rows := tag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d rows on tenant B's terms, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var name string
	if err := db.QueryRow(ctx,
		`SELECT name FROM terms WHERE id = $1`, rowID,
	).Scan(&name); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if name != "Original Term" {
		t.Errorf("RLS VIOLATION: tenant A UPDATE against tenant B row succeeded (name=%q)", name)
	}
}

// -----------------------------------------------------------------------------
// Pattern 4 — CrossTenantDelete
// -----------------------------------------------------------------------------
func TestRLS_Term_CrossTenantDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	targetID := insertTermRaw(t, db, uuid.UUID(centerB.ID.Bytes), "Delete Target")

	TenantContext(t, db, centerA.ID)
	delTag, err := db.Exec(ctx, `DELETE FROM terms WHERE id = $1`, targetID)
	if err != nil {
		t.Fatalf("DELETE returned error (expected silent 0-rows): %v", err)
	}
	if rows := delTag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A DELETE affected %d rows on tenant B's terms, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var stillExists int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM terms WHERE id = $1", targetID,
	).Scan(&stillExists); err != nil {
		t.Fatalf("count target row as tenant B: %v", err)
	}
	if stillExists != 1 {
		t.Errorf("RLS VIOLATION: cross-tenant DELETE succeeded — tenant B row is gone")
	}
}

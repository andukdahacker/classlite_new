// Story 2.2 — R1 discharge: J15 6-pattern grid for class_templates.
//
// Six mandatory patterns + 2 named extensions (Murat-M-B2, story AC10):
//   Pattern 1  CrossTenantRead   — tenant A cannot SELECT tenant B's tenant-scoped rows.
//   Pattern 2  CrossTenantInsert — tenant A INSERT with center_id = tenantB rejected by WITH CHECK.
//                                  ALSO: user INSERT with center_id = NULL (system seed forge) rejected.
//   Pattern 3  CrossTenantWrite  — tenant A UPDATE against tenant B's row → row unchanged.
//   Pattern 4  CrossTenantDelete — tenant A DELETE against tenant B's row → row still there.
//   Pattern 5  NullTenant        — SET LOCAL app.current_tenant_id = '' → zero TENANT rows,
//                                  system seeds STILL visible via IS NULL branch (AC10).
//   Pattern 6  UnsetTenant       — RESET → same behavior as Pattern 5 (symmetry).
//   Extension 1 SystemSeedsVisibleToAllTenants — dual-scope positive path: tenant A sees ≥ 5 seed rows.
//   Extension 2 UserCannotInsertSystemScopeRow — WITH CHECK on class_templates_insert rejects center_id=NULL.
//
// Uses raw SQL because sqlc queries land in Task 3.1 (green-phase). The RLS
// policies enforced here live in migration 20260703120000_create_class_templates.up.sql.
//
// Expected RED against the current codebase: the migrations don't exist, so
// INSERT INTO class_templates fails with "relation does not exist". That IS
// the intended red-phase signal — Amelia flips green by landing Task 2.1 + 2.4.

package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// insertClassTemplateRaw inserts a class_templates row via raw SQL,
// bypassing sqlc (which doesn't exist yet). Tenant context must already
// be set by the caller. Returns the row's id.
func insertClassTemplateRaw(t *testing.T, db *TxDB, centerID *uuid.UUID, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	var arg any
	if centerID != nil {
		arg = *centerID
	} else {
		arg = nil // system-seed insert (only permitted with FORCE ROW LEVEL SECURITY off — used in migration path)
	}
	_, err := db.Exec(context.Background(),
		`INSERT INTO class_templates (id, center_id, name, target_band, primary_skill, session_count, color)
		 VALUES ($1, $2, $3, 6.5, 'writing', 12, '#f59e0b')`,
		id, arg, name,
	)
	if err != nil {
		t.Fatalf("insert class_templates row (%s): %v", name, err)
	}
	return id
}

// -----------------------------------------------------------------------------
// Pattern 1 — CrossTenantRead
// -----------------------------------------------------------------------------
func TestRLS_ClassTemplate_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Tenant B writes a class_templates row.
	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	insertClassTemplateRaw(t, db, &centerBUUID, "Tenant B private template")

	// Tenant A queries — broad SELECT must NOT see tenant B's tenant-scoped row.
	TenantContext(t, db, centerA.ID)
	var visibleB int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM class_templates WHERE center_id = $1",
		centerB.ID,
	).Scan(&visibleB); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visibleB != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B class_templates rows, expected 0", visibleB)
	}
}

// -----------------------------------------------------------------------------
// Pattern 2 — CrossTenantInsert (Winston-W-B1 WITH CHECK guard)
// Also asserts user-scoped INSERT with center_id = NULL is rejected — closes
// Murat-M-B2 "system seed catalog forgery" attack vector.
// -----------------------------------------------------------------------------
func TestRLS_ClassTemplate_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Tenant A context set — attempt to INSERT with center_id = tenant B.
	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO class_templates (id, center_id, name, target_band, primary_skill, session_count, color)
		 VALUES ($1, $2, 'hostile', 6.5, 'writing', 12, '#f59e0b')`,
		id, centerB.ID,
	)
	// C3-03 review fix — assert on real 42501 (row_security_violation) rather
	// than any error. Prevents "relation does not exist" from masquerading as
	// a green RLS test.
	AssertRLSViolation(t, err, "class_templates cross-tenant INSERT")
}

// -----------------------------------------------------------------------------
// Pattern 3 — CrossTenantWrite (UPDATE)
// -----------------------------------------------------------------------------
func TestRLS_ClassTemplate_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Tenant B creates a row.
	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	originalID := insertClassTemplateRaw(t, db, &centerBUUID, "Original Name")

	// Tenant A attempts to mutate.
	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx,
		`UPDATE class_templates SET name = 'Hacked' WHERE id = $1`, originalID,
	)
	if err != nil {
		t.Fatalf("UPDATE returned error (expected silent 0-rows): %v", err)
	}
	// C3-04 review fix — assert 0 rows affected (the primary policy-denial
	// signal). Postgres RLS USING clause filters silently rather than raising.
	if rows := tag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d rows on tenant B's class_templates, expected 0", rows)
	}

	// Re-read as tenant B — row unchanged.
	TenantContext(t, db, centerB.ID)
	var name string
	if err := db.QueryRow(ctx,
		`SELECT name FROM class_templates WHERE id = $1`, originalID,
	).Scan(&name); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if name != "Original Name" {
		t.Errorf("RLS VIOLATION: tenant A UPDATE against tenant B row succeeded (name=%q)", name)
	}
}

// -----------------------------------------------------------------------------
// Pattern 4 — CrossTenantDelete
// -----------------------------------------------------------------------------
func TestRLS_ClassTemplate_CrossTenantDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	targetID := insertClassTemplateRaw(t, db, &centerBUUID, "Delete Target")

	TenantContext(t, db, centerA.ID)
	delTag, err := db.Exec(ctx, `DELETE FROM class_templates WHERE id = $1`, targetID)
	if err != nil {
		t.Fatalf("DELETE returned error (expected silent 0-rows): %v", err)
	}
	// C3-04 review fix — assert 0 rows affected on cross-tenant DELETE.
	if rows := delTag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A DELETE affected %d rows on tenant B's class_templates, expected 0", rows)
	}

	// Re-read as tenant B — row must still exist.
	TenantContext(t, db, centerB.ID)
	var stillExists int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM class_templates WHERE id = $1", targetID,
	).Scan(&stillExists); err != nil {
		t.Fatalf("count target row as tenant B: %v", err)
	}
	if stillExists != 1 {
		t.Errorf("RLS VIOLATION: cross-tenant DELETE succeeded — tenant B row is gone")
	}
}

// -----------------------------------------------------------------------------
// Pattern 5 — NullTenant
// Zero TENANT-scoped rows visible. System seeds STILL visible via IS NULL
// branch — asserted in Extension 1 rather than here.
// -----------------------------------------------------------------------------
func TestRLS_ClassTemplate_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	insertClassTemplateRaw(t, db, &centerUUID, "Private")

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM class_templates WHERE center_id = $1", center.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d tenant-scoped class_templates rows, expected 0", count)
	}
}

// -----------------------------------------------------------------------------
// Pattern 6 — UnsetTenant
// -----------------------------------------------------------------------------
func TestRLS_ClassTemplate_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	insertClassTemplateRaw(t, db, &centerUUID, "Private")

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM class_templates WHERE center_id = $1", center.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d tenant-scoped class_templates rows, expected 0", count)
	}
}

// -----------------------------------------------------------------------------
// Extension 1 — SystemSeedsVisibleToAllTenants (AC10 dual-scope positive path)
// Sally-S1 amendment raised the completeness threshold from ≥4 to ≥5.
// -----------------------------------------------------------------------------
func TestRLS_ClassTemplate_SystemSeedsVisibleToAllTenants(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)

	// System seed rows land in migration 20260703120300_seed_class_templates.up.sql
	// (Task 2.4). Their center_id IS NULL and class_templates_select policy's
	// dual-scope USING clause exposes them to every authenticated tenant.
	var seedCount int
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM class_templates WHERE center_id IS NULL`,
	).Scan(&seedCount); err != nil {
		t.Fatalf("count system seeds as tenant A: %v", err)
	}
	if seedCount < 5 {
		t.Errorf("AC1b + Sally-S1: expected >=5 system seed rows visible to tenant A, got %d — seed migration incomplete or dual-scope policy broken", seedCount)
	}
}

// -----------------------------------------------------------------------------
// Extension 2 — UserCannotInsertSystemScopeRow (Murat-M-B2)
// A tenant with a valid app.current_tenant_id CANNOT plant a class_templates
// row with center_id = NULL (system-seed forge). Enforced by
// class_templates_insert policy's WITH CHECK (center_id = NULLIF(...)::uuid).
// -----------------------------------------------------------------------------
func TestRLS_ClassTemplate_UserCannotInsertSystemScopeRow(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)

	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO class_templates (id, center_id, name, target_band, primary_skill, session_count, color)
		 VALUES ($1, NULL, 'forged seed', 6.5, 'writing', 12, '#f59e0b')`,
		id,
	)
	AssertRLSViolation(t, err, "Murat-M-B2 — user INSERT with center_id = NULL forging system seed")
}

// -----------------------------------------------------------------------------
// C3-01 review fix — WITH CHECK on UPDATE (tenant-reparent + promote-to-seed).
//
// The existing Pattern 3 test asserts tenant A CANNOT UPDATE tenant B's row.
// That exercises the USING clause. The AC7 pin also requires WITH CHECK on
// UPDATE — the "OTHER direction": tenant A trying to move their OWN row into
// tenantB's scope (or promoting to system-seed via SET center_id = NULL).
// Dropping WITH CHECK from the update policy would silently pass every
// pre-existing RLS test. These four tests close that gap.
// -----------------------------------------------------------------------------
func TestRLS_ClassTemplate_TenantCannotReparentOwnRow(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	centerAUUID := uuid.UUID(centerA.ID.Bytes)
	rowID := insertClassTemplateRaw(t, db, &centerAUUID, "Own row")

	// Tenant A tries to reparent OWN row to tenant B.
	// R2-P13 — WITH CHECK on class_templates_update policy MAY:
	//   (a) raise SQLSTATE 42501 (row_security_violation) — err != nil
	//   (b) silently reject via USING/CHECK returning 0 rows affected — err == nil
	// Both outcomes are policy-compliant. What is NOT compliant is the row
	// being reparented into tenant B. The re-read + assertion MUST run
	// regardless of err — the previous `if err == nil` skipped the re-read
	// on the raise-based path, which meant a regression that dropped WITH
	// CHECK but kept USING would silently pass this test.
	//
	// A SAVEPOINT wraps the UPDATE so a raise-based rejection can be rolled
	// back cleanly without aborting the outer TxDB single-tx (25P02). Mirrors
	// TestRLS_TemplateSession_TenantCannotReparentViaTemplateIDSwap.
	if _, err := db.Exec(ctx, "SAVEPOINT sp_ct_reparent"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	_, updateErr := db.Exec(ctx,
		`UPDATE class_templates SET center_id = $1 WHERE id = $2`,
		centerB.ID, rowID,
	)
	if updateErr != nil {
		if _, rbErr := db.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_ct_reparent"); rbErr != nil {
			t.Fatalf("rollback savepoint after UPDATE raise: %v", rbErr)
		}
	} else {
		if _, relErr := db.Exec(ctx, "RELEASE SAVEPOINT sp_ct_reparent"); relErr != nil {
			t.Fatalf("release savepoint: %v", relErr)
		}
	}
	// Always re-read as tenant A — the row must still be in tenant A's scope.
	var storedCenter uuid.UUID
	if scanErr := db.QueryRow(ctx,
		`SELECT center_id FROM class_templates WHERE id = $1`, rowID,
	).Scan(&storedCenter); scanErr != nil {
		t.Fatalf("re-read after UPDATE (err=%v): %v", updateErr, scanErr)
	}
	if storedCenter != centerAUUID {
		t.Errorf("RLS VIOLATION: tenant A reparented own row to tenant B (stored center_id=%v, expected=%v)", storedCenter, centerAUUID)
	}
}

func TestRLS_ClassTemplate_TenantCannotPromoteOwnRowToSystemSeed(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")

	TenantContext(t, db, centerA.ID)
	centerAUUID := uuid.UUID(centerA.ID.Bytes)
	rowID := insertClassTemplateRaw(t, db, &centerAUUID, "Own row")

	// Tenant A tries to promote OWN row to a system seed (center_id = NULL).
	// A successful promotion would poison every tenant's SELECT via the dual-scope
	// SELECT policy (`center_id IS NULL OR center_id = current_tenant`).
	//
	// R2-P13 — always re-read regardless of updateErr. WITH CHECK may raise
	// (42501) OR silently reject (0 rows). The row must still be tenant A's.
	// SAVEPOINT keeps the outer TxDB single-tx usable on raise.
	if _, err := db.Exec(ctx, "SAVEPOINT sp_ct_promote"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	_, updateErr := db.Exec(ctx,
		`UPDATE class_templates SET center_id = NULL WHERE id = $1`, rowID,
	)
	if updateErr != nil {
		if _, rbErr := db.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_ct_promote"); rbErr != nil {
			t.Fatalf("rollback savepoint after UPDATE raise: %v", rbErr)
		}
	} else {
		if _, relErr := db.Exec(ctx, "RELEASE SAVEPOINT sp_ct_promote"); relErr != nil {
			t.Fatalf("release savepoint: %v", relErr)
		}
	}
	var storedCenter *uuid.UUID
	if scanErr := db.QueryRow(ctx,
		`SELECT center_id FROM class_templates WHERE id = $1`, rowID,
	).Scan(&storedCenter); scanErr != nil {
		t.Fatalf("re-read after UPDATE (err=%v): %v", updateErr, scanErr)
	}
	if storedCenter == nil {
		t.Errorf("RLS VIOLATION: tenant A promoted own row to system-seed scope (center_id became NULL) — an attacker could poison every tenant's template list")
	}
}

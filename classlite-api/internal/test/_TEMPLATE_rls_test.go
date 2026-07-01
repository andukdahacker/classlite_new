// Build-excluded template — Go ignores files starting with "_", so this
// file is never compiled and can carry placeholder identifiers that would
// otherwise fail type-check.
//
// R1 mitigation B: J15 adversarial cross-tenant grid. Copy this file to
// `<resource>_rls_test.go` (e.g. `centers_rls_test.go`) and find-replace:
//
//	{Resource}   → PascalCase resource name        (e.g. Center, ClassTemplate)
//	{resource}   → snake_case table name           (e.g. center, class_template)
//	{resources}  → snake_case plural table name    (e.g. centers, class_templates)
//	{FixtureFn}  → fixture-creation helper name    (e.g. CreateCenter, CreateClassTemplate)
//	{ListParams} → sqlc-generated ListXParams type (e.g. ListCentersParams)
//	{InsertFn}   → sqlc-generated Insert fn name   (e.g. InsertCenter)
//	{InsertPar}  → sqlc-generated Insert params    (e.g. InsertCenterParams)
//	{UpdateFn}   → sqlc-generated Update fn name   (e.g. UpdateCenterName)
//	{UpdatePar}  → sqlc-generated Update params    (e.g. UpdateCenterNameParams)
//	{DeleteFn}   → sqlc-generated Delete fn name   (e.g. DeleteCenter)
//
// Six mandatory patterns are stubbed below. Every Epic-2+ resource family
// MUST land all six BEFORE the story with the new Store method transitions
// backlog → in-progress. See:
//   _bmad-output/test-artifacts/test-design/pre-epic-2-blockers-2026-06-30.md
//   _bmad-output/test-artifacts/test-design/test-design-architecture.md § R1
//   project-context.md § TEST-BE-1 (RLS adversarial tests — read AND write)
//
// The audit_logs_rls_test.go + adversarial_test.go files are the reference
// implementations — this template is derived from them, so copy from either
// if the placeholders don't map cleanly to your resource shape.

package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
)

// -----------------------------------------------------------------------------
// Pattern 1 — CrossTenantRead
// Proves tenant A cannot SELECT tenant B's rows even when tenant A has an
// active TenantContext. Load-bearing R1 assertion for read paths.
// -----------------------------------------------------------------------------
func TestRLS_{Resource}_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	queries := generated.New(db)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Tenant B writes a {resource} row.
	TenantContext(t, db, centerB.ID)
	{FixtureFn}(t, db, centerB.ID /*, other fixture params */)

	// Tenant A queries — must see zero {resources} that belong to tenant B.
	TenantContext(t, db, centerA.ID)
	rows, err := queries.List{Resources}(ctx, generated.{ListParams}{
		CenterID: centerB.ID, // deliberately asks for tenant B's data
	})
	if err != nil {
		t.Fatalf("list {resources} as tenant A: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("RLS VIOLATION: tenant A read %d tenant B {resource} rows", len(rows))
	}

	// Cross-check with a broad SELECT to catch leakage the sqlc filter would mask.
	var visible int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM {resources} WHERE center_id IN ($1, $2)",
		centerA.ID, centerB.ID,
	).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d {resource} rows across both tenants, expected 0", visible)
	}
}

// -----------------------------------------------------------------------------
// Pattern 2 — CrossTenantInsert
// Tenant A's context set, INSERT names tenant B's center_id → RLS WITH CHECK
// must reject. If not rejected, an attacker with tenant A context could plant
// rows into tenant B's tables.
// -----------------------------------------------------------------------------
func TestRLS_{Resource}_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	queries := generated.New(db)
	TenantContext(t, db, centerA.ID)
	_, err := queries.{InsertFn}(ctx, generated.{InsertPar}{
		CenterID: centerB.ID, // attempt to write into tenant B
		// ...remaining fields...
	})
	if err == nil {
		t.Error("RLS VIOLATION: cross-tenant INSERT on {resources} should have been rejected by WITH CHECK")
	}
}

// -----------------------------------------------------------------------------
// Pattern 3 — CrossTenantWrite (UPDATE)
// PostgreSQL does not error on UPDATE affecting 0 rows — RLS silently drops
// the mutation instead of failing. This test proves tenant A's UPDATE against
// tenant B's row leaves the original data intact.
// -----------------------------------------------------------------------------
func TestRLS_{Resource}_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	queries := generated.New(db)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Tenant B creates a row and captures its original state.
	TenantContext(t, db, centerB.ID)
	original := {FixtureFn}(t, db, centerB.ID /*, ... */)

	// Tenant A attempts to mutate tenant B's row.
	TenantContext(t, db, centerA.ID)
	_, _ = queries.{UpdateFn}(ctx, generated.{UpdatePar}{
		ID:       original.ID,
		CenterID: centerB.ID,
		// ...mutation payload...
	})

	// Re-read as tenant B — the row must be unchanged.
	TenantContext(t, db, centerB.ID)
	// var current ... := queries.Get{Resource}(ctx, ...)
	// if current.<field> != original.<field> {
	// 	 t.Errorf("RLS VIOLATION: tenant A UPDATE against tenant B row succeeded (was %q, now %q)",
	// 	 	original.<field>, current.<field>)
	// }
	_ = original
}

// -----------------------------------------------------------------------------
// Pattern 4 — CrossTenantDelete
// Same story as UPDATE: DELETE affecting 0 rows is silent success in PG.
// -----------------------------------------------------------------------------
func TestRLS_{Resource}_CrossTenantDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	queries := generated.New(db)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	target := {FixtureFn}(t, db, centerB.ID /*, ... */)

	TenantContext(t, db, centerA.ID)
	_, _ = queries.{DeleteFn}(ctx, target.ID)

	// Re-read as tenant B — the row must still exist.
	TenantContext(t, db, centerB.ID)
	var stillExists int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM {resources} WHERE id = $1", target.ID,
	).Scan(&stillExists); err != nil {
		t.Fatalf("count target row as tenant B: %v", err)
	}
	if stillExists != 1 {
		t.Errorf("RLS VIOLATION: cross-tenant DELETE succeeded — tenant B row is gone")
	}
}

// -----------------------------------------------------------------------------
// Pattern 5 — NullTenant
// Setting tenant context to empty string triggers the NULLIF pattern in RLS
// policies → policy sees NULL → zero rows returned. Simulates the "bug" of
// resetting tenant context without setting a new one before a query.
// -----------------------------------------------------------------------------
func TestRLS_{Resource}_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	{FixtureFn}(t, db, center.ID /*, ... */)

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM {resources} WHERE center_id = $1", center.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d {resource} rows, expected 0", count)
	}
}

// -----------------------------------------------------------------------------
// Pattern 6 — UnsetTenant
// Unset (never-set) tenant context — RESET behaviour. Different code path
// from null (empty string) but must be equally hostile: zero rows.
// -----------------------------------------------------------------------------
func TestRLS_{Resource}_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	{FixtureFn}(t, db, center.ID /*, ... */)

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM {resources} WHERE center_id = $1", center.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d {resource} rows, expected 0", count)
	}
}

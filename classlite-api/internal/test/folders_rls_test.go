// Story 4.4a — ATDD RED scaffold (BUILD-EXCLUDED, `_`-prefixed).
//
// UN-PREFIX -> `folders_rls_test.go` AFTER T1 (folders table + 4-policy FORCE
// RLS + self-FK parent_folder_id) and T2 sqlc (InsertFolder / ListFolders /
// UpdateFolderName / SoftDeleteFolder / GetFolder) + codegen.sh. Reconcile the
// // TODO(dev) sqlc names, then: go test ./internal/test -run TestRLS_Folder
//
// AC1/AC2 · TEST-BE-1 · TEST-BE-2. The nesting/cycle guard is a separate
// behavioral test (_folders_cycle_guard is folded into the knowledge-hub
// handler scaffold) — this file proves pure tenant isolation only.
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

func createFolderFixture(t *testing.T, db *TxDB, centerID pgtype.UUID, name string) generated.Folder {
	t.Helper()
	q := generated.New(db)
	row, err := q.InsertFolder(context.Background(), generated.InsertFolderParams{
		CenterID:       centerID,
		ParentFolderID: pgtype.UUID{}, // root folder
		Name:           name,
	})
	if err != nil {
		t.Fatalf("insert folder fixture: %v", err)
	}
	return row
}

func TestRLS_Folder_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	q := generated.New(db)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	createFolderFixture(t, db, centerB.ID, "B private")

	TenantContext(t, db, centerA.ID)
	rows, err := q.ListFolders(ctx, centerB.ID)
	if err != nil {
		t.Fatalf("list folders as tenant A: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("RLS VIOLATION: tenant A read %d of tenant B's folders", len(rows))
	}

	var visible int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM folders WHERE center_id IN ($1, $2)", centerA.ID, centerB.ID,
	).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d folders across both tenants, expected 0", visible)
	}
}

func TestRLS_Folder_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	q := generated.New(db)

	CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, NewPGUUIDFromString(TenantAID))
	_, err := q.InsertFolder(ctx, generated.InsertFolderParams{
		CenterID: centerB.ID, // plant into tenant B
		Name:     "planted",
	})
	if err == nil {
		t.Error("RLS VIOLATION: cross-tenant INSERT into folders should be rejected by WITH CHECK")
	}
}

func TestRLS_Folder_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	q := generated.New(db)

	CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	original := createFolderFixture(t, db, centerB.ID, "original")

	TenantContext(t, db, NewPGUUIDFromString(TenantAID))
	_, _ = q.UpdateFolderName(ctx, generated.UpdateFolderNameParams{
		ID:       original.ID,
		CenterID: centerB.ID,
		Name:     "hacked",
	})

	TenantContext(t, db, centerB.ID)
	var name string
	if err := db.QueryRow(ctx, "SELECT name FROM folders WHERE id = $1", original.ID).Scan(&name); err != nil {
		t.Fatalf("re-read folder as tenant B: %v", err)
	}
	if name != "original" {
		t.Errorf("RLS VIOLATION: cross-tenant folder UPDATE succeeded (was %q, now %q)", "original", name)
	}
}

func TestRLS_Folder_CrossTenantSoftDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	q := generated.New(db)

	CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	target := createFolderFixture(t, db, centerB.ID, "keep")

	TenantContext(t, db, NewPGUUIDFromString(TenantAID))
	_, _ = q.SoftDeleteFolder(ctx, generated.SoftDeleteFolderParams{ID: target.ID, CenterID: centerB.ID})

	TenantContext(t, db, centerB.ID)
	var deletedAtIsNull bool
	if err := db.QueryRow(ctx,
		"SELECT deleted_at IS NULL FROM folders WHERE id = $1", target.ID,
	).Scan(&deletedAtIsNull); err != nil {
		t.Fatalf("check deleted_at as tenant B: %v", err)
	}
	if !deletedAtIsNull {
		t.Error("RLS VIOLATION: cross-tenant folder soft-delete set deleted_at on tenant B's row")
	}
}

func TestRLS_Folder_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	createFolderFixture(t, db, center.ID, "x")

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM folders WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d folders, expected 0", count)
	}
}

func TestRLS_Folder_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	createFolderFixture(t, db, center.ID, "x")

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM folders WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d folders, expected 0", count)
	}
}

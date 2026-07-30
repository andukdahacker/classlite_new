// Story 4.4a — ATDD RED scaffold (BUILD-EXCLUDED). Go ignores files whose name
// starts with "_", so this compiles-excludes cleanly while `files`/sqlc symbols
// do not yet exist. Derived from _TEMPLATE_rls_test.go (the 6-pattern R1 grid).
//
// UN-PREFIX (rename `_files_rls_test.go` -> `files_rls_test.go`) AFTER:
//   - T1 migration creates `files` with 4-policy FORCE RLS + soft-delete
//   - T2 sqlc: ListFilesByFolder / InsertFile / UpdateFileName / SoftDeleteFile
//   - codegen.sh has regenerated store/generated
//
// Then reconcile the sqlc-generated names below (marked  // TODO(dev)) and run:
//
//	go test ./internal/test -run TestRLS_File
//
// AC1/AC3 · TEST-BE-1 (read AND write isolation) · TEST-BE-2 (real DB, no mock).
// Every new table MUST land all six patterns BEFORE the story ships.
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// createFileFixture inserts one `files` row for the given center as that center's
// tenant. Returns the inserted row. uploaded_by is left NULL (the RLS grid does
// not need an author; the FK is nullable → SET NULL).
func createFileFixture(t *testing.T, db *TxDB, centerID pgtype.UUID, name string) generated.File {
	t.Helper()
	q := generated.New(db)
	row, err := q.InsertFile(context.Background(), generated.InsertFileParams{
		CenterID:    centerID,
		FolderID:    pgtype.UUID{}, // root-level file
		Name:        name,
		Slug:        name + "-slug",
		ObjectKey:   UUIDString(centerID) + "/knowledge/" + name + ".pdf",
		ContentType: "application/pdf",
		SizeBytes:   1024,
		UploadedBy:  pgtype.UUID{},
	})
	if err != nil {
		t.Fatalf("insert file fixture: %v", err)
	}
	return row
}

// Pattern 1 — CrossTenantRead
func TestRLS_File_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	q := generated.New(db)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	createFileFixture(t, db, centerB.ID, "secret")

	TenantContext(t, db, centerA.ID)
	rows, err := q.ListFilesByFolder(ctx, generated.ListFilesByFolderParams{
		CenterID: centerB.ID, // deliberately asks for tenant B's data
		FolderID: pgtype.UUID{},
	})
	if err != nil {
		t.Fatalf("list files as tenant A: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("RLS VIOLATION: tenant A read %d of tenant B's files", len(rows))
	}

	var visible int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM files WHERE center_id IN ($1, $2)", centerA.ID, centerB.ID,
	).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d files across both tenants, expected 0", visible)
	}
}

// Pattern 2 — CrossTenantInsert (WITH CHECK must reject)
func TestRLS_File_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	q := generated.New(db)

	CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, NewPGUUIDFromString(TenantAID))
	_, err := q.InsertFile(ctx, generated.InsertFileParams{
		CenterID:    centerB.ID, // attempt to plant a row into tenant B
		Name:        "planted",
		Slug:        "planted",
		ObjectKey:   "center-b/knowledge/planted.pdf",
		ContentType: "application/pdf",
		SizeBytes:   1,
		UploadedBy:  centerB.ID,
	})
	if err == nil {
		t.Error("RLS VIOLATION: cross-tenant INSERT into files should be rejected by WITH CHECK")
	}
}

// Pattern 3 — CrossTenantWrite (UPDATE affecting 0 rows is silent in PG)
func TestRLS_File_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	q := generated.New(db)

	CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	original := createFileFixture(t, db, centerB.ID, "original")

	TenantContext(t, db, NewPGUUIDFromString(TenantAID))
	_, _ = q.UpdateFileName(ctx, generated.UpdateFileNameParams{
		ID:       original.ID,
		CenterID: centerB.ID,
		Name:     "hacked",
	})

	TenantContext(t, db, centerB.ID)
	current, err := q.GetFileBySlug(ctx, generated.GetFileBySlugParams{CenterID: centerB.ID, Slug: original.Slug})
	if err != nil {
		t.Fatalf("re-read file as tenant B: %v", err)
	}
	if current.Name != "original" {
		t.Errorf("RLS VIOLATION: cross-tenant UPDATE succeeded (was %q, now %q)", "original", current.Name)
	}
}

// Pattern 4 — CrossTenantDelete (soft-delete). Tenant A soft-deleting tenant B's
// file must NOT set deleted_at on B's row. AC3: delete is soft.
func TestRLS_File_CrossTenantSoftDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	q := generated.New(db)

	CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	target := createFileFixture(t, db, centerB.ID, "keep")

	TenantContext(t, db, NewPGUUIDFromString(TenantAID))
	_, _ = q.SoftDeleteFile(ctx, generated.SoftDeleteFileParams{ID: target.ID, CenterID: centerB.ID})

	TenantContext(t, db, centerB.ID)
	var deletedAtIsNull bool
	if err := db.QueryRow(ctx,
		"SELECT deleted_at IS NULL FROM files WHERE id = $1", target.ID,
	).Scan(&deletedAtIsNull); err != nil {
		t.Fatalf("check deleted_at as tenant B: %v", err)
	}
	if !deletedAtIsNull {
		t.Error("RLS VIOLATION: cross-tenant soft-delete set deleted_at on tenant B's file")
	}
}

// SoftDeleteExcludedFromList — a soft-deleted file must not appear in list
// queries (AC3: all list queries filter deleted_at IS NULL).
func TestRLS_File_SoftDeletedExcludedFromList(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	q := generated.New(db)

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	f := createFileFixture(t, db, center.ID, "doomed")

	if _, err := q.SoftDeleteFile(ctx, generated.SoftDeleteFileParams{ID: f.ID, CenterID: center.ID}); err != nil {
		t.Fatalf("soft-delete own file: %v", err)
	}
	rows, err := q.ListFilesByFolder(ctx, generated.ListFilesByFolderParams{CenterID: center.ID, FolderID: pgtype.UUID{}})
	if err != nil {
		t.Fatalf("list after soft-delete: %v", err)
	}
	for _, r := range rows {
		if r.ID == f.ID {
			t.Error("soft-deleted file still returned by ListFilesByFolder — deleted_at filter missing")
		}
	}
}

// Pattern 5 — NullTenant → zero rows.
func TestRLS_File_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	createFileFixture(t, db, center.ID, "x")

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM files WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d files, expected 0", count)
	}
}

// Pattern 6 — UnsetTenant → zero rows.
func TestRLS_File_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	createFileFixture(t, db, center.ID, "x")

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM files WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d files, expected 0", count)
	}
}

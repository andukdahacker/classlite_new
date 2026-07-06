// Story 2.2 — R1 discharge: J15 6-pattern grid for classes.
//
// classes has no dual-scope (no system-seeded classes exist) and no trigger.
// Standard center-scoped RLS mirroring center_members. Six patterns only —
// no named extensions.
//
// Winston-W-B1 four-policy shape enforced:
//   classes_select FOR SELECT USING (center_id = tenant)
//   classes_insert FOR INSERT WITH CHECK (center_id = tenant)
//   classes_update FOR UPDATE USING (...) WITH CHECK (...)
//   classes_delete FOR DELETE USING (center_id = tenant)
//
// Migration: 20260703120200_create_classes.up.sql (Task 2.3).
// Also asserts classes_teacher_mutex CHECK constraint via a targeted test
// (Winston-W-S3 fold — belt against Epic 7 reconciliation drift).
//
// Expected RED phase: relation "classes" does not exist.

package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// insertClassRaw inserts a classes row via raw SQL. Tenant context must be
// set by the caller. Returns row id.
func insertClassRaw(t *testing.T, db *TxDB, centerID uuid.UUID, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, target_band, primary_skill, session_count, status, start_date)
		 VALUES ($1, $2, $3, 6.5, 'writing', 12, 'upcoming', current_date + interval '30 days')`,
		id, centerID, name,
	)
	if err != nil {
		t.Fatalf("insert classes row (%s): %v", name, err)
	}
	return id
}

// -----------------------------------------------------------------------------
// Pattern 1 — CrossTenantRead
// -----------------------------------------------------------------------------
func TestRLS_Class_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	insertClassRaw(t, db, centerBUUID, "Tenant B class")

	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM classes WHERE center_id = $1", centerB.ID,
	).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B classes rows, expected 0", visible)
	}
}

// -----------------------------------------------------------------------------
// Pattern 2 — CrossTenantInsert
// Winston-W-B1: WITH CHECK on classes_insert MUST reject center_id spoofing.
// -----------------------------------------------------------------------------
func TestRLS_Class_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO classes (id, center_id, name, target_band, primary_skill, session_count, status, start_date)
		 VALUES ($1, $2, 'hostile', 6.5, 'writing', 12, 'upcoming', current_date + interval '30 days')`,
		id, centerB.ID,
	)
	// C3-03 review fix — assert real 42501 rather than any error.
	AssertRLSViolation(t, err, "classes cross-tenant INSERT")
}

// -----------------------------------------------------------------------------
// Pattern 3 — CrossTenantWrite
// -----------------------------------------------------------------------------
func TestRLS_Class_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	originalID := insertClassRaw(t, db, centerBUUID, "Original Class")

	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx,
		`UPDATE classes SET name = 'Hacked' WHERE id = $1`, originalID,
	)
	if err != nil {
		t.Fatalf("UPDATE returned error (expected silent 0-rows): %v", err)
	}
	// C3-04 review fix — assert 0 rows affected.
	if rows := tag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d classes rows on tenant B, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var name string
	if err := db.QueryRow(ctx,
		`SELECT name FROM classes WHERE id = $1`, originalID,
	).Scan(&name); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if name != "Original Class" {
		t.Errorf("RLS VIOLATION: tenant A UPDATE against tenant B classes row succeeded (name=%q)", name)
	}
}

// -----------------------------------------------------------------------------
// Pattern 4 — CrossTenantDelete
// -----------------------------------------------------------------------------
func TestRLS_Class_CrossTenantDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	targetID := insertClassRaw(t, db, centerBUUID, "Delete Target")

	TenantContext(t, db, centerA.ID)
	delTag, err := db.Exec(ctx, `DELETE FROM classes WHERE id = $1`, targetID)
	if err != nil {
		t.Fatalf("DELETE returned error (expected silent 0-rows): %v", err)
	}
	// C3-04 review fix — assert 0 rows affected.
	if rows := delTag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A DELETE affected %d classes rows on tenant B, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var stillExists int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM classes WHERE id = $1", targetID,
	).Scan(&stillExists); err != nil {
		t.Fatalf("count target row as tenant B: %v", err)
	}
	if stillExists != 1 {
		t.Errorf("RLS VIOLATION: cross-tenant DELETE succeeded — tenant B classes row is gone")
	}
}

// -----------------------------------------------------------------------------
// Pattern 5 — NullTenant
// -----------------------------------------------------------------------------
func TestRLS_Class_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	insertClassRaw(t, db, centerUUID, "Private Class")

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM classes WHERE center_id = $1", center.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d classes rows, expected 0", count)
	}
}

// -----------------------------------------------------------------------------
// Pattern 6 — UnsetTenant
// -----------------------------------------------------------------------------
func TestRLS_Class_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	insertClassRaw(t, db, centerUUID, "Private Class")

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM classes WHERE center_id = $1", center.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d classes rows, expected 0", count)
	}
}

// -----------------------------------------------------------------------------
// C3-01 review fix — WITH CHECK on UPDATE (tenant-reparent).
// The existing CrossTenantWrite test hits the USING clause only; this test
// exercises the WITH CHECK clause by having tenant A attempt to reparent
// their OWN row into tenant B's scope. Dropping WITH CHECK would silently
// pass every pre-existing RLS test.
// -----------------------------------------------------------------------------
func TestRLS_Class_TenantCannotReparentOwnRow(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	centerAUUID := uuid.UUID(centerA.ID.Bytes)
	rowID := insertClassRaw(t, db, centerAUUID, "Own class")

	// R2-P13 — always re-read regardless of updateErr. WITH CHECK on
	// classes_update MAY raise (42501) OR silently reject (0 rows). Either
	// outcome is policy-compliant; row-still-tenant-A is what matters.
	// SAVEPOINT keeps the outer TxDB single-tx usable on raise.
	if _, err := db.Exec(ctx, "SAVEPOINT sp_cls_reparent"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	_, updateErr := db.Exec(ctx,
		`UPDATE classes SET center_id = $1 WHERE id = $2`,
		centerB.ID, rowID,
	)
	if updateErr != nil {
		if _, rbErr := db.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_cls_reparent"); rbErr != nil {
			t.Fatalf("rollback savepoint after UPDATE raise: %v", rbErr)
		}
	} else {
		if _, relErr := db.Exec(ctx, "RELEASE SAVEPOINT sp_cls_reparent"); relErr != nil {
			t.Fatalf("release savepoint: %v", relErr)
		}
	}
	var storedCenter uuid.UUID
	if scanErr := db.QueryRow(ctx,
		`SELECT center_id FROM classes WHERE id = $1`, rowID,
	).Scan(&storedCenter); scanErr != nil {
		t.Fatalf("re-read after UPDATE (err=%v): %v", updateErr, scanErr)
	}
	if storedCenter != centerAUUID {
		t.Errorf("RLS VIOLATION: tenant A reparented own class row to tenant B (stored center_id=%v, expected=%v)", storedCenter, centerAUUID)
	}
}

// -----------------------------------------------------------------------------
// C3-05 review fix — classes_teacher_mutex CHECK constraint (Winston-W-S3).
// The file header claimed this test existed but it did not. A regression
// dropping the CHECK migration would let a class carry BOTH teacher_id AND
// pending_teacher_email simultaneously — Epic 7's claim-the-class flow would
// then leave the pending_teacher_email populated after promoting to teacher_id.
// -----------------------------------------------------------------------------
func TestRLS_Classes_TeacherMutexCheckConstraint(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	teacher := CreateUser(t, db, "teacher-mutex@example.com", "Teach")

	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO classes (id, center_id, name, target_band, primary_skill, session_count, status, teacher_id, pending_teacher_email, start_date)
		 VALUES ($1, $2, 'both-set', 6.5, 'writing', 12, 'upcoming', $3, 'other@example.com', current_date + interval '30 days')`,
		id, centerA.ID, teacher.ID,
	)
	if err == nil {
		t.Error("classes_teacher_mutex VIOLATION: INSERT with BOTH teacher_id AND pending_teacher_email set should have been rejected by CHECK constraint — Epic 7 reconciliation drift risk")
	}
}

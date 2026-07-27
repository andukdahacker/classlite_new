// Story 4.1 — RLS adversarial grid for the NEW `exercises` table (AC7,
// TEST-BE-1). Standard 4-policy grid mirroring classes/enrollments, PLUS the
// party-mode additions the plain grid doesn't cover:
//
//   - TenantCannotReparentOwnRow  (WITH CHECK on UPDATE)
//   - CrossTenantTagFilterLeak    (a tenant B row whose tags match tenant A's
//     filter must NOT surface for tenant A — the tag filter can't leak)
//
// The cross-tenant/cross-teacher Duplicate-by-id → 404 case lives in the
// handler ATDD (it's a service read-then-clone path, not a bare SQL policy).
package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// insertExerciseRaw inserts an exercises row via raw SQL. Tenant context must be
// set by the caller. Returns the row id.
func insertExerciseRaw(t *testing.T, db *TxDB, centerID, createdBy uuid.UUID, code, skill string, tags []string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if tags == nil {
		tags = []string{}
	}
	_, err := db.Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, tags)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		id, centerID, createdBy, code, "Exercise "+code, skill, tags,
	)
	if err != nil {
		t.Fatalf("insert exercises row: %v", err)
	}
	return id
}

// seedExerciseDeps creates the created_by user a well-formed exercise needs in
// the current tenant. Tenant context must be set by the caller.
func seedExerciseAuthor(t *testing.T, db *TxDB) uuid.UUID {
	t.Helper()
	return insertUserRaw(t, db, "author-"+uuid.NewString()[:8]+"@example.com", "Author A")
}

// Pattern 1 — CrossTenantRead
func TestRLS_Exercise_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	authorB := seedExerciseAuthor(t, db)
	insertExerciseRaw(t, db, centerBUUID, authorB, "EX-R001", "reading", []string{"grammar"})

	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM exercises WHERE center_id = $1", centerB.ID).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B exercises, expected 0", visible)
	}
}

// Pattern 2 — CrossTenantInsert (WITH CHECK rejects center_id spoof)
func TestRLS_Exercise_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	authorB := seedExerciseAuthor(t, db)

	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		id, centerB.ID, authorB, "EX-R001", "Sneaky", "reading",
	)
	AssertRLSViolation(t, err, "exercises cross-tenant INSERT")
}

// Pattern 3 — CrossTenantWrite (silent 0-rows, target unchanged)
func TestRLS_Exercise_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	authorB := seedExerciseAuthor(t, db)
	rowID := insertExerciseRaw(t, db, centerBUUID, authorB, "EX-R001", "reading", nil)

	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx, `UPDATE exercises SET title = 'Hacked' WHERE id = $1`, rowID)
	if err != nil {
		t.Fatalf("UPDATE returned error (expected silent 0-rows): %v", err)
	}
	if rows := tag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d tenant B exercises, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var title string
	if err := db.QueryRow(ctx, `SELECT title FROM exercises WHERE id = $1`, rowID).Scan(&title); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if title != "Exercise EX-R001" {
		t.Errorf("RLS VIOLATION: tenant A UPDATE against tenant B exercise succeeded (title=%q)", title)
	}
}

// Pattern 4 — CrossTenantDelete (silent 0-rows, target survives)
func TestRLS_Exercise_CrossTenantDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	authorB := seedExerciseAuthor(t, db)
	targetID := insertExerciseRaw(t, db, centerBUUID, authorB, "EX-R001", "reading", nil)

	TenantContext(t, db, centerA.ID)
	delTag, err := db.Exec(ctx, `DELETE FROM exercises WHERE id = $1`, targetID)
	if err != nil {
		t.Fatalf("DELETE returned error (expected silent 0-rows): %v", err)
	}
	if rows := delTag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A DELETE affected %d tenant B exercises, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var stillExists int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM exercises WHERE id = $1", targetID).Scan(&stillExists); err != nil {
		t.Fatalf("count target row as tenant B: %v", err)
	}
	if stillExists != 1 {
		t.Errorf("RLS VIOLATION: cross-tenant DELETE succeeded — tenant B exercise is gone")
	}
}

// Pattern 5 — NullTenant
func TestRLS_Exercise_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	author := seedExerciseAuthor(t, db)
	insertExerciseRaw(t, db, centerUUID, author, "EX-R001", "reading", nil)

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM exercises WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d exercises, expected 0", count)
	}
}

// Pattern 6 — UnsetTenant
func TestRLS_Exercise_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	author := seedExerciseAuthor(t, db)
	insertExerciseRaw(t, db, centerUUID, author, "EX-R001", "reading", nil)

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM exercises WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d exercises, expected 0", count)
	}
}

// WITH CHECK on UPDATE — a tenant cannot reparent its own exercise to another
// center. Dropping WITH CHECK would pass every other RLS test silently.
func TestRLS_Exercise_TenantCannotReparentOwnRow(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	centerAUUID := uuid.UUID(centerA.ID.Bytes)
	author := seedExerciseAuthor(t, db)
	rowID := insertExerciseRaw(t, db, centerAUUID, author, "EX-R001", "reading", nil)

	if _, err := db.Exec(ctx, "SAVEPOINT sp_ex_reparent"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	_, updateErr := db.Exec(ctx, `UPDATE exercises SET center_id = $1 WHERE id = $2`, centerB.ID, rowID)
	if updateErr != nil {
		if _, rbErr := db.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_ex_reparent"); rbErr != nil {
			t.Fatalf("rollback savepoint: %v", rbErr)
		}
	} else {
		if _, relErr := db.Exec(ctx, "RELEASE SAVEPOINT sp_ex_reparent"); relErr != nil {
			t.Fatalf("release savepoint: %v", relErr)
		}
	}
	var storedCenter uuid.UUID
	if scanErr := db.QueryRow(ctx, `SELECT center_id FROM exercises WHERE id = $1`, rowID).Scan(&storedCenter); scanErr != nil {
		t.Fatalf("re-read after UPDATE (err=%v): %v", updateErr, scanErr)
	}
	if storedCenter != centerAUUID {
		t.Errorf("RLS VIOLATION: tenant A reparented its own exercise to tenant B (stored=%v, expected=%v)", storedCenter, centerAUUID)
	}
}

// Party-mode addition — the tag filter must not leak cross-tenant. A tenant B
// row whose tags match tenant A's filter must return 0 for tenant A.
func TestRLS_Exercise_CrossTenantTagFilterLeak(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	authorB := seedExerciseAuthor(t, db)
	insertExerciseRaw(t, db, centerBUUID, authorB, "EX-R001", "reading", []string{"ielts", "secret"})

	TenantContext(t, db, centerA.ID)
	var leaked int
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM exercises WHERE 'secret' = ANY(tags)`,
	).Scan(&leaked); err != nil {
		t.Fatalf("tag-filter count as tenant A: %v", err)
	}
	if leaked != 0 {
		t.Errorf("RLS VIOLATION: tenant A's tag filter surfaced %d tenant B exercises, expected 0", leaked)
	}
}

// Counter table RLS — a tenant cannot spoof another center's code counter row.
func TestRLS_ExerciseCodeCounter_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	_ = centerA

	TenantContext(t, db, centerA.ID)
	_, err := db.Exec(ctx,
		`INSERT INTO exercise_code_counters (center_id, skill, next_seq) VALUES ($1, $2, $3)`,
		centerB.ID, "reading", 1,
	)
	AssertRLSViolation(t, err, "exercise_code_counters cross-tenant INSERT")
}

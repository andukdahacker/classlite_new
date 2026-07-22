// Story 3.4 — ATDD RED-PHASE, Task 0. R19 discharge (part 1): J15 6-pattern
// RLS grid for the NEW `sessions` table + write-isolation on the scope path.
//
// `sessions` is center-scoped, no dual-scope, no trigger — standard 4-policy
// grid mirroring `classes` (classes_rls_test.go is the reference). Four-policy
// shape MUST be enforced by the Task 1 migration:
//   sessions_select FOR SELECT USING (center_id = tenant)
//   sessions_insert FOR INSERT WITH CHECK (center_id = tenant)
//   sessions_update FOR UPDATE USING (...) WITH CHECK (...)
//   sessions_delete FOR DELETE USING (center_id = tenant)
//
// RED signal (verifiable NOW, compiles fine — raw SQL only):
//   ERROR: relation "sessions" does not exist (SQLSTATE 42P01)
// GREEN: Task 1 migration `20260721120000_create_sessions`.
//
// This file is the security core of the R19 mandate. The scope-leak matrix
// (this/future/all, past-immutable, cross-teacher, 409) lands in
// session_handler_atdd_test.go against the real service surface.
package test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// insertSessionRaw inserts a sessions row via raw SQL. Tenant context must be
// set by the caller. `startsAt` lets a caller seed past/future rows for the
// scope tests. Returns the row id.
func insertSessionRaw(t *testing.T, db *TxDB, centerID, classID uuid.UUID, startsAt time.Time, groupID *uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.Exec(context.Background(),
		`INSERT INTO sessions (id, center_id, class_id, topic, starts_at, ends_at, status, recurrence_group_id, recurrence_pattern)
		 VALUES ($1, $2, $3, 'Speaking', $4::timestamptz, $4::timestamptz + interval '90 minutes', 'scheduled', $5, CASE WHEN $5::uuid IS NULL THEN NULL ELSE 'weekly' END)`,
		id, centerID, classID, startsAt, groupID,
	)
	if err != nil {
		t.Fatalf("insert sessions row: %v", err)
	}
	return id
}

// seedClassForSession creates the parent class (sessions.class_id is NOT NULL
// FK ON DELETE RESTRICT). Tenant context must be set by the caller.
func seedClassForSession(t *testing.T, db *TxDB, centerID uuid.UUID) uuid.UUID {
	t.Helper()
	return insertClassRaw(t, db, centerID, "Session Parent Class")
}

// -----------------------------------------------------------------------------
// Pattern 1 — CrossTenantRead
// -----------------------------------------------------------------------------
func TestRLS_Session_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	classB := seedClassForSession(t, db, centerBUUID)
	insertSessionRaw(t, db, centerBUUID, classB, time.Now().Add(24*time.Hour), nil)

	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM sessions WHERE center_id = $1", centerB.ID,
	).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B sessions rows, expected 0", visible)
	}
}

// -----------------------------------------------------------------------------
// Pattern 2 — CrossTenantInsert (WITH CHECK rejects center_id spoof)
// -----------------------------------------------------------------------------
func TestRLS_Session_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Parent class must exist in B for the FK; seed as B.
	TenantContext(t, db, centerB.ID)
	classB := seedClassForSession(t, db, uuid.UUID(centerB.ID.Bytes))

	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO sessions (id, center_id, class_id, topic, starts_at, ends_at, status)
		 VALUES ($1, $2, $3, 'hostile', now() + interval '1 day', now() + interval '1 day' + interval '90 minutes', 'scheduled')`,
		id, centerB.ID, classB,
	)
	AssertRLSViolation(t, err, "sessions cross-tenant INSERT")
}

// -----------------------------------------------------------------------------
// Pattern 3 — CrossTenantWrite (silent 0-rows, target unchanged)
// -----------------------------------------------------------------------------
func TestRLS_Session_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	classB := seedClassForSession(t, db, centerBUUID)
	originalID := insertSessionRaw(t, db, centerBUUID, classB, time.Now().Add(24*time.Hour), nil)

	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx, `UPDATE sessions SET topic = 'Hacked' WHERE id = $1`, originalID)
	if err != nil {
		t.Fatalf("UPDATE returned error (expected silent 0-rows): %v", err)
	}
	if rows := tag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d sessions rows on tenant B, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var topic string
	if err := db.QueryRow(ctx, `SELECT topic FROM sessions WHERE id = $1`, originalID).Scan(&topic); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if topic != "Speaking" {
		t.Errorf("RLS VIOLATION: tenant A UPDATE against tenant B sessions row succeeded (topic=%q)", topic)
	}
}

// -----------------------------------------------------------------------------
// Pattern 4 — CrossTenantDelete (silent 0-rows, target survives)
// -----------------------------------------------------------------------------
func TestRLS_Session_CrossTenantDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	classB := seedClassForSession(t, db, centerBUUID)
	targetID := insertSessionRaw(t, db, centerBUUID, classB, time.Now().Add(24*time.Hour), nil)

	TenantContext(t, db, centerA.ID)
	delTag, err := db.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, targetID)
	if err != nil {
		t.Fatalf("DELETE returned error (expected silent 0-rows): %v", err)
	}
	if rows := delTag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A DELETE affected %d sessions rows on tenant B, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var stillExists int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM sessions WHERE id = $1", targetID).Scan(&stillExists); err != nil {
		t.Fatalf("count target row as tenant B: %v", err)
	}
	if stillExists != 1 {
		t.Errorf("RLS VIOLATION: cross-tenant DELETE succeeded — tenant B sessions row is gone")
	}
}

// -----------------------------------------------------------------------------
// Pattern 5 — NullTenant
// -----------------------------------------------------------------------------
func TestRLS_Session_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class := seedClassForSession(t, db, centerUUID)
	insertSessionRaw(t, db, centerUUID, class, time.Now().Add(24*time.Hour), nil)

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM sessions WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d sessions rows, expected 0", count)
	}
}

// -----------------------------------------------------------------------------
// Pattern 6 — UnsetTenant
// -----------------------------------------------------------------------------
func TestRLS_Session_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class := seedClassForSession(t, db, centerUUID)
	insertSessionRaw(t, db, centerUUID, class, time.Now().Add(24*time.Hour), nil)

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM sessions WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d sessions rows, expected 0", count)
	}
}

// -----------------------------------------------------------------------------
// WITH CHECK on UPDATE (tenant cannot reparent own session to another center).
// Mirrors TestRLS_Class_TenantCannotReparentOwnRow — dropping WITH CHECK would
// pass every other RLS test silently.
// -----------------------------------------------------------------------------
func TestRLS_Session_TenantCannotReparentOwnRow(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	centerAUUID := uuid.UUID(centerA.ID.Bytes)
	classA := seedClassForSession(t, db, centerAUUID)
	rowID := insertSessionRaw(t, db, centerAUUID, classA, time.Now().Add(24*time.Hour), nil)

	if _, err := db.Exec(ctx, "SAVEPOINT sp_sess_reparent"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	_, updateErr := db.Exec(ctx, `UPDATE sessions SET center_id = $1 WHERE id = $2`, centerB.ID, rowID)
	if updateErr != nil {
		if _, rbErr := db.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_sess_reparent"); rbErr != nil {
			t.Fatalf("rollback savepoint: %v", rbErr)
		}
	} else {
		if _, relErr := db.Exec(ctx, "RELEASE SAVEPOINT sp_sess_reparent"); relErr != nil {
			t.Fatalf("release savepoint: %v", relErr)
		}
	}
	var storedCenter uuid.UUID
	if scanErr := db.QueryRow(ctx, `SELECT center_id FROM sessions WHERE id = $1`, rowID).Scan(&storedCenter); scanErr != nil {
		t.Fatalf("re-read after UPDATE (err=%v): %v", updateErr, scanErr)
	}
	if storedCenter != centerAUUID {
		t.Errorf("RLS VIOLATION: tenant A reparented own session row to tenant B (stored=%v, expected=%v)", storedCenter, centerAUUID)
	}
}

// -----------------------------------------------------------------------------
// class_id ON DELETE RESTRICT (Winston fold) — a class with sessions cannot be
// hard-deleted out from under its taught-session history.
// -----------------------------------------------------------------------------
func TestSessions_ClassDeleteRestrict(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	class := seedClassForSession(t, db, centerUUID)
	insertSessionRaw(t, db, centerUUID, class, time.Now().Add(24*time.Hour), nil)

	_, err := db.Exec(ctx, `DELETE FROM classes WHERE id = $1`, class)
	if err == nil {
		t.Error("FK VIOLATION expected: deleting a class WITH sessions must be blocked by ON DELETE RESTRICT (never orphan/destroy taught-session history)")
	}
}

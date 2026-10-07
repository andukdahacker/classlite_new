// Story 3.1 — store-layer integration tests (real DB in tx, RLS enforced).
// Covers AC3 (due_dates_enabled DB default) + RLS write isolation for the new
// UpdateClass query. List/ByTeacher/UpdateClassStatus are exercised against the
// real DB by the service ATDD (class_lifecycle_atdd_test.go).
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func pgUUIDForTest(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

// AC3 — classes.due_dates_enabled DB DEFAULT is false. A raw insert that omits
// the column must yield false, verified via the shipped GetClassByID query
// (which now returns the full Story 3.1 row). updated_at DEFAULT now() must
// also populate on insert.
func TestClass_DueDatesEnabled_DBDefaultFalse_Store(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	classID := insertClassRaw(t, db, uuid.UUID(center.ID.Bytes), "DueDates Default")

	row, err := generated.New(db).GetClassByID(ctx, pgUUIDForTest(classID))
	if err != nil {
		t.Fatalf("GetClassByID: %v", err)
	}
	if row.DueDatesEnabled {
		t.Errorf("AC3: due_dates_enabled = true, want DB default false")
	}
	if !row.UpdatedAt.Valid {
		t.Errorf("updated_at should be non-null (DEFAULT now() fires on insert)")
	}
}

// Story 10.2 AC7 — UpdateClassStatus stamps classes.ended_at ONLY on the →ended
// transition (the archive anchor), and leaves it untouched on any other
// transition. The CAS guard (expected_status) is preserved throughout.
func TestClass_UpdateClassStatus_StampsEndedAt_Store(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	classID := insertClassRaw(t, db, uuid.UUID(center.ID.Bytes), "Stamp ended_at")
	q := generated.New(db)

	// upcoming → active: a NON-ended transition must NOT stamp ended_at.
	active, err := q.UpdateClassStatus(ctx, generated.UpdateClassStatusParams{
		ID:             pgUUIDForTest(classID),
		NewStatus:      "active",
		ExpectedStatus: "upcoming",
	})
	if err != nil {
		t.Fatalf("UpdateClassStatus(→active): %v", err)
	}
	if active.EndedAt.Valid {
		t.Errorf("AC7: ended_at must stay NULL on a non-ended transition, got %v", active.EndedAt.Time)
	}

	// active → ended: stamps ended_at = now().
	ended, err := q.UpdateClassStatus(ctx, generated.UpdateClassStatusParams{
		ID:             pgUUIDForTest(classID),
		NewStatus:      "ended",
		ExpectedStatus: "active",
	})
	if err != nil {
		t.Fatalf("UpdateClassStatus(→ended): %v", err)
	}
	if !ended.EndedAt.Valid {
		t.Errorf("AC7: →ended must stamp a non-null ended_at")
	}

	// CAS guard still holds — a stale expected_status matches 0 rows.
	if _, err := q.UpdateClassStatus(ctx, generated.UpdateClassStatusParams{
		ID:             pgUUIDForTest(classID),
		NewStatus:      "ended",
		ExpectedStatus: "active", // stale: the row is already 'ended'
	}); err == nil {
		t.Errorf("AC7: CAS guard must reject a stale expected_status (0 rows → error)")
	}
}

// AC6/RLS — the new UpdateClass query respects RLS write isolation: tenant A
// cannot mutate tenant B's class. The row is invisible under tenant A's RLS
// scope, so the :one RETURNING update matches 0 rows (no-rows error) and the
// tenant B row is unchanged.
func TestRLS_Class_CrossTenantUpdateClass_Store(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	classB := insertClassRaw(t, db, uuid.UUID(centerB.ID.Bytes), "B Class")

	TenantContext(t, db, centerA.ID)
	_, err := generated.New(db).UpdateClass(ctx, generated.UpdateClassParams{
		ID:   pgUUIDForTest(classB),
		Name: pgtype.Text{String: "Hacked", Valid: true},
	})
	if err == nil {
		t.Fatalf("AC6/RLS: cross-tenant UpdateClass succeeded, want a no-rows error")
	}

	TenantContext(t, db, centerB.ID)
	var name string
	if err := db.QueryRow(ctx, `SELECT name FROM classes WHERE id = $1`, classB).Scan(&name); err != nil {
		t.Fatalf("refetch as tenant B: %v", err)
	}
	if name == "Hacked" {
		t.Errorf("RLS VIOLATION: cross-tenant UpdateClass mutated tenant B's class")
	}
}

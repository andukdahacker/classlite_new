// Story 9-1a, AC2 + AC19 — RLS cross-tenant isolation on the GREENFIELD
// `ai_credits` table (one row per center; monthly_allocation/monthly_used/
// addon_remaining/reset_at — the enforcement source-of-truth for the balance,
// D14). Same 5-case grid as subscriptions/ai_credit_ledger.
//
// RED: fails until migration T1 creates `ai_credits` with ENABLE+FORCE RLS +
// tenant SELECT/INSERT/UPDATE policies and CHECKs (monthly_used>=0, addon_remaining>=0).
package test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func insertAICreditsRawTx(t *testing.T, db *TxDB, centerID uuid.UUID, allocation, used, addon int) error {
	t.Helper()
	_, err := db.Exec(context.Background(),
		`INSERT INTO ai_credits (id, center_id, monthly_allocation, monthly_used, addon_remaining, reset_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		uuid.New(), centerID, allocation, used, addon, time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
	)
	return err
}

func TestRLS_AICredits_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	TenantContext(t, db, centerB.ID)
	if err := insertAICreditsRawTx(t, db, uuid.UUID(centerB.ID.Bytes), 500, 0, 0); err != nil {
		t.Fatalf("seed tenant B ai_credits: %v", err)
	}

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM ai_credits WHERE center_id = $1", uuid.UUID(centerB.ID.Bytes)).Scan(&visible); err != nil {
		t.Fatalf("count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B ai_credits rows, expected 0", visible)
	}
}

func TestRLS_AICredits_CrossTenantUpdate(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	// Write isolation is the subtle one — an UPDATE hitting 0 rows is not an error
	// in Postgres, so verify B's balance is UNCHANGED after A tries to drain it.
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	TenantContext(t, db, centerB.ID)
	if err := insertAICreditsRawTx(t, db, uuid.UUID(centerB.ID.Bytes), 500, 100, 0); err != nil {
		t.Fatalf("seed tenant B ai_credits: %v", err)
	}

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	_, _ = db.Exec(ctx, "UPDATE ai_credits SET monthly_used = 999999 WHERE center_id = $1", uuid.UUID(centerB.ID.Bytes))

	TenantContext(t, db, centerB.ID)
	var used int
	if err := db.QueryRow(ctx, "SELECT monthly_used FROM ai_credits WHERE center_id = $1", uuid.UUID(centerB.ID.Bytes)).Scan(&used); err != nil {
		t.Fatalf("re-read B ai_credits: %v", err)
	}
	if used != 100 {
		t.Errorf("RLS VIOLATION: cross-tenant UPDATE mutated B monthly_used to %d, expected unchanged 100", used)
	}
}

func TestRLS_AICredits_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	if err := insertAICreditsRawTx(t, db, uuid.UUID(center.ID.Bytes), 0, 0, 0); err != nil {
		t.Fatalf("seed ai_credits: %v", err)
	}

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM ai_credits WHERE center_id = $1", uuid.UUID(center.ID.Bytes)).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d ai_credits rows, expected 0", count)
	}
}

func TestRLS_AICredits_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	if err := insertAICreditsRawTx(t, db, uuid.UUID(center.ID.Bytes), 0, 0, 0); err != nil {
		t.Fatalf("seed ai_credits: %v", err)
	}

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM ai_credits WHERE center_id = $1", uuid.UUID(center.ID.Bytes)).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d ai_credits rows, expected 0", count)
	}
}

// Positive control.
func TestRLS_AICredits_SameTenantVisible(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	if err := insertAICreditsRawTx(t, db, uuid.UUID(center.ID.Bytes), 500, 0, 0); err != nil {
		t.Fatalf("seed ai_credits: %v", err)
	}

	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM ai_credits WHERE center_id = $1", uuid.UUID(center.ID.Bytes)).Scan(&visible); err != nil {
		t.Fatalf("count own ai_credits: %v", err)
	}
	if visible != 1 {
		t.Errorf("RLS OVER-RESTRICTION: own tenant saw %d of its own ai_credits rows, expected 1", visible)
	}
}

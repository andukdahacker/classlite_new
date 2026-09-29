// Story 9-1a, AC1 + AC19 — RLS cross-tenant isolation on the GREENFIELD
// `subscriptions` table (one row per center, holds plan/status). Mirrors
// ai_credit_ledger_rls_atdd_test.go: cross-tenant read + cross-tenant insert +
// null-tenant + unset-tenant + a same-tenant POSITIVE control (without it, a
// policy that blocks ALL reads would leave the expect-zero tests green).
//
// RED: fails until migration T1 creates `subscriptions` with ENABLE+FORCE RLS and
// the tenant SELECT/INSERT/UPDATE policies (`center_id = current_setting('app.current_tenant_id')::uuid`).
package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// insertSubscriptionRawTx inserts a subscription under the current tenant (via TxDB).
func insertSubscriptionRawTx(t *testing.T, db *TxDB, centerID uuid.UUID, planName string) error {
	t.Helper()
	_, err := db.Exec(context.Background(),
		`INSERT INTO subscriptions (id, center_id, plan, billing_cycle, status, current_period_start)
		 VALUES ($1, $2, $3, 'monthly', 'active', now())`,
		uuid.New(), centerID, planName,
	)
	return err
}

func TestRLS_Subscriptions_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	TenantContext(t, db, centerB.ID)
	if err := insertSubscriptionRawTx(t, db, uuid.UUID(centerB.ID.Bytes), "pro"); err != nil {
		t.Fatalf("seed tenant B subscription: %v", err)
	}

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM subscriptions WHERE center_id = $1", uuid.UUID(centerB.ID.Bytes)).Scan(&visible); err != nil {
		t.Fatalf("count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B subscription rows, expected 0", visible)
	}
}

func TestRLS_Subscriptions_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)

	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")

	TenantContext(t, db, centerA.ID)
	err := insertSubscriptionRawTx(t, db, uuid.UUID(centerB.ID.Bytes), "studio") // spoof into B
	AssertRLSViolation(t, err, "subscriptions cross-tenant INSERT")
}

func TestRLS_Subscriptions_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	if err := insertSubscriptionRawTx(t, db, uuid.UUID(center.ID.Bytes), "free"); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM subscriptions WHERE center_id = $1", uuid.UUID(center.ID.Bytes)).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d subscription rows, expected 0", count)
	}
}

func TestRLS_Subscriptions_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	if err := insertSubscriptionRawTx(t, db, uuid.UUID(center.ID.Bytes), "free"); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM subscriptions WHERE center_id = $1", uuid.UUID(center.ID.Bytes)).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d subscription rows, expected 0", count)
	}
}

// Positive control — own tenant sees its own row.
func TestRLS_Subscriptions_SameTenantVisible(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	if err := insertSubscriptionRawTx(t, db, uuid.UUID(center.ID.Bytes), "free"); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}

	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM subscriptions WHERE center_id = $1", uuid.UUID(center.ID.Bytes)).Scan(&visible); err != nil {
		t.Fatalf("count own subscription: %v", err)
	}
	if visible != 1 {
		t.Errorf("RLS OVER-RESTRICTION: own tenant saw %d of its own subscription rows, expected 1", visible)
	}
}

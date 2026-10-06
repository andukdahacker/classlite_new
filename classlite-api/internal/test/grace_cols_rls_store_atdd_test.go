// Story 9-3, AC17 — the STORE-LEVEL RLS adversarial proof for the new grace-tracking columns
// (code-review P6, 2026-10-06). The shipped grace_cross_tenant_rls_atdd_test.go proves write
// isolation at the SERVICE level (center A's HandleGraceTick leaves B byte-identical); AC17 /
// TEST-BE-1 also owe a STORE-level cross-tenant UPDATE adversarial over the raw grace columns —
// an UPDATE hitting 0 rows is not an error in Postgres, so RLS must silently filter a cross-
// tenant write to zero rows and leave the victim's grace state byte-identical. Both directions,
// deterministic tenant IDs, RLS never disabled. Mirrors subscriptions_rls_atdd_test.go.
package test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// seedGraceColsTx puts a subscription into a known in-grace state under the current tenant.
func seedGraceColsTx(t *testing.T, db *TxDB, centerID uuid.UUID, retryCount int) {
	t.Helper()
	if err := insertSubscriptionRawTx(t, db, centerID, "pro"); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	failedAt := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	if _, err := db.Exec(context.Background(),
		`UPDATE subscriptions
		    SET status = 'past_due', grace_period_start = $2, payment_failed_at = $2, grace_retry_count = $3
		  WHERE center_id = $1`,
		centerID, failedAt, retryCount); err != nil {
		t.Fatalf("seed grace cols: %v", err)
	}
}

// TestRLS_SubscriptionGraceCols_CrossTenantUpdate is the AC17 store-level write-isolation proof:
// a tenant can never mutate another center's grace columns. A cross-tenant UPDATE matches 0 rows
// under RLS (not an error), so the victim's status / grace_period_start / payment_failed_at /
// grace_retry_count must be byte-identical afterward — in BOTH directions.
func TestRLS_SubscriptionGraceCols_CrossTenantUpdate(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	TenantContext(t, db, centerB.ID)
	seedGraceColsTx(t, db, uuid.UUID(centerB.ID.Bytes), 2)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	seedGraceColsTx(t, db, uuid.UUID(centerA.ID.Bytes), 0)

	// A attempts to clear/forge B's grace state (the SetPastDueWithGrace/ClearGrace shape).
	_, _ = db.Exec(ctx,
		`UPDATE subscriptions
		    SET status = 'active', grace_period_start = NULL, payment_failed_at = NULL, grace_retry_count = 999
		  WHERE center_id = $1`, uuid.UUID(centerB.ID.Bytes))

	// B re-reads its OWN grace state — must be unchanged.
	TenantContext(t, db, centerB.ID)
	var status string
	var graceStart, failedAt *time.Time
	var retry int
	if err := db.QueryRow(ctx,
		`SELECT status, grace_period_start, payment_failed_at, grace_retry_count
		   FROM subscriptions WHERE center_id = $1`, uuid.UUID(centerB.ID.Bytes),
	).Scan(&status, &graceStart, &failedAt, &retry); err != nil {
		t.Fatalf("re-read B grace state: %v", err)
	}
	if status != "past_due" || retry != 2 || graceStart == nil || failedAt == nil {
		t.Errorf("RLS VIOLATION: A's cross-tenant UPDATE mutated B grace state: status=%q retry=%d graceStart=%v failedAt=%v (want past_due/2/non-nil/non-nil)",
			status, retry, graceStart, failedAt)
	}

	// Reverse direction — B attempts to forge A's grace state; A must be untouched.
	_, _ = db.Exec(ctx,
		`UPDATE subscriptions
		    SET status = 'past_due', grace_retry_count = 777
		  WHERE center_id = $1`, uuid.UUID(centerA.ID.Bytes))
	TenantContext(t, db, centerA.ID)
	var aStatus string
	var aRetry int
	if err := db.QueryRow(ctx,
		`SELECT status, grace_retry_count FROM subscriptions WHERE center_id = $1`,
		uuid.UUID(centerA.ID.Bytes),
	).Scan(&aStatus, &aRetry); err != nil {
		t.Fatalf("re-read A grace state: %v", err)
	}
	if aStatus != "past_due" || aRetry != 0 {
		t.Errorf("RLS VIOLATION: B's cross-tenant UPDATE mutated A grace state: status=%q retry=%d (want past_due/0)", aStatus, aRetry)
	}
}

// TestRLS_SubscriptionGraceCols_SameTenantUpdates is the positive control — a center CAN update
// its own grace columns (without it, a policy blocking all UPDATEs would leave the test above
// green for the wrong reason).
func TestRLS_SubscriptionGraceCols_SameTenantUpdates(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	seedGraceColsTx(t, db, uuid.UUID(center.ID.Bytes), 1)

	tag, err := db.Exec(ctx,
		`UPDATE subscriptions SET grace_retry_count = 2 WHERE center_id = $1`, uuid.UUID(center.ID.Bytes))
	if err != nil {
		t.Fatalf("same-tenant grace update: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Errorf("RLS OVER-RESTRICTION: same-tenant grace UPDATE affected %d rows, expected 1", tag.RowsAffected())
	}
}

// Story 9-2a — AC26 / D20 (RLS cross-tenant isolation on the NEW Polar tables). Mirrors
// subscriptions_rls_atdd_test.go: cross-tenant READ + WRITE isolation in BOTH directions on
// `invoices`, `subscriptions` (the new pending_* cols), `center_resource_baselines`, and
// `billing_checkout_intents` — tenant A must not SELECT or UPDATE tenant B's rows (and each
// read test also asserts the same-tenant POSITIVE control, without which a blanket-deny policy
// would false-green the expect-zero assertions). ALSO documents that `polar_webhook_events`
// has NO RLS BY DESIGN (global dedup, pre-tenant) — a row is visible regardless of tenant.
//
// GREEN-PHASE SEAMS:
//   · migrations (T1): invoices (RLS + UNIQUE polar_order_id), billing_checkout_intents (RLS),
//       center_resource_baselines (RLS), subscriptions pending_plan/pending_billing_cycle/
//       pending_effective_at cols, polar_webhook_events (event_id PK, NO RLS).
//   · service.SetPlanFromPolar(ctx, tc, tier, cycle, polarSubID, periodStart, periodEnd) — referenced
//       in rlsCompileFailAnchor below ONLY to make this file a COMPILE-fail red alongside the rest of
//       the 9-2a set (the tables it exercises don't exist yet → without the seam reference the file
//       would merely RUNTIME-fail once compiled). SetPlanFromPolar is never invoked at runtime here.
//
// RED: compile-fails on service.SetPlanFromPolar (rlsCompileFailAnchor).

package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/plan"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// rlsCompileFailAnchor references the 9-2a apply seam so this RLS file COMPILE-fails with the
// rest of the red set. Never called.
func rlsCompileFailAnchor(ctx context.Context, tc model.TenantContext) error {
	var svc *service.BillingService
	return svc.SetPlanFromPolar(ctx, tc, plan.Pro, "monthly", newPolarSubID(),
		billingEpoch, billingEpoch.AddDate(0, 1, 0))
}

// --- raw inserts under the current tenant (via TxDB) ---------------------------------------

func insertInvoiceRawTx(t *testing.T, db *TxDB, centerID pgtype.UUID) error {
	t.Helper()
	_, err := db.Exec(context.Background(),
		`INSERT INTO invoices (id, center_id, polar_order_id, amount_vnd, currency, status)
		 VALUES ($1, $2, $3, 100000, 'VND', 'paid')`,
		uuid.New(), centerID, "order_"+uuid.NewString(),
	)
	return err
}

func insertCheckoutIntentRawTx(t *testing.T, db *TxDB, centerID pgtype.UUID) error {
	t.Helper()
	_, err := db.Exec(context.Background(),
		`INSERT INTO billing_checkout_intents (id, center_id, kind, target_plan, target_billing_cycle, polar_checkout_id, status)
		 VALUES ($1, $2, 'upgrade', 'pro', 'monthly', $3, 'pending')`,
		uuid.New(), centerID, "co_"+uuid.NewString(),
	)
	return err
}

func insertResourceBaselineRawTx(t *testing.T, db *TxDB, centerID pgtype.UUID) error {
	t.Helper()
	_, err := db.Exec(context.Background(),
		`INSERT INTO center_resource_baselines (center_id, resource_class, high_water_count, captured_at)
		 VALUES ($1, 1, 5, now())`,
		centerID,
	)
	return err
}

// --- invoices --------------------------------------------------------------------------------

func TestRLS_Invoices_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	TenantContext(t, db, centerB.ID)
	if err := insertInvoiceRawTx(t, db, centerB.ID); err != nil {
		t.Fatalf("seed tenant B invoice: %v", err)
	}

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM invoices WHERE center_id = $1", centerB.ID).Scan(&visible); err != nil {
		t.Fatalf("count invoices as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B invoice rows, expected 0", visible)
	}

	// Positive control (both-directions): tenant B sees its own row.
	TenantContext(t, db, centerB.ID)
	var own int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM invoices WHERE center_id = $1", centerB.ID).Scan(&own); err != nil {
		t.Fatalf("count own invoices as tenant B: %v", err)
	}
	if own != 1 {
		t.Errorf("RLS OVER-RESTRICTION: tenant B saw %d of its own invoice rows, expected 1", own)
	}
}

func TestRLS_Invoices_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")

	TenantContext(t, db, centerA.ID)
	err := insertInvoiceRawTx(t, db, NewPGUUIDFromString(TenantBID)) // spoof into B
	AssertRLSViolation(t, err, "invoices cross-tenant INSERT")
}

// --- billing_checkout_intents ----------------------------------------------------------------

func TestRLS_CheckoutIntents_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	TenantContext(t, db, centerB.ID)
	if err := insertCheckoutIntentRawTx(t, db, centerB.ID); err != nil {
		t.Fatalf("seed tenant B checkout intent: %v", err)
	}

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM billing_checkout_intents WHERE center_id = $1", centerB.ID).Scan(&visible); err != nil {
		t.Fatalf("count checkout intents as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B checkout-intent rows, expected 0", visible)
	}

	TenantContext(t, db, centerB.ID)
	var own int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM billing_checkout_intents WHERE center_id = $1", centerB.ID).Scan(&own); err != nil {
		t.Fatalf("count own checkout intents as tenant B: %v", err)
	}
	if own != 1 {
		t.Errorf("RLS OVER-RESTRICTION: tenant B saw %d of its own checkout-intent rows, expected 1", own)
	}
}

func TestRLS_CheckoutIntents_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")

	TenantContext(t, db, centerA.ID)
	err := insertCheckoutIntentRawTx(t, db, NewPGUUIDFromString(TenantBID))
	AssertRLSViolation(t, err, "billing_checkout_intents cross-tenant INSERT")
}

// --- center_resource_baselines ---------------------------------------------------------------

func TestRLS_ResourceBaselines_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	TenantContext(t, db, centerB.ID)
	if err := insertResourceBaselineRawTx(t, db, centerB.ID); err != nil {
		t.Fatalf("seed tenant B baseline: %v", err)
	}

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM center_resource_baselines WHERE center_id = $1", centerB.ID).Scan(&visible); err != nil {
		t.Fatalf("count baselines as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B baseline rows, expected 0", visible)
	}

	TenantContext(t, db, centerB.ID)
	var own int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM center_resource_baselines WHERE center_id = $1", centerB.ID).Scan(&own); err != nil {
		t.Fatalf("count own baselines as tenant B: %v", err)
	}
	if own != 1 {
		t.Errorf("RLS OVER-RESTRICTION: tenant B saw %d of its own baseline rows, expected 1", own)
	}
}

func TestRLS_ResourceBaselines_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")

	TenantContext(t, db, centerA.ID)
	err := insertResourceBaselineRawTx(t, db, NewPGUUIDFromString(TenantBID))
	AssertRLSViolation(t, err, "center_resource_baselines cross-tenant INSERT")
}

// --- subscriptions pending_* (UPDATE-only) ---------------------------------------------------

// TestRLS_SubscriptionsPending_CrossTenantWrite proves tenant A's UPDATE of tenant B's new
// pending_plan column silently affects 0 rows (RLS) — B's row is unchanged.
func TestRLS_SubscriptionsPending_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	TenantContext(t, db, centerB.ID)
	if err := insertSubscriptionRawTx(t, db, uuid.UUID(centerB.ID.Bytes), "pro"); err != nil {
		t.Fatalf("seed tenant B subscription: %v", err)
	}

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	// Attempt to schedule a downgrade on B's subscription from A's context.
	_, _ = db.Exec(ctx, "UPDATE subscriptions SET pending_plan = 'free' WHERE center_id = $1", centerB.ID)

	// Re-read as B — pending_plan must still be NULL (A's UPDATE never landed).
	TenantContext(t, db, centerB.ID)
	var pendingPlan *string
	if err := db.QueryRow(ctx, "SELECT pending_plan FROM subscriptions WHERE center_id = $1", centerB.ID).Scan(&pendingPlan); err != nil {
		t.Fatalf("read B pending_plan: %v", err)
	}
	if pendingPlan != nil {
		t.Errorf("RLS VIOLATION: tenant A set tenant B pending_plan = %q (cross-tenant UPDATE landed)", *pendingPlan)
	}
}

// --- polar_webhook_events (NO RLS by design) -------------------------------------------------

// TestRLS_PolarWebhookEvents_NoRLS_VisibleAcrossTenants documents that the global dedup table is
// intentionally NOT RLS-scoped (it is pre-tenant — the event is deduped before its center is
// resolved). A row inserted under tenant A is visible under tenant B: the isolation guarantee
// does NOT apply here by design, and the table carries no center_id.
func TestRLS_PolarWebhookEvents_NoRLS_VisibleAcrossTenants(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	eventID := newWebhookEventID()
	TenantContext(t, db, centerA.ID)
	if _, err := db.Exec(ctx,
		`INSERT INTO polar_webhook_events (event_id, event_type, payload_hash) VALUES ($1, 'order.paid', $2)`,
		eventID, "sha256:"+uuid.NewString(),
	); err != nil {
		t.Fatalf("insert webhook event under tenant A: %v", err)
	}

	// Switch to tenant B — the global dedup row is STILL visible (no RLS by design).
	TenantContext(t, db, centerB.ID)
	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM polar_webhook_events WHERE event_id = $1", eventID).Scan(&visible); err != nil {
		t.Fatalf("count webhook events as tenant B: %v", err)
	}
	if visible != 1 {
		t.Errorf("polar_webhook_events is global (no RLS): tenant B saw %d rows for %s, expected 1 (dedup must be tenant-agnostic)", visible, eventID)
	}
}

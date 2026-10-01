// Story 9-2a — AC29 / D18 (lost-webhook read-triggered reconcile). `POST /api/billing/checkout`
// persists a `billing_checkout_intents` row (status pending) BEFORE returning the hosted URL,
// but persists NOTHING about the eventual charge. If the confirming webhook never arrives
// (retries exhausted / endpoint-bug window) money left the card and we have no record the
// plan changed. AC29: on `GET /api/billing`, a pending intent past the threshold is polled
// against Polar and applied EXACTLY ONCE via the SAME idempotent apply path (D19/D22) — the
// plan upgrades, one invoice is snapshotted, one monthly grant is minted, and a SECOND
// `GET /api/billing` is a pure no-op.
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).CreateCheckout(ctx, tc, kind, plan, cycle, addonPackID string)
//       (checkoutURL string, err error)  — persists the pending billing_checkout_intents row (D18).
//   · service.NewBillingServiceWithPolar(db, clk, polarClient) *service.BillingService  — the
//       constructor that injects the Polar client so the reconcile path can poll it (the shared
//       NewBillingTestServerForRole hardwires NewBillingService and CANNOT inject the mock, so
//       this file builds its own owner-chain server around the injected service, mirroring
//       story_9_1a_helpers.newBillingSrv).
//   · internal/polar.NewMockClient(cfg polar.MockConfig) *polar.MockClient  — deterministic Polar
//       API mock; here it reports the checkout's order + subscription as PAID/active.
//   · migrations: billing_checkout_intents (D18) + the GET /api/billing read-triggered reconcile.
//
// FALSIFICATION: the "exactly once" claim is proven by the SECOND GET being a no-op — remove
// the intent status→applied transition (or the invoice UNIQUE(polar_order_id)) at green and this
// test MUST then double-apply (2 invoices / 2 monthly grants). Documented; value-scan not row-scan.
//
// RED: compile-fails on CreateCheckout + NewBillingServiceWithPolar + internal/polar.

package test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/polar"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/jackc/pgx/v5/pgtype"
)

// newPolarReconcileServer mirrors story_9_1a_helpers.newBillingSrv but wires a Polar-injected
// billing service (NewBillingServiceWithPolar + the deterministic mock) through the EXACT
// production owner chain, then attaches the caller's bearer via authInjectingHandler — the
// shared NewBillingTestServerForRole cannot inject the mock. Returns the handler + the live
// service (so the test can drive CreateCheckout on the same instance the GET reconciles).
func newPolarReconcileServer(t *testing.T, db storyDB, mock *polar.MockClient, userID pgtype.UUID, centerID, role string) (http.Handler, *service.BillingService) {
	t.Helper()
	markUserVerified(t, db, userID)

	billingSvc := service.NewBillingServiceWithPolar(db, clock.NewMockClock(billingEpoch), mock)
	billingHandler := handler.NewBillingHandler(billingSvc, clock.NewMockClock(billingEpoch))

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	requireOwner := middleware.RequireRole("owner")
	ownerChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(requireVerified(requireCenter(requireOwner(http.HandlerFunc(middleware.ErrorMapper(h))))))
	}
	mux := http.NewServeMux()
	mux.Handle("GET /api/billing", ownerChain(billingHandler.GetSummary))

	tok := SignAccessTokenForRole(t, userID, centerID, role)
	return &authInjectingHandler{next: mux, token: tok}, billingSvc
}

// getBilling drives GET /api/billing through the owner chain and returns the recorder.
func getBilling(t *testing.T, srv http.Handler) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/billing", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/billing = %d, want 200 (reconcile must not error): %s", rec.Code, rec.Body.String())
	}
	return rec
}

// TestPolarCheckoutReconcile_LostWebhook_AppliedExactlyOnce seeds a Pro-target checkout intent,
// DROPS the confirming webhook, and proves GET /api/billing reconciles it from Polar and applies
// the upgrade EXACTLY ONCE — a second GET is a no-op.
func TestPolarCheckoutReconcile_LostWebhook_AppliedExactlyOnce(t *testing.T) {
	db := SetupRawPool(t)
	// Start on Free; the dropped-webhook checkout upgrades to Pro (monthly).
	centerID, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))

	orderID := newAddonOrderID()
	polarSubID := newPolarSubID()

	// The mock reports the checkout's order + subscription as PAID/active — what the reconcile
	// poll (D18) sees when the webhook never arrived.
	mock := polar.NewMockClient(polar.MockConfig{
		PaidOrders: map[string]polar.MockOrder{
			orderID: {ID: orderID, Status: "paid", AmountVnd: 299000, Currency: "VND"},
		},
		Subscriptions: map[string]polar.MockSubscription{
			polarSubID: {
				ID:           polarSubID,
				Status:       "active",
				Plan:         "pro",
				Cycle:        "monthly",
				OrderID:      orderID,
				PeriodStart:  billingEpoch,
				PeriodEnd:    billingEpoch.AddDate(0, 1, 0),
				CheckoutPaid: true,
			},
		},
	})

	srv, svc := newPolarReconcileServer(t, db, mock, NewPGUUIDFromString(tc.UserID), tc.CenterID, "owner")

	// Persist the pending intent (D18) — the hosted URL is returned; NO webhook is delivered.
	url, err := svc.CreateCheckout(context.Background(), tc, "upgrade", "pro", "monthly", "")
	if err != nil {
		t.Fatalf("CreateCheckout (upgrade→pro): %v", err)
	}
	if !strings.HasPrefix(url, "http") {
		t.Fatalf("CreateCheckout returned a non-URL checkout target: %q", url)
	}
	// DROP THE WEBHOOK: ProcessPolarEvent is never called.

	// Reconcile #1 — the pending intent is polled + applied once.
	_ = getBilling(t, srv)

	if plan, _, _, subID := readSubscriptionPlan(t, centerID); plan != "pro" {
		t.Errorf("after reconcile plan = %q, want pro (the dropped-webhook upgrade)", plan)
	} else if subID == nil || *subID != polarSubID {
		t.Errorf("polar_subscription_id = %v, want bound to %s after reconcile", subID, polarSubID)
	}
	if n := countInvoices(t, centerID); n != 1 {
		t.Errorf("invoices after reconcile = %d, want exactly 1 (one snapshotted charge)", n)
	}
	if n := countLedgerByReason(t, centerID, "monthly_grant"); n != 1 {
		t.Errorf("monthly_grant ledger rows = %d, want exactly 1 (one grant on upgrade)", n)
	}

	// Reconcile #2 — the intent is already applied → pure no-op (value-scan: still 1 / 1).
	_ = getBilling(t, srv)
	if n := countInvoices(t, centerID); n != 1 {
		t.Errorf("invoices after SECOND GET = %d, want still 1 (reconcile is idempotent, not re-applied)", n)
	}
	if n := countLedgerByReason(t, centerID, "monthly_grant"); n != 1 {
		t.Errorf("monthly_grant ledger rows after SECOND GET = %d, want still 1 (no double-grant)", n)
	}
	assertLedgerChainIntegrity(t, centerID)
}

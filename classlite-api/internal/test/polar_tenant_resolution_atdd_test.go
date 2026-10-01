// Story 9-2a — AC31 / D20 (SEC-6/7 confused-deputy tenant resolution). On the FIRST-ever
// subscription there is no persisted `polar_subscription_id` yet, so `center_id` must be
// resolved via the `billing_checkout_intents` (polar_checkout_id) → persisted
// `polar_subscription_id` → metadata chain, and the first `subscription.updated` binds the
// mapping. The CONFUSED-DEPUTY guard: once a subscription id is bound to center A, a SIGNED
// event whose `data.id` maps to A but whose `metadata.center_id = B` must apply to A (or be
// rejected) — the PERSISTED MAPPING WINS, NEVER the body's value. A leaked/replayed secret
// event that names an attacker's center must never grant to it.
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).ProcessPolarEvent(ctx, eventID, eventType string, body []byte) error
//       — resolves the tenant via the D20 chain + confused-deputy guard, then dispatches.
//   · (svc *service.BillingService).CreateCheckout(...) — persists the pending intent that
//       anchors first-event tenant resolution (D18/D20).
//   · service.NewBillingServiceWithPolar(db, clk, polarClient) + internal/polar.NewMockClient.
//
// FALSIFICATION: remove the confused-deputy guard at green and TestPolarTenantResolution_ConfusedDeputy
// MUST then leak the grant into center B (B's plan changes / B gets credits). Value-scan: assert
// B's plan is UNCHANGED and B has zero granted credits, not merely that A changed.
//
// RED: compile-fails on ProcessPolarEvent + CreateCheckout + NewBillingServiceWithPolar + internal/polar.

package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/polar"
	"github.com/ducdo/classlite-api/internal/service"
)

// newPolarEventService builds a Polar-injected billing service on the raw pool (committed
// rows, superuser — RLS handled inside the service via SET LOCAL tenant). The mock is inert
// for the event-apply paths (events carry their own authoritative period per D17), but the
// injected constructor is the compile-fail seam shared across the 9-2a event reds.
func newPolarEventService(t *testing.T) *service.BillingService {
	t.Helper()
	return service.NewBillingServiceWithPolar(SetupRawPool(t), clock.NewMockClock(billingEpoch), polar.NewMockClient(polar.MockConfig{}))
}

// TestPolarTenantResolution_FirstSubscriptionUpdated_BindsTenant proves the FIRST
// subscription.updated for a brand-new subscription (no polar_subscription_id yet) resolves
// the center via the checkout-intent chain and BINDS polar_subscription_id to it.
func TestPolarTenantResolution_FirstSubscriptionUpdated_BindsTenant(t *testing.T) {
	ctx := context.Background()
	centerID, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	svc := newPolarEventService(t)

	polarSubID := newPolarSubID()

	// Anchor the tenant: a pending upgrade checkout intent exists for this center (D18) —
	// the polar_checkout_id → center_id mapping the first event resolves through.
	if _, err := svc.CreateCheckout(ctx, tc, "upgrade", "pro", "monthly", ""); err != nil {
		t.Fatalf("CreateCheckout (anchor intent): %v", err)
	}

	// FIRST event for a subscription id we have never seen bound anywhere.
	if plan, _, _, subID := readSubscriptionPlan(t, centerID); subID != nil {
		t.Fatalf("precondition: polar_subscription_id should be NULL before the first event (plan=%s)", plan)
	}
	body := polarSubscriptionUpdated(centerID, polarSubID, "pro", "monthly",
		billingEpoch, billingEpoch.AddDate(0, 1, 0))
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), "subscription.updated", body); err != nil {
		t.Fatalf("ProcessPolarEvent (first subscription.updated): %v", err)
	}

	plan, _, _, subID := readSubscriptionPlan(t, centerID)
	if subID == nil || *subID != polarSubID {
		t.Errorf("polar_subscription_id = %v, want bound to %s after the first event", subID, polarSubID)
	}
	if plan != "pro" {
		t.Errorf("plan = %q, want pro after the first subscription.updated", plan)
	}
}

// TestPolarTenantResolution_ConfusedDeputy proves a SIGNED subscription.updated whose data.id
// is bound to center A but whose metadata.center_id = B applies to A (or is rejected) and
// NEVER touches B. B's plan stays free and B receives zero credits.
func TestPolarTenantResolution_ConfusedDeputy(t *testing.T) {
	ctx := context.Background()
	svc := newPolarEventService(t)

	// Center A: bind a subscription id to it via a first event (through its intent anchor).
	centerA, tcA := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	polarSubID := newPolarSubID()
	if _, err := svc.CreateCheckout(ctx, tcA, "upgrade", "pro", "monthly", ""); err != nil {
		t.Fatalf("CreateCheckout for A: %v", err)
	}
	bind := polarSubscriptionUpdated(centerA, polarSubID, "pro", "monthly",
		billingEpoch, billingEpoch.AddDate(0, 1, 0))
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), "subscription.updated", bind); err != nil {
		t.Fatalf("bind A's subscription: %v", err)
	}

	// Center B: the attacker-named victim — untouched Free, zero credits.
	centerB, _ := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	bBaseCredits := readAICredits(t, centerB)

	// A SIGNED event whose data.id ∈ A but whose metadata.center_id = B (leaked/replayed secret).
	// polarSubscriptionUpdated stamps metadata.center_id from its first arg → point it at B while
	// keeping the SAME polarSubID (bound to A).
	spoof := polarSubscriptionUpdated(centerB, polarSubID, "studio", "annual",
		billingEpoch, billingEpoch.AddDate(1, 0, 0))
	// Apply-to-A-or-reject is both acceptable (D20) — what is NOT acceptable is any write to B.
	_ = svc.ProcessPolarEvent(ctx, newWebhookEventID(), "subscription.updated", spoof)

	// B MUST be untouched — the persisted mapping wins, never the body's center_id.
	if plan, _, _, _ := readSubscriptionPlan(t, centerB); plan != "free" {
		t.Errorf("CONFUSED-DEPUTY LEAK: center B plan = %q, want unchanged free (spoofed metadata must not apply to B)", plan)
	}
	if got := readAICredits(t, centerB); got.Allocation != bBaseCredits.Allocation || got.Addon != bBaseCredits.Addon {
		t.Errorf("CONFUSED-DEPUTY LEAK: center B credits changed (alloc %d→%d, addon %d→%d) — spoofed event granted to B",
			bBaseCredits.Allocation, got.Allocation, bBaseCredits.Addon, got.Addon)
	}
	_ = centerA
}

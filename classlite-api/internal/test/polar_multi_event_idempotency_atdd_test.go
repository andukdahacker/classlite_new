// Story 9-2a — AC30 / AC14 / D19 (Winston+Murat+Amelia BLOCKER: one charge = many events).
// One logical upgrade charge emits MULTIPLE distinct webhook events (order.paid AND
// subscription.updated), each a different webhook-id — event-id dedup alone does NOT cover
// them. The dispatcher maps EXACTLY ONE event per side-effect: order.paid → invoice snapshot;
// subscription.updated/.active → plan/period apply (D17). Plan-apply is idempotent by a
// target-state check, invoices by UNIQUE(polar_order_id) + ON CONFLICT DO NOTHING. So both
// events for one charge → exactly one invoice, one monthly grant, one plan change.
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).ProcessPolarEvent(ctx, eventID, eventType string,
//         body []byte) error — the one-tx dedup + dispatch. order.paid and subscription.updated
//         route to disjoint effects; a re-delivered event_id is a whole-tx no-op.
//   · migrations: invoices UNIQUE(polar_order_id), polar_webhook_events PK dedup.
//
// RED: compile-fails on svc.ProcessPolarEvent.

package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

// TestMultiEvent_OrderPaidAndSubUpdated_OneChargeOneEffect is the AC30 assertion: the SAME
// upgrade charge delivered as an order.paid AND a subscription.updated (two DISTINCT
// event_ids, one shared order_id) yields exactly one invoice, one monthly grant, one plan
// change — order.paid must not grant the plan, subscription.updated must not snapshot a
// second invoice.
func TestMultiEvent_OrderPaidAndSubUpdated_OneChargeOneEffect(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	centerID, _ := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	grantsBefore := countLedgerByReason(t, centerID, "monthly_grant")

	orderID := newAddonOrderID()
	polarSubID := newPolarSubID()
	periodStart := billingEpoch
	periodEnd := billingEpoch.AddDate(0, 1, 0)

	// Event 1: the paid order → invoice snapshot for orderID.
	orderBody := polarOrderPaidAddon(centerID, orderID, addonPack500ID, addonPack500ProVnd)
	if err := svc.ProcessPolarEvent(context.Background(), newWebhookEventID(), "order.paid", orderBody); err != nil {
		t.Fatalf("ProcessPolarEvent order.paid: %v", err)
	}
	// Event 2: the subscription apply for the SAME charge (upgrade to Studio) → plan/period + grant.
	subBody := polarSubscriptionUpdatedForOrder(centerID, polarSubID, "studio", "monthly", orderID, periodStart, periodEnd)
	if err := svc.ProcessPolarEvent(context.Background(), newWebhookEventID(), "subscription.updated", subBody); err != nil {
		t.Fatalf("ProcessPolarEvent subscription.updated: %v", err)
	}

	if n := countInvoicesByOrder(t, orderID); n != 1 {
		t.Errorf("invoices for order %s = %d, want exactly 1 (both events must not each snapshot — UNIQUE polar_order_id)", orderID, n)
	}
	if got := countLedgerByReason(t, centerID, "monthly_grant") - grantsBefore; got != 1 {
		t.Errorf("monthly_grant delta = %d, want exactly 1 (order.paid must not grant; only the plan-apply grants once)", got)
	}
	if gotPlan, _, _, _ := readSubscriptionPlan(t, centerID); gotPlan != "studio" {
		t.Errorf("plan = %s, want studio (exactly one plan change from the pair)", gotPlan)
	}
}

// TestMultiEvent_SameEventIDTwice_OneEffect is the simpler AC14: the SAME subscription.updated
// event (SAME event_id) delivered twice grants once, changes the plan once, and dedups the
// event row — the second delivery is a whole no-op.
func TestMultiEvent_SameEventIDTwice_OneEffect(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	centerID, _ := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	grantsBefore := countLedgerByReason(t, centerID, "monthly_grant")

	eventID := newWebhookEventID()
	body := polarSubscriptionUpdated(centerID, newPolarSubID(), "studio", "monthly", billingEpoch, billingEpoch.AddDate(0, 1, 0))

	for i := 0; i < 2; i++ {
		if err := svc.ProcessPolarEvent(context.Background(), eventID, "subscription.updated", body); err != nil {
			t.Fatalf("ProcessPolarEvent delivery %d: %v", i+1, err)
		}
	}

	if got := countLedgerByReason(t, centerID, "monthly_grant") - grantsBefore; got != 1 {
		t.Errorf("monthly_grant delta = %d, want exactly 1 (duplicate event_id double-granted)", got)
	}
	if n := countWebhookEvents(t, eventID); n != 1 {
		t.Errorf("polar_webhook_events rows for %s = %d, want exactly 1 (PK dedup)", eventID, n)
	}
	if gotPlan, _, _, _ := readSubscriptionPlan(t, centerID); gotPlan != "studio" {
		t.Errorf("plan = %s, want studio (exactly one plan change)", gotPlan)
	}
}

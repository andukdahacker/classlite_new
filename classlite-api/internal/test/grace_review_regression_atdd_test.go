// Story 9-3 code-review regressions (2026-10-06, Ducdo "patch now"):
//
//	· D1 — recovery must inspect the ACTUAL payment, not just event type: a past_due center
//	  that buys an AI add-on pack (order.paid) must NOT have its dunning clock cleared (a
//	  revenue-bypass hole — buying cheap credits would cancel the failed subscription's grace).
//	· D3 — a payment failure WRITES a 'declined' invoice (so the s70 history + the declined-only
//	  Retry render a real row), and recovery WITHIN the window transitions it 'declined' → 'paid'.
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/jackc/pgx/v5/pgtype"
)

// countInvoicesByStatus counts the center's invoices in a given Polar status (D3).
func countInvoicesByStatus(t *testing.T, centerID pgtype.UUID, status string) int {
	return scanCount(t,
		`SELECT count(*) FROM invoices WHERE center_id = $1 AND status = $2`, centerID, status)
}

// TestGraceRecovery_AddonPurchaseDoesNotRecover is the D1 revenue-bypass regression: a past_due
// center buys an add-on pack (order.paid with an addon_pack_id). The add-on grant still applies,
// but grace is NOT cleared and the pending ticks are NOT cancelled — the failed SUBSCRIPTION
// renewal is still unpaid, so the 7-day clock must keep running to the day-7 downgrade.
func TestGraceRecovery_AddonPurchaseDoesNotRecover(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	svc := service.NewBillingServiceWithClock(pool, clk)
	svc.SetEmailSender(&service.MockEmailSender{})

	centerID, _ := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	subID := newPolarSubID()
	bindPolarSubscription(t, centerID, subID)
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), polarPaymentFailedType, polarPaymentFailed(centerID, subID)); err != nil {
		t.Fatalf("enter grace: %v", err)
	}

	// Buy an add-on pack mid-grace.
	clk.Set(graceDay(2))
	orderID := newPolarSubID()
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), "order.paid",
		polarOrderPaidAddon(centerID, orderID, addonPack500ID, addonPack500ProVnd)); err != nil {
		t.Fatalf("order.paid addon: %v", err)
	}

	// Grace is STILL active — the add-on did not recover the subscription.
	if status, graceStart, _, _ := readGraceState(t, centerID); status != "past_due" || graceStart == nil {
		t.Errorf("after add-on purchase: status=%q graceStart=%v, want past_due/non-nil (buying credits must NOT clear a failed subscription's grace)", status, graceStart)
	}
	if n := countPendingGraceTicks(t, centerID); n == 0 {
		t.Error("pending grace ticks were cancelled by an add-on purchase — the dunning clock must keep running (D1 revenue-bypass)")
	}
	// The add-on purchase itself still succeeded (a paid invoice snapshot exists for the order).
	if n := countInvoicesByOrder(t, orderID); n != 1 {
		t.Errorf("add-on order invoice count = %d, want 1 (the purchase still applies even though it doesn't recover)", n)
	}
}

// TestGrace_WritesDeclinedInvoice_RecoveryMarksPaid is the D3 regression: entering grace writes a
// 'declined' invoice; recovery within the window flips the latest declined row to 'paid'.
func TestGrace_WritesDeclinedInvoice_RecoveryMarksPaid(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	svc := service.NewBillingServiceWithClock(pool, clk)
	svc.SetEmailSender(&service.MockEmailSender{})

	periodStart := billingEpoch
	periodEnd := billingEpoch.AddDate(0, 1, 0)
	centerID, _ := newBillingCenter(t, "pro", 500, 0, 0, periodEnd)
	subID := newPolarSubID()
	bindPolarSubscription(t, centerID, subID)

	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), polarPaymentFailedType, polarPaymentFailed(centerID, subID)); err != nil {
		t.Fatalf("enter grace: %v", err)
	}
	if n := countInvoicesByStatus(t, centerID, "declined"); n != 1 {
		t.Fatalf("declined invoices after grace entry = %d, want 1 (D3 — the failed charge must snapshot a declined row)", n)
	}

	// Recover before day 7.
	clk.Set(graceDay(3))
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), "subscription.active",
		polarRecoveryActive(centerID, subID, "pro", "monthly", periodStart, periodEnd)); err != nil {
		t.Fatalf("recovery: %v", err)
	}
	if n := countInvoicesByStatus(t, centerID, "declined"); n != 0 {
		t.Errorf("declined invoices after recovery = %d, want 0 (the declined row must transition to paid)", n)
	}
	if n := countInvoicesByStatus(t, centerID, "paid"); n != 1 {
		t.Errorf("paid invoices after recovery = %d, want 1 (declined → paid on recovery)", n)
	}
}

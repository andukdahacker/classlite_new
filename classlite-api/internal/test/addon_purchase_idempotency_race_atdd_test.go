// Story 9-2a — AC33 / AC24 / D22 (Murat: re-runs the 9-1a D17 double-credit bug + Amelia).
// The D8 ordering (addon_remaining += then INSERT ledger) mutates the BALANCE before the
// ON CONFLICT is evaluated, so a bypassed-dedup replay double-credits even though the ledger
// row dedups; AND the 9-1a InsertCreditLedgerRow arbiters on (ref_job_id,reason) which for an
// addon row (ref_job_id NULL, NULLs distinct) NEVER fires. FIX (D22): a SEPARATE
// InsertAddonPurchaseLedgerRow with ON CONFLICT (ref_purchase_id,reason) DO NOTHING over a
// FULL unique index; order = INSERT ledger FIRST → check rows-affected → touch addon_remaining
// + invoices ONLY if a row landed. This is the D15/D23 two-connection race (a single shared tx
// physically cannot contend on the index): a rendezvous barrier fires both deliveries at once;
// the loser's whole tx rolls back → ZERO mutation. Assert the BALANCE VALUE delta, not a count.
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).ProcessPolarEvent(ctx, eventID, eventType string, body []byte) error
//       — one-tx dedup + ledger-first add-on grant.
//   · migrations: polar_webhook_events PK, invoices UNIQUE(polar_order_id),
//       ai_credit_ledger FULL UNIQUE(ref_purchase_id,reason), InsertAddonPurchaseLedgerRow.
//
// NO-GUARD CONTROLS (D22/Murat — documented falsifications, SKIP-guarded until a green build
// can toggle the guards): (A) event dedup OFF, inner ledger-first STILL yields ONE top-up;
// (B) BOTH guards OFF → double-grant (2× addon_remaining) — proves both layers load-bearing.
//
// RED: compile-fails on svc.ProcessPolarEvent.

package test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

const addonRaceTimeout = 30 * time.Second

// TestAddonPurchase_ConcurrentSameOrder_LedgerFirstOneGrant delivers the SAME add-on
// order.paid on two independent committed connections at once. Exactly one must grant the
// pack's credits (value delta == pack.credits), one addon_purchase ledger row, one invoice;
// the loser mutates nothing.
func TestAddonPurchase_ConcurrentSameOrder_LedgerFirstOneGrant(t *testing.T) {
	pool := SetupRawPool(t)
	// Pro center, no add-on yet → after exactly one grant addon_remaining == pack credits.
	centerID, _ := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	before := readAddonRemaining(t, centerID)
	eventID := newWebhookEventID()
	orderID := newAddonOrderID()
	body := polarOrderPaidAddon(centerID, orderID, addonPack500ID, addonPack500ProVnd)

	var (
		wg      sync.WaitGroup
		start   = make(chan struct{}) // rendezvous barrier — both deliveries fire at once
		results = make([]error, 2)
	)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			results[idx] = svc.ProcessPolarEvent(context.Background(), eventID, "order.paid", body)
		}(i)
	}
	close(start)

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(addonRaceTimeout):
		t.Fatal("add-on purchase race timed out (possible deadlock in the one-tx ledger-first grant)")
	}

	// Value-scan (D22): the BALANCE delta is exactly one pack, never two, never zero.
	if got := readAddonRemaining(t, centerID) - before; got != addonPack500Credits {
		t.Errorf("addon_remaining delta = %d, want %d (duplicate delivery double-granted OR both rolled back)", got, addonPack500Credits)
	}
	if n := countLedgerByReason(t, centerID, "addon_purchase"); n != 1 {
		t.Errorf("addon_purchase ledger rows = %d, want exactly 1 (FULL UNIQUE(ref_purchase_id,reason))", n)
	}
	if n := countInvoicesByOrder(t, orderID); n != 1 {
		t.Errorf("invoices for order %s = %d, want exactly 1 (UNIQUE polar_order_id)", orderID, n)
	}
	assertLedgerChainIntegrity(t, centerID)
}

// TestAddonPurchase_NoEventDedupControl_LedgerFirstStillOne is control (A): with ONLY the
// outer polar_webhook_events dedup removed, the inner ledger-first (ref_purchase_id,reason)
// idempotency MUST still yield exactly ONE top-up. Enable after green with the event dedup off.
func TestAddonPurchase_NoEventDedupControl_LedgerFirstStillOne(t *testing.T) {
	t.Skip("D22 control (A): enable after green with the polar_webhook_events dedup removed; the ledger-first FULL-index guard must STILL yield addon_remaining delta == pack.credits exactly once.")
}

// TestAddonPurchase_BothGuardsOff_DoubleGrant is control (B): with BOTH the event dedup AND
// the ledger-first (ref_purchase_id,reason) guard removed, the same two-delivery race MUST
// double-grant (2× pack credits) — proving both idempotency layers are load-bearing.
func TestAddonPurchase_BothGuardsOff_DoubleGrant(t *testing.T) {
	t.Skip("D22 control (B): enable after green with BOTH guards removed; expect addon_remaining delta == 2×pack.credits (double-grant) to prove the guards are load-bearing.")
}

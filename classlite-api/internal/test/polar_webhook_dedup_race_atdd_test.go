// Story 9-2a — AC6/AC34 (D2/D19/D22/D23, money score-7 — the WF-8 gate).
// The outer idempotency layer is the polar_webhook_events PK. It is race-safe ONLY if the
// event-row INSERT and the state mutation share ONE tx on ONE connection (Murat F2): a
// check-then-act or insert-commit-then-dispatch lets two concurrent same-event_id
// deliveries BOTH mutate. This is the D15 two-connection harness (TEST-BE-2's single shared
// tx physically cannot contend on a PK), with a rendezvous barrier + a no-dedup control.
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · service.BillingService.ProcessPolarEvent(ctx, eventID, eventType string, body []byte) error
//       — verifies-already-done upstream; this owns the ONE tx: INSERT polar_webhook_events
//         (dedup) + resolve center + dispatch (add-on grant → ledger-first D22) atomically.
//         The loser of a same-event_id race gets a unique_violation → its whole tx rolls
//         back → ZERO mutation (not merely a 200).
//   · migrations: polar_webhook_events (event_id PK, no RLS), invoices (UNIQUE polar_order_id),
//       ai_credit_ledger FULL UNIQUE(ref_purchase_id,reason), InsertAddonPurchaseLedgerRow.
//
// NO-DEDUP CONTROL (Murat/D15): after green, remove the polar_webhook_events dedup and
// re-run — this test MUST then double-grant (2× addon_remaining). That falsification proves
// the dedup is load-bearing. Documented; the control variant is TestPolarWebhookDedup_NoGuardControl.
//
// RED: compile-fails on service.ProcessPolarEvent.

package test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

const webhookDedupRaceTimeout = 30 * time.Second

// TestPolarWebhookDedup_ConcurrentSameEvent_ExactlyOneMutation delivers the SAME add-on
// order.paid event (same webhook-id) on two independent committed connections at once.
// Exactly one must grant credits; the loser must mutate nothing.
func TestPolarWebhookDedup_ConcurrentSameEvent_ExactlyOneMutation(t *testing.T) {
	pool := SetupRawPool(t)
	// Pro center, no add-on yet; a paid 500-pack must land exactly once → addon_remaining == 500.
	centerID, _ := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	eventID := newWebhookEventID()
	orderID := newAddonOrderID()
	body := polarOrderPaidAddon(centerID, orderID, addonPack500ID, addonPack500ProVnd)

	var (
		wg      sync.WaitGroup
		start   = make(chan struct{}) // rendezvous barrier — both fire at once
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
	case <-time.After(webhookDedupRaceTimeout):
		t.Fatal("dedup race timed out (possible deadlock in the one-tx dedup+dispatch)")
	}

	// Exactly one delivery took effect — assert the VALUE, not just a row count (D22 value-scan).
	if got := readAddonRemaining(t, centerID); got != addonPack500Credits {
		t.Errorf("addon_remaining = %d, want %d (duplicate delivery double-granted OR both rolled back)", got, addonPack500Credits)
	}
	if n := countLedgerByReason(t, centerID, "addon_purchase"); n != 1 {
		t.Errorf("addon_purchase ledger rows = %d, want exactly 1", n)
	}
	if n := countInvoicesByOrder(t, orderID); n != 1 {
		t.Errorf("invoices for order %s = %d, want exactly 1 (UNIQUE polar_order_id)", orderID, n)
	}
	if n := countWebhookEvents(t, eventID); n != 1 {
		t.Errorf("polar_webhook_events rows for %s = %d, want exactly 1 (PK dedup)", eventID, n)
	}
	assertLedgerChainIntegrity(t, centerID)
}

// TestPolarWebhookDedup_NoGuardControl documents the falsification: with the dedup removed
// the same two-delivery race MUST double-grant. It is SKIP-guarded until a green build can
// toggle the guard off (the dev flips this on when running the control, per D15).
func TestPolarWebhookDedup_NoGuardControl(t *testing.T) {
	t.Skip("D15 no-guard control: enable after green with the polar_webhook_events dedup removed; expect addon_remaining == 1000 (double-grant) to prove the dedup is load-bearing.")
}

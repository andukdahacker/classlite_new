// Story 9-1a, AC14 (reconciliation across a reset) + AC28 (concurrent lazy-reset
// race). These are the two reds party-mode flagged as the silent-money killers:
//
//	AC14 — `ai_credits.available == latest_ledger.balance_after` MUST hold ACROSS
//	a monthly reset. The v0.1 "sum(deltas)==available" invariant is FALSE across a
//	reset (reset zeroes monthly_used + FORFEITS the unused monthly remainder; the
//	ledger only appends). The reset `monthly_grant` row must set balance_after =
//	new_allocation + addon and delta = balance_after - prev, so the forfeit is
//	auditable with no phantom inflation. Seeded used=300 (200 unused) proves the
//	forfeit: post-reset+1-spend available MUST be 499, NEVER 699.
//
//	AC28 — two concurrent consumes crossing reset_at must produce EXACTLY ONE
//	monthly_grant row and advance reset_at EXACTLY one month (the (center,credit)
//	lock serializes the reset; without it you get a double grant or a skipped month).
//
// RED: compile-fails on service.NewBillingServiceWithClock.
package test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

func TestCredit_ReconciliationAcrossReset_ForfeitsUnusedMonthly(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	// reset_at == billingEpoch → the first consume at billingEpoch triggers the
	// lazy reset. Seed used=300 of 500 → 200 unused that MUST be forfeited.
	centerID, tc := newBillingCenter(t, "pro", 500, 300, 0, billingEpoch)

	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	if err := svc.CheckAndConsumeCredit(ctx, tc, uuid.New()); err != nil {
		t.Fatalf("consume at reset boundary should succeed: %v", err)
	}

	snap := readAICredits(t, centerID)
	if snap.Available() != 499 {
		t.Fatalf("post-reset+1-spend available = %d, want 499 (500 fresh - 1; the 200 unused monthly credits must be FORFEITED, not carried → 699 is the D14 bug)", snap.Available())
	}
	if latest := latestLedgerBalanceAfter(t, centerID); latest != snap.Available() {
		t.Errorf("D14 VIOLATION: ai_credits.available=%d != latest ledger balance_after=%d", snap.Available(), latest)
	}
	assertLedgerChainIntegrity(t, centerID)
	if n := countLedgerByReason(t, centerID, "monthly_grant"); n != 1 {
		t.Errorf("expected exactly 1 monthly_grant row after one reset, got %d", n)
	}
	if want := billingEpoch.AddDate(0, 1, 0); !snap.ResetAt.Equal(want) {
		t.Errorf("reset_at = %s, want advanced exactly one month to %s", snap.ResetAt, want)
	}
}

func TestCredit_ConcurrentReset_ExactlyOneGrant(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	centerID, tc := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch) // reset_at == now → both consumes cross it

	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	for i := 0; i < 2; i++ {
		go func(idx int) { defer wg.Done(); errs[idx] = svc.CheckAndConsumeCredit(ctx, tc, uuid.New()) }(i)
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(creditRaceTimeout):
		t.Fatalf("concurrent-reset race hung within %s", creditRaceTimeout)
	}
	for _, e := range errs {
		if e != nil {
			t.Fatalf("both consumes have ample credit and should succeed, got %v", e)
		}
	}

	if n := countLedgerByReason(t, centerID, "monthly_grant"); n != 1 {
		t.Errorf("concurrent reset produced %d monthly_grant rows, want EXACTLY 1 (the (center,credit) lock must serialize the reset)", n)
	}
	snap := readAICredits(t, centerID)
	if snap.Used != 2 {
		t.Errorf("after one reset + two spends monthly_used = %d, want 2", snap.Used)
	}
	if want := billingEpoch.AddDate(0, 1, 0); !snap.ResetAt.Equal(want) {
		t.Errorf("reset_at = %s, want advanced EXACTLY one month to %s (not twice)", snap.ResetAt, want)
	}
}

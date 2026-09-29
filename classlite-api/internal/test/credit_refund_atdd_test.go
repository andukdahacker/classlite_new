// Story 9-1a, AC25 (D17) — refund correctness. Three landmines party-mode surfaced:
//  1. Double-refund is a no-op. The (ref_job_id, reason) unique index protects the
//     LEDGER insert, but ai_credits is a SEPARATE UPDATE — so refund must insert
//     the ledger row FIRST and touch ai_credits ONLY if a row was inserted, else
//     the second call double-credits before the ON CONFLICT is seen.
//  2. Refund across a reset boundary credits addon_remaining (never underflows
//     monthly_used below 0 — the deduction's period is already gone).
//  3. Refund of a never-deducted job is a no-op (never a free credit).
//
// SEAM: (*service.BillingService).RefundCredit(ctx, tc, refJobID) error.
// RED: compile-fails on service.NewBillingServiceWithClock.
package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

func TestCreditRefund_DoubleRefundIsNoOp(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	centerID, tc := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	job := uuid.New()
	if err := svc.CheckAndConsumeCredit(ctx, tc, job); err != nil {
		t.Fatalf("consume: %v", err)
	}
	if err := svc.RefundCredit(ctx, tc, job); err != nil {
		t.Fatalf("first refund: %v", err)
	}
	afterFirst := readAICredits(t, centerID).Available()

	if err := svc.RefundCredit(ctx, tc, job); err != nil {
		t.Fatalf("second refund (should be a silent no-op): %v", err)
	}
	afterSecond := readAICredits(t, centerID).Available()

	if afterFirst != afterSecond {
		t.Errorf("DOUBLE REFUND: available changed on 2nd refund (%d → %d), want unchanged", afterFirst, afterSecond)
	}
	if n := countLedgerByReason(t, centerID, "job_failed_refund"); n != 1 {
		t.Errorf("expected exactly 1 job_failed_refund row, got %d", n)
	}
}

func TestCreditRefund_AcrossResetGoesToAddon(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	centerID, tc := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch) // reset_at == now
	clk := clock.NewMockClock(billingEpoch)
	svc := service.NewBillingServiceWithClock(pool, clk)

	jobN := uuid.New() // deducted in period N (triggers the first reset + spends 1)
	if err := svc.CheckAndConsumeCredit(ctx, tc, jobN); err != nil {
		t.Fatalf("period-N consume: %v", err)
	}

	// Cross into period N+1: advance past the (now-advanced) reset_at, then a spend
	// resets monthly_used again.
	clk.Advance(32 * 24 * time.Hour)
	if err := svc.CheckAndConsumeCredit(ctx, tc, uuid.New()); err != nil {
		t.Fatalf("period-N+1 consume: %v", err)
	}

	// Refunding the period-N job now cannot un-count period N+1's monthly_used — it
	// MUST land in addon_remaining, never underflow monthly_used.
	if err := svc.RefundCredit(ctx, tc, jobN); err != nil {
		t.Fatalf("cross-reset refund: %v", err)
	}
	snap := readAICredits(t, centerID)
	if snap.Used < 0 {
		t.Fatalf("UNDERFLOW: monthly_used = %d (< 0) after cross-reset refund", snap.Used)
	}
	if snap.Addon != 1 {
		t.Errorf("cross-reset refund addon_remaining = %d, want 1 (refund of a prior-period deduction credits addon)", snap.Addon)
	}
}

func TestCreditRefund_NeverDeductedIsNoOp(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	centerID, tc := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	before := readAICredits(t, centerID).Available()
	if err := svc.RefundCredit(ctx, tc, uuid.New()); err != nil { // no prior deduction
		t.Fatalf("refund of never-deducted job should be a no-op, got err %v", err)
	}
	after := readAICredits(t, centerID).Available()
	if before != after {
		t.Errorf("refund of never-deducted job changed available (%d → %d) — a FREE CREDIT bug", before, after)
	}
	if n := countLedgerByReason(t, centerID, "job_failed_refund"); n != 0 {
		t.Errorf("refund of never-deducted job wrote %d refund rows, want 0", n)
	}
}

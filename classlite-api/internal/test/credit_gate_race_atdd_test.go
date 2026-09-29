// Story 9-1a, AC13 (R22 — the money race) — two concurrent AI jobs in the SAME
// center at available=1 must yield EXACTLY ONE spend + ONE 402. The read-then-
// write on the ai_credits row is a lost-update unless it runs under the
// per-center (center, credit=4) advisory lock (D13 — the v0.1 (center,user) key
// would let two different teachers clobber the one center row).
//
// MUST use SetupRawPool (two real committed txns) — SetupDB's single shared tx
// serializes the goroutines and would false-green a broken (unlocked) gate. This
// is the D15 concurrency harness the party-mode review demanded; it already
// exists (see storage_quota_race_test.go, grading_concurrency_test.go).
//
// NO-LOCK CONTROL (Murat): after green, remove the advisory lock in
// billing_service and re-run — this test MUST then fail with 2 successes. That
// falsification proves the lock is load-bearing, not decorative.
//
// RED: compile-fails on service.NewBillingServiceWithClock / InsufficientCreditsError.
package test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

const creditRaceTimeout = 30 * time.Second

func TestCredit_ConcurrentConsume_ExactlyOneWinsAtOne(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	centerID, tc := newBillingCenter(t, "pro", 1, 0, 0, billingEpoch.AddDate(0, 1, 0)) // available = 1

	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	var (
		wg   sync.WaitGroup
		errs [2]error
	)
	consume := func(idx int) {
		defer wg.Done()
		errs[idx] = svc.CheckAndConsumeCredit(ctx, tc, uuid.New())
	}
	wg.Add(2)
	go consume(0)
	go consume(1)

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(creditRaceTimeout):
		t.Fatalf("credit race hung — a CheckAndConsumeCredit goroutine did not complete within %s", creditRaceTimeout)
	}

	var successes, insufficient int
	for _, e := range errs {
		switch {
		case e == nil:
			successes++
		case errors.As(e, &service.InsufficientCreditsError{}):
			insufficient++
		default:
			t.Fatalf("unexpected CheckAndConsumeCredit error: %v", e)
		}
	}
	if successes != 1 || insufficient != 1 {
		t.Fatalf("expected exactly 1 spend + 1 INSUFFICIENT_CREDITS at available=1, got %d success / %d insufficient", successes, insufficient)
	}

	// The ai_credits row and the ledger must agree: exactly one -1 job_deduction landed.
	sp := SuperuserPool(t)
	var deductions int
	_ = sp.QueryRow(ctx,
		`SELECT count(*) FROM ai_credit_ledger WHERE center_id = $1 AND reason = 'job_deduction'`,
		centerID,
	).Scan(&deductions)
	if deductions != 1 {
		t.Errorf("expected exactly 1 job_deduction ledger row after the race, got %d", deductions)
	}
}

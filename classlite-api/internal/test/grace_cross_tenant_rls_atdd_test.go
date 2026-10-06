// Story 9-3 — AC17 cross-tenant isolation on the new grace surface (TEST-BE-1; WF-8 red added
// per the 2026-10-05 party-mode review MEDIUM finding: AC17 had no red and was absent from the
// traceability matrix). Two centers both in grace; center A's grace tick must act ONLY on A —
// never read or mutate B's subscription grace columns. A SET LOCAL / confused-deputy regression
// where A's tick bled into B's billing state would ship untested at a money gate otherwise.
//
// This is the service-level write-isolation proof (A's HandleGraceTick leaves B byte-identical).
// GREEN-PHASE also owes a store-level RLS adversarial test (a cross-tenant UPDATE of
// grace_period_start/payment_failed_at/grace_retry_count blocked both directions, deterministic
// tenant IDs, RLS never disabled) over the generated SetPastDueWithGrace/ClearGrace queries —
// tracked in the correct-course doc.
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).SetEmailSender(service.EmailSender)
//   · (svc *service.BillingService).HandleGraceTick(ctx, tc) error
//
// RED: compile-fails on svc.SetEmailSender / svc.HandleGraceTick.

package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

// TestGrace_CrossTenantTickIsolation asserts A's grace tick never touches B. Both centers enter
// grace at day 0 via their OWN bound subscription; only A's tick is driven at day 3. A advances
// (retry=1); B stays byte-identical (status, grace timestamps, retry all unchanged).
func TestGrace_CrossTenantTickIsolation(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	svc := service.NewBillingServiceWithClock(pool, clk)
	svc.SetEmailSender(&service.MockEmailSender{})

	centerA, tcA := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	centerB, _ := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	subA, subB := newPolarSubID(), newPolarSubID()
	bindPolarSubscription(t, centerA, subA)
	bindPolarSubscription(t, centerB, subB)

	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), polarPaymentFailedType, polarPaymentFailed(centerA, subA)); err != nil {
		t.Fatalf("enter grace A: %v", err)
	}
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), polarPaymentFailedType, polarPaymentFailed(centerB, subB)); err != nil {
		t.Fatalf("enter grace B: %v", err)
	}

	bStatusBefore, bGraceBefore, bFailedBefore, bRetryBefore := readGraceState(t, centerB)

	// Drive ONLY A's tick at day 3.
	clk.Set(graceDay(3))
	if err := svc.HandleGraceTick(ctx, tcA); err != nil {
		t.Fatalf("HandleGraceTick A: %v", err)
	}

	// A advanced.
	if _, _, _, aRetry := readGraceState(t, centerA); aRetry != 1 {
		t.Errorf("center A grace_retry_count after its day-3 tick = %d, want 1", aRetry)
	}
	// B is byte-identical — A's tick must not have touched B (RLS / per-center scoping).
	bStatusAfter, bGraceAfter, bFailedAfter, bRetryAfter := readGraceState(t, centerB)
	if bStatusAfter != bStatusBefore || bRetryAfter != bRetryBefore {
		t.Errorf("center B mutated by A's tick: status %q→%q, retry %d→%d (cross-tenant leak)", bStatusBefore, bStatusAfter, bRetryBefore, bRetryAfter)
	}
	if !eqTimePtr(bGraceAfter, bGraceBefore) || !eqTimePtr(bFailedAfter, bFailedBefore) {
		t.Error("center B grace timestamps mutated by A's tick (cross-tenant leak)")
	}
}

// eqTimePtr compares two nullable timestamps (both nil, or equal instants).
func eqTimePtr(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

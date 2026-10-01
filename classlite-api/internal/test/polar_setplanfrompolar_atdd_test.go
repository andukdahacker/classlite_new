// Story 9-2a — AC28 / D17 (the Winston+Murat+Amelia triple-convergence BLOCKER).
// The shipped SetPlan (billing_service.go:503) unconditionally re-grants a FULL allocation
// (zeroes monthly_used), stamps current_period_end = clk.Now()+1month (IGNORES annual), and
// writes status='active'. Routing every Polar subscription.updated through it double-grants
// mid-cycle, forfeits monthly_used, and desyncs our period from Polar's. D17 adds a dedicated
// period-from-payload, change-gated SetPlanFromPolar service method:
//   (a) a mid-cycle upgrade PRESERVES monthly_used (tops up to the new ceiling, never re-zeros)
//       AND adopts the Polar payload's period_end verbatim (annual honored, NOT now+1month);
//   (b) an unrelated subscription.updated (same plan/period) is a NO-OP on credits + period.
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).SetPlanFromPolar(ctx, tc model.TenantContext,
//         tier plan.Tier, cycle, polarSubID string, periodStart, periodEnd time.Time) error
//       — writes current_period_start/end FROM the payload (honors annual), persists
//         polar_subscription_id, grants the monthly allocation ONLY on a genuine plan-change
//         or period-rollover (period_start compare), preserving monthly_used on an upgrade.
//
// RED: compile-fails on svc.SetPlanFromPolar. No falsification control needed (non-concurrent).

package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/plan"
	"github.com/ducdo/classlite-api/internal/service"
)

// TestSetPlanFromPolar_MidCycleUpgrade_PreservesUsedAndAdoptsAnnualPeriod is the D17 (a)
// assertion: a Pro→Studio upgrade mid-cycle keeps monthly_used=300 (does NOT re-zero to a
// fresh full grant) and adopts the ANNUAL period_end from the Polar payload (one year out),
// never the SetPlan-invented now+1month.
func TestSetPlanFromPolar_MidCycleUpgrade_PreservesUsedAndAdoptsAnnualPeriod(t *testing.T) {
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	svc := service.NewBillingServiceWithClock(pool, clk)

	// Pro center mid-cycle: 500 allocation, 300 already used, 0 add-on. monthly_used=300 is
	// the value the re-zero bug would clobber (value-scan, not a row count).
	centerID, tc := newBillingCenter(t, "pro", 500, 300, 0, billingEpoch.AddDate(0, 1, 0))

	// The Polar payload carries an ANNUAL period a full year out — the authoritative bounds.
	periodStart := billingEpoch
	periodEnd := billingEpoch.AddDate(1, 0, 0)

	if err := svc.SetPlanFromPolar(context.Background(), tc, plan.Studio, "annual", newPolarSubID(), periodStart, periodEnd); err != nil {
		t.Fatalf("SetPlanFromPolar upgrade Pro→Studio: %v", err)
	}

	cr := readAICredits(t, centerID)
	if cr.Used != 300 {
		t.Errorf("monthly_used = %d, want 300 preserved (upgrade must NOT re-zero the used bucket — D17)", cr.Used)
	}
	if cr.Allocation != 2000 {
		t.Errorf("monthly_allocation = %d, want 2000 (topped up to the Studio ceiling)", cr.Allocation)
	}

	gotEnd := readSubscriptionPeriodEnd(t, centerID)
	if !gotEnd.Equal(periodEnd) {
		t.Errorf("current_period_end = %s, want the payload's annual end %s (period-from-payload — D17)", gotEnd, periodEnd)
	}
	if gotEnd.Equal(billingEpoch.AddDate(0, 1, 0)) {
		t.Errorf("current_period_end == now+1month — SetPlanFromPolar invented a monthly period instead of honoring the annual payload")
	}

	gotPlan, gotCycle, _, _ := readSubscriptionPlan(t, centerID)
	if gotPlan != "studio" || gotCycle != "annual" {
		t.Errorf("subscription = (%s,%s), want (studio,annual)", gotPlan, gotCycle)
	}
}

// TestSetPlanFromPolar_UnrelatedUpdate_NoOpOnCreditsAndPeriod is the D17 (b) assertion: a
// subscription.updated carrying the SAME plan/cycle/period as already stored (a payment-method
// or metadata edit) must NOT re-grant credits, re-zero monthly_used, or move the period.
func TestSetPlanFromPolar_UnrelatedUpdate_NoOpOnCreditsAndPeriod(t *testing.T) {
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	svc := service.NewBillingServiceWithClock(pool, clk)

	// seedSubscriptionRaw stored current_period_start=billingEpoch, end=billingEpoch+1month.
	centerID, tc := newBillingCenter(t, "pro", 500, 300, 0, billingEpoch.AddDate(0, 1, 0))
	beforeEnd := readSubscriptionPeriodEnd(t, centerID)
	grantsBefore := countLedgerByReason(t, centerID, "monthly_grant")

	// Same plan, same cycle, same period bounds → no genuine change → no-op.
	if err := svc.SetPlanFromPolar(context.Background(), tc, plan.Pro, "monthly", newPolarSubID(), billingEpoch, billingEpoch.AddDate(0, 1, 0)); err != nil {
		t.Fatalf("SetPlanFromPolar unrelated update: %v", err)
	}

	cr := readAICredits(t, centerID)
	if cr.Used != 300 {
		t.Errorf("monthly_used = %d, want 300 unchanged (unrelated update must be a credit no-op)", cr.Used)
	}
	if cr.Allocation != 500 {
		t.Errorf("monthly_allocation = %d, want 500 unchanged", cr.Allocation)
	}
	if n := countLedgerByReason(t, centerID, "monthly_grant"); n != grantsBefore {
		t.Errorf("monthly_grant ledger rows = %d, want %d unchanged (an unrelated subscription.updated re-granted credits)", n, grantsBefore)
	}
	if got := readSubscriptionPeriodEnd(t, centerID); !got.Equal(beforeEnd) {
		t.Errorf("current_period_end moved to %s on a no-op update, want %s unchanged", got, beforeEnd)
	}
}

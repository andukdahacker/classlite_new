// Story 9-2a — AC25 / AC37 / AC39 / D26 / D28 (R24 score-6 BUS: downgrade must NOT delete data).
// A downgrade takes effect AT RENEWAL: ScheduleDowngrade records a single pending intent (and
// schedules the change with Polar); the current plan/limits stay active until period end. When
// Polar fires subscription.updated at the boundary, the webhook applies the pending plan, clears
// the pending columns, re-points storage — deleting ZERO rows across every table (over-cap
// resources become blocked-for-new only). D28(c): assert no-delete via a PK-SET snapshot per
// table (NOT COUNT — delete+reinsert nets zero). D26: an upgrade CANCELS any pending downgrade;
// downgrade is single-slot (a second schedule replaces the first).
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).ScheduleDowngrade(ctx, tc, plan, cycle string) error — D9/D26
//   · (svc *service.BillingService).SetPlanFromPolar(...) — the at-renewal apply + the upgrade
//       that clears a pending downgrade (D26).
//   · (svc *service.BillingService).ProcessPolarEvent(...) — the renewal subscription.updated apply.
//   · migrations: subscriptions pending_plan/pending_billing_cycle/pending_effective_at columns.
//
// RED: compile-fails on svc.ScheduleDowngrade / svc.SetPlanFromPolar / svc.ProcessPolarEvent.

package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/plan"
	"github.com/ducdo/classlite-api/internal/service"
)

// downgradeSnapshotTables is the D28(c) no-delete table set — subscriptions is UPDATE-only,
// ai_credits/ledger survive, invoices append-only. All keyed by center_id.
var downgradeSnapshotTables = []string{"classes", "enrollments", "ai_credit_ledger", "subscriptions", "invoices"}

// TestDowngrade_ScheduleThenRenewal_ZeroRowsDeleted is the AC25/R24 assertion: a Studio center
// with classes+enrollments schedules a downgrade to Free, the MockClock advances to renewal, and
// the webhook applies the pending plan — every table's PK set is preserved (no row deleted).
func TestDowngrade_ScheduleThenRenewal_ZeroRowsDeleted(t *testing.T) {
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	svc := service.NewBillingServiceWithClock(pool, clk)

	// Studio center at its current period (end = billingEpoch+1month) with real classes/enrollments.
	centerID, tc := newBillingCenter(t, "studio", 2000, 0, 0, billingEpoch.AddDate(0, 1, 0))
	seedFreeClass(t, pool, tc, 3, 1) // 1 class, 3 active enrollments + 1 spare student

	before := make(map[string]map[string]struct{}, len(downgradeSnapshotTables))
	for _, tbl := range downgradeSnapshotTables {
		before[tbl] = pkSetSnapshot(t, tbl, centerID)
	}

	// Schedule the at-renewal downgrade to Free (current plan stays active now).
	if err := svc.ScheduleDowngrade(context.Background(), tc, "free", "monthly"); err != nil {
		t.Fatalf("ScheduleDowngrade to free: %v", err)
	}

	// Advance the clock past the renewal boundary and deliver Polar's period-end apply.
	renewalAt := billingEpoch.AddDate(0, 1, 0)
	clk.Set(renewalAt.Add(time.Second))
	applyBody := polarSubscriptionUpdated(centerID, newPolarSubID(), "free", "monthly", renewalAt, renewalAt.AddDate(0, 1, 0))
	if err := svc.ProcessPolarEvent(context.Background(), newWebhookEventID(), "subscription.updated", applyBody); err != nil {
		t.Fatalf("ProcessPolarEvent renewal apply: %v", err)
	}

	for _, tbl := range downgradeSnapshotTables {
		assertPKSetPreserved(t, tbl, before[tbl], pkSetSnapshot(t, tbl, centerID))
	}
	if gotPlan, _, _, _ := readSubscriptionPlan(t, centerID); gotPlan != "free" {
		t.Errorf("plan = %s, want free applied at renewal", gotPlan)
	}
	if pendingPlan, _ := readPendingDowngrade(t, centerID); pendingPlan != nil {
		t.Errorf("pending_plan = %v, want nil (cleared when the renewal applied it)", *pendingPlan)
	}
}

// TestDowngrade_ThenUpgrade_CancelsPending is the D26 assertion: an upgrade CANCELS a pending
// downgrade so the stale schedule never fires at renewal and dumps a just-upgraded owner.
func TestDowngrade_ThenUpgrade_CancelsPending(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	centerID, tc := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))

	if err := svc.ScheduleDowngrade(context.Background(), tc, "free", "monthly"); err != nil {
		t.Fatalf("ScheduleDowngrade to free: %v", err)
	}
	if pendingPlan, _ := readPendingDowngrade(t, centerID); pendingPlan == nil || *pendingPlan != "free" {
		t.Fatalf("pending_plan after schedule = %v, want \"free\"", pendingPlan)
	}

	// Upgrade Pro→Studio via the Polar apply path → must clear the pending downgrade (D26).
	if err := svc.SetPlanFromPolar(context.Background(), tc, plan.Studio, "monthly", newPolarSubID(), billingEpoch, billingEpoch.AddDate(0, 1, 0)); err != nil {
		t.Fatalf("SetPlanFromPolar upgrade to Studio: %v", err)
	}
	if pendingPlan, _ := readPendingDowngrade(t, centerID); pendingPlan != nil {
		t.Errorf("pending_plan = %v, want nil (the upgrade must cancel the pending downgrade — D26)", *pendingPlan)
	}
}

// TestDowngrade_TwoSchedules_SingleSlotLatestWins is the D26 single-slot assertion: a second
// ScheduleDowngrade REPLACES the first — only the latest is pending.
func TestDowngrade_TwoSchedules_SingleSlotLatestWins(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	centerID, tc := newBillingCenter(t, "studio", 2000, 0, 0, billingEpoch.AddDate(0, 1, 0))

	if err := svc.ScheduleDowngrade(context.Background(), tc, "pro", "monthly"); err != nil {
		t.Fatalf("ScheduleDowngrade #1 to pro: %v", err)
	}
	if err := svc.ScheduleDowngrade(context.Background(), tc, "free", "monthly"); err != nil {
		t.Fatalf("ScheduleDowngrade #2 to free: %v", err)
	}

	pendingPlan, _ := readPendingDowngrade(t, centerID)
	if pendingPlan == nil || *pendingPlan != "free" {
		t.Errorf("pending_plan = %v, want \"free\" (single-slot — the latest schedule replaces the first — D26)", pendingPlan)
	}
}

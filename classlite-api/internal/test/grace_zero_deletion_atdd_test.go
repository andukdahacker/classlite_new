// Story 9-3 — R24 (score-6 BUS: "Plan downgrade deletes data (NFR-6 says it must NOT)").
// WF-8 HARD ATDD gate. test-design-architecture.md:141 mitigation, verbatim: "Downgrade test
// asserts feature pause, NOT row deletion; restore test." This is the GRACE-EXPIRY path
// (payment_failed → day-7 HandleGraceTick → ExpireGraceToFree) sibling of the 9-2a
// downgrade_no_delete_atdd_test.go (scheduled-downgrade-at-renewal path) — same PK-set
// invariant, different trigger.
//
// D28(c) method: a delete+reinsert nets zero on COUNT, so assert no-delete via a PK-SET
// snapshot per table (pkSetSnapshot/assertPKSetPreserved, reused from story_9_2a_helpers.go).
// ai_credits is center-keyed (no id) → asserted by survival-count (countAICreditsRows).
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).SetEmailSender(service.EmailSender)
//   · (svc *service.BillingService).HandleGraceTick(ctx, tc) error — day-7 ExpireGraceToFree
//       via the 9-2a zero-deletion downgrade-apply path + CaptureResourceBaselines high-water.
//   · ProcessPolarEvent payment-failure + recovery (subscription.active) dispatch cases.
//
// Mock seams: real DB in tx (TEST-BE-1/2, RLS never disabled), MockClock (TEST-BE-5).
//
// RED: compile-fails on svc.SetEmailSender / svc.HandleGraceTick.

package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

// TestGraceExpiry_Day7Downgrade_ZeroRowsDeleted is the R24 hard invariant: a Studio center
// with real content across every table lapses through the 7-day grace clock to a day-7
// auto-downgrade to Free — and NOT ONE row is deleted from any table. Only state flags /
// plan / limits change.
func TestGraceExpiry_Day7Downgrade_ZeroRowsDeleted(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	svc := service.NewBillingServiceWithClock(pool, clk)
	svc.SetEmailSender(&service.MockEmailSender{}) // GREEN SEAM — day 0/3/5/6 emails need a sender

	centerID, tc := newBillingCenter(t, "studio", 2000, 0, 0, billingEpoch.AddDate(0, 1, 0))
	seedGraceContent(t, pool, centerID, tc) // classes/exercises/submissions/enrollments/files + ledger

	before := make(map[string]map[string]struct{}, len(graceSnapshotTables))
	for _, tbl := range graceSnapshotTables {
		before[tbl] = pkSetSnapshot(t, tbl, centerID)
	}
	aiCreditsBefore := countAICreditsRows(t, centerID)
	if aiCreditsBefore == 0 {
		t.Fatal("precondition: center has no ai_credits row to prove survives")
	}

	// Enter grace at day 0, then drive the clock straight to the day-7 downgrade tick.
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), polarPaymentFailedType, polarPaymentFailed(centerID, newPolarSubID())); err != nil {
		t.Fatalf("ProcessPolarEvent payment-failure: %v", err)
	}
	clk.Set(graceDeadline())
	if err := svc.HandleGraceTick(ctx, tc); err != nil {
		t.Fatalf("HandleGraceTick day 7: %v", err)
	}

	// The invariant: every id-keyed table's PK set is preserved (zero deletions).
	for _, tbl := range graceSnapshotTables {
		assertPKSetPreserved(t, tbl, before[tbl], pkSetSnapshot(t, tbl, centerID))
	}
	// ai_credits (center-keyed) survives too.
	if got := countAICreditsRows(t, centerID); got != aiCreditsBefore {
		t.Errorf("ai_credits rows after downgrade = %d, want %d (R24 — must not delete)", got, aiCreditsBefore)
	}
	// Only state changed.
	if plan, _, status, _ := readSubscriptionPlan(t, centerID); plan != "free" || status != "cancelled" {
		t.Errorf("after day-7 downgrade plan=%q status=%q, want free/cancelled", plan, status)
	}
}

// TestGraceExpiry_ThenReupgrade_RestoresFullAccess is the R24 restore half (C7/C10/AC10):
// after the day-7 auto-downgrade, a new successful charge (subscription.active) re-upgrades
// the center — and because nothing was ever deleted, full access is restored by flipping
// state alone, with every row still intact.
func TestGraceExpiry_ThenReupgrade_RestoresFullAccess(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	svc := service.NewBillingServiceWithClock(pool, clk)
	svc.SetEmailSender(&service.MockEmailSender{})

	centerID, tc := newBillingCenter(t, "studio", 2000, 0, 0, billingEpoch.AddDate(0, 1, 0))
	seedGraceContent(t, pool, centerID, tc)

	before := make(map[string]map[string]struct{}, len(graceSnapshotTables))
	for _, tbl := range graceSnapshotTables {
		before[tbl] = pkSetSnapshot(t, tbl, centerID)
	}

	// Lapse to day-7 Free.
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), polarPaymentFailedType, polarPaymentFailed(centerID, newPolarSubID())); err != nil {
		t.Fatalf("ProcessPolarEvent payment-failure: %v", err)
	}
	clk.Set(graceDeadline())
	if err := svc.HandleGraceTick(ctx, tc); err != nil {
		t.Fatalf("HandleGraceTick day 7: %v", err)
	}
	if plan, _, _, _ := readSubscriptionPlan(t, centerID); plan != "free" {
		t.Fatalf("precondition: plan after day 7 = %q, want free", plan)
	}

	// Re-upgrade: a new successful charge arrives (recovery path, epic:160).
	reupAt := graceDay(8)
	clk.Set(reupAt)
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), "subscription.active",
		polarRecoveryActive(centerID, newPolarSubID(), "studio", "monthly", reupAt, reupAt.AddDate(0, 1, 0))); err != nil {
		t.Fatalf("ProcessPolarEvent re-upgrade: %v", err)
	}

	// Full access restored by state flip; every original row still present.
	if plan, _, status, _ := readSubscriptionPlan(t, centerID); plan != "studio" || status != "active" {
		t.Errorf("after re-upgrade plan=%q status=%q, want studio/active", plan, status)
	}
	for _, tbl := range graceSnapshotTables {
		assertPKSetPreserved(t, tbl, before[tbl], pkSetSnapshot(t, tbl, centerID))
	}
}

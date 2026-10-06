// Story 9-3 — R21 (score-6 BUS: "Plan grace state machine: wrong-day transitions or emails").
// WF-8 HARD ATDD gate. The full MockClock time-travel suite the risk register mandates
// (test-design-architecture.md:137 — "Full time-travel suite with MockClock days 0/3/5/6/7").
//
// Hybrid dunning (D2): Polar owns the CHARGE; we own the TIMING. Polar's payment-failure
// webhook starts our clock; our MockClock-driven billing_grace_tick (D5) sends warning emails
// on days 0/3/5/6, requests Polar re-collect on days 3/5 (grace_retry_count++), and
// auto-downgrades to Free at day 7 — with ZERO row deletion (R24, its own file).
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).SetEmailSender(service.EmailSender) — grace emails need a
//       sender (BillingService has none today); setter mirrors SetCheckoutSuccessURL.
//   · (svc *service.BillingService).HandleGraceTick(ctx, tc) error — the per-center tick the
//       billing_grace_tick worker calls on dequeue (GFW-7/SEC-6). Elapsed-day action at clk.Now():
//       day 0/3/5/6 warning email, day 3/5 Polar re-collect + grace_retry_count++, day 7
//       ExpireGraceToFree, idempotent per day, reschedules the next tick.
//   · ProcessPolarEvent's NEW payment-failure dispatch case (enter grace + first tick).
//   · migrations 20261005120000+: subscriptions.grace_period_start/payment_failed_at/
//       grace_retry_count; the billing_grace_tick JobType.
//
// Mock seams honored: real DB in tx (TEST-BE-1/2, RLS never disabled, deterministic tenants
// via newBillingCenter), MockClock for ALL time-travel (TEST-BE-5 — never time.Sleep),
// MockEmailSender the email seam, internal/polar.MockClient the only Polar seam (real BANNED).
//
// RED: compile-fails on svc.SetEmailSender / svc.HandleGraceTick.

package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// graceDay returns the clock target for the grace-day-n EMAIL tick. Day index is the elapsed
// whole days since grace start (billingEpoch = day 0): floor((Now-start)/24h).
func graceDay(n int) time.Time { return billingEpoch.Add(time.Duration(n) * 24 * time.Hour) }

// graceDeadline is the day-7 auto-downgrade moment — Ducdo R1 (2026-10-06): honor "23:59",
// i.e. the END of the 7th calendar day after grace started (the full 7th day is grace). The
// downgrade must fire AT this instant and NOT before (an owner who pays at day-7 10:00 is still
// inside the promised window). The dev reconciles UTC vs VN-local; the red fixes the contract:
// downgrade is gated on reaching this deadline, not on +7×24h from a mid-day start.
func graceDeadline() time.Time {
	y, m, d := billingEpoch.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC).AddDate(0, 0, 7).Add(23*time.Hour + 59*time.Minute)
}

// TestGraceStateMachine_Days0357_EmailsRetriesThenDay7Downgrade is the R21 assertion: the
// payment-failure event enters grace at day 0; the MockClock advances through days
// 0/3/5/6/7 and each tick fires EXACTLY its day's action — warning emails on 0/3/5/6
// (cumulative 1/2/3/4), Polar re-collect requests on 3/5 (grace_retry_count 1 then 2), and
// the day-7 auto-downgrade to Free (status=cancelled, plan=free, grace cleared, ticks gone).
func TestGraceStateMachine_Days0357_EmailsRetriesThenDay7Downgrade(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	sender := &service.MockEmailSender{}
	svc := service.NewBillingServiceWithClock(pool, clk)
	svc.SetEmailSender(sender) // GREEN SEAM

	centerID, tc := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))

	// --- Day 0: payment-failure webhook enters grace + enqueues the first tick -----------
	// Bind the center's real polar_subscription_id first so the event resolves via the secure
	// persisted-mapping path (SEC-7 / 9-2a D20), not raw-body metadata trust.
	subID := newPolarSubID()
	bindPolarSubscription(t, centerID, subID)
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), polarPaymentFailedType, polarPaymentFailed(centerID, subID)); err != nil {
		t.Fatalf("ProcessPolarEvent payment-failure: %v", err)
	}
	status, graceStart, failedAt, retry := readGraceState(t, centerID)
	if status != "past_due" {
		t.Errorf("status after payment-failure = %q, want past_due", status)
	}
	if graceStart == nil || failedAt == nil {
		t.Errorf("grace_period_start=%v payment_failed_at=%v, want both set on grace entry", graceStart, failedAt)
	}
	if retry != 0 {
		t.Errorf("grace_retry_count on entry = %d, want 0", retry)
	}
	if n := countPendingGraceTicks(t, centerID); n == 0 {
		t.Error("no billing_grace_tick enqueued on grace entry (D5 — the first tick arms the clock)")
	}

	// --- Day 0 tick → first warning email (idempotent: entry-or-tick, exactly one) -------
	clk.Set(graceDay(0))
	mustTick(t, svc, ctx, tc, "day 0")
	if got := sender.Count(); got != 1 {
		t.Errorf("emails after day-0 tick = %d, want 1 (day-0 warning; idempotent — not double-sent)", got)
	}

	// --- Day 3 → warning email #2 + first Polar re-collect (grace_retry_count=1) ---------
	clk.Set(graceDay(3))
	mustTick(t, svc, ctx, tc, "day 3")
	if got := sender.Count(); got != 2 {
		t.Errorf("emails after day-3 tick = %d, want 2", got)
	}
	if _, _, _, retry = readGraceState(t, centerID); retry != 1 {
		t.Errorf("grace_retry_count after day 3 = %d, want 1 (one re-collect requested — AC4)", retry)
	}

	// --- Day 5 → warning email #3 + second re-collect (grace_retry_count=2) --------------
	clk.Set(graceDay(5))
	mustTick(t, svc, ctx, tc, "day 5")
	if got := sender.Count(); got != 3 {
		t.Errorf("emails after day-5 tick = %d, want 3", got)
	}
	if _, _, _, retry = readGraceState(t, centerID); retry != 2 {
		t.Errorf("grace_retry_count after day 5 = %d, want 2", retry)
	}

	// --- Day 6 → final warning email #4 (no retry on day 6) ------------------------------
	clk.Set(graceDay(6))
	mustTick(t, svc, ctx, tc, "day 6")
	if got := sender.Count(); got != 4 {
		t.Errorf("emails after day-6 tick = %d, want 4", got)
	}
	if _, _, _, retry = readGraceState(t, centerID); retry != 2 {
		t.Errorf("grace_retry_count after day 6 = %d, want 2 (day 6 warns only — no re-collect)", retry)
	}

	// --- Inside day 7 but BEFORE the 23:59 deadline → NO downgrade yet (R1 — honor the full day)
	clk.Set(graceDeadline().Add(-1 * time.Hour))
	mustTick(t, svc, ctx, tc, "day 7 pre-deadline")
	if plan, _, _, _ := readSubscriptionPlan(t, centerID); plan == "free" {
		t.Error("downgraded BEFORE the day-7 23:59 deadline — R1 requires honoring the full 7th day (an owner paying at day-7 10:00 is still in-window)")
	}

	// --- Day 7 at the 23:59 deadline → auto-downgrade to Free, zero deletion (C6/C7; R24) ------
	clk.Set(graceDeadline())
	mustTick(t, svc, ctx, tc, "day 7 deadline")
	plan, _, statusFinal, _ := readSubscriptionPlan(t, centerID)
	if plan != "free" {
		t.Errorf("plan after day 7 = %q, want free (auto-downgrade)", plan)
	}
	if statusFinal != "cancelled" {
		t.Errorf("status after day 7 = %q, want cancelled", statusFinal)
	}
	if _, graceStartAfter, _, _ := readGraceState(t, centerID); graceStartAfter != nil {
		t.Errorf("grace_period_start after downgrade = %v, want nil (grace cols cleared)", *graceStartAfter)
	}
	if n := countPendingGraceTicks(t, centerID); n != 0 {
		t.Errorf("pending grace ticks after downgrade = %d, want 0 (all cancelled)", n)
	}
}

// TestGraceStateMachine_NonScheduledDay_NoAction is the R21 boundary assertion: once the
// scheduled days through day 3 have been processed, a tick on a day with no scheduled action
// (e.g. day 4) sends NO new email and leaves grace_retry_count unchanged — only days 0/3/5/6/7
// do anything. (The day-3 tick fires first so the day-4 tick's no-op is a true boundary check,
// not masked by the day-3 catch-up — see TestGraceStateMachine_LateTick_CatchesUpSkippedDay.)
func TestGraceStateMachine_NonScheduledDay_NoAction(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	sender := &service.MockEmailSender{}
	svc := service.NewBillingServiceWithClock(pool, clk)
	svc.SetEmailSender(sender)

	centerID, tc := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	subID := newPolarSubID()
	bindPolarSubscription(t, centerID, subID)
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), polarPaymentFailedType, polarPaymentFailed(centerID, subID)); err != nil {
		t.Fatalf("ProcessPolarEvent payment-failure: %v", err)
	}
	clk.Set(graceDay(0))
	mustTick(t, svc, ctx, tc, "day 0")
	clk.Set(graceDay(3)) // process the day-3 scheduled action first
	mustTick(t, svc, ctx, tc, "day 3")
	before := sender.Count()
	_, _, _, retryBefore := readGraceState(t, centerID)

	// Day 4 — nothing scheduled, and day 3 already processed → a pure no-op.
	clk.Set(graceDay(4))
	mustTick(t, svc, ctx, tc, "day 4")

	if got := sender.Count(); got != before {
		t.Errorf("emails after day-4 tick = %d, want %d (day 4 is not a scheduled day)", got, before)
	}
	if _, _, _, retry := readGraceState(t, centerID); retry != retryBefore {
		t.Errorf("grace_retry_count after day-4 tick = %d, want %d (no re-collect on day 4)", retry, retryBefore)
	}
	if plan, _, _, _ := readSubscriptionPlan(t, centerID); plan == "free" {
		t.Error("plan downgraded to free on day 4 — must only downgrade at day 7")
	}
}

// TestGraceStateMachine_LateTick_CatchesUpSkippedDay is the code-review P2 regression (2026-10-06):
// a delayed/missed tick must NOT silently drop a skipped scheduled day. After the day-0 tick, the
// worker is idle through days 1–3 and only fires on day 4 — the tick must CATCH UP the skipped
// day-3 warning email + Polar re-collect (grace_retry_count++), not jump the marker past day 3.
func TestGraceStateMachine_LateTick_CatchesUpSkippedDay(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	sender := &service.MockEmailSender{}
	svc := service.NewBillingServiceWithClock(pool, clk)
	svc.SetEmailSender(sender)

	centerID, tc := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	subID := newPolarSubID()
	bindPolarSubscription(t, centerID, subID)
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), polarPaymentFailedType, polarPaymentFailed(centerID, subID)); err != nil {
		t.Fatalf("ProcessPolarEvent payment-failure: %v", err)
	}
	clk.Set(graceDay(0))
	mustTick(t, svc, ctx, tc, "day 0")
	emailsAfterDay0 := sender.Count()
	_, _, _, retryAfterDay0 := readGraceState(t, centerID)

	// Worker idle days 1–3; fires late on day 4. The skipped day-3 action must be caught up.
	clk.Set(graceDay(4))
	mustTick(t, svc, ctx, tc, "day 4 (late — catches up day 3)")

	if got := sender.Count(); got != emailsAfterDay0+1 {
		t.Errorf("emails after late day-4 tick = %d, want %d (the skipped day-3 warning must be sent)", got, emailsAfterDay0+1)
	}
	if _, _, _, retry := readGraceState(t, centerID); retry != retryAfterDay0+1 {
		t.Errorf("grace_retry_count after late day-4 tick = %d, want %d (the skipped day-3 re-collect must not be dropped)", retry, retryAfterDay0+1)
	}
	if plan, _, _, _ := readSubscriptionPlan(t, centerID); plan == "free" {
		t.Error("plan downgraded to free on day 4 — must only downgrade at day 7")
	}
}

// mustTick fires one grace tick and fails hard on error (keeps the time-travel body readable).
func mustTick(t *testing.T, svc *service.BillingService, ctx context.Context, tc model.TenantContext, label string) {
	t.Helper()
	if err := svc.HandleGraceTick(ctx, tc); err != nil {
		t.Fatalf("HandleGraceTick (%s): %v", label, err)
	}
}

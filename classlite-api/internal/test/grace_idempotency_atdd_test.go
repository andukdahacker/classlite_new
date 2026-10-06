// Story 9-3 — grace idempotency + recovery + confused-deputy (AC2 / AC5 / AC9; WF-8 reds).
// Companion to the R21 time-travel suite. Hardened per the 2026-10-05 party-mode review:
//   · AC2 — a re-delivered payment-failure event does NOT restart the clock or double-enqueue
//     ticks (PK dedup for an exact re-delivery; a target-state guard for a SECOND distinct
//     failure while already past_due — the 9-2a D19 idiom).
//   · AC5 — a grace tick re-run for an already-processed day is a no-op, on EVERY acting day
//     INCLUDING the email-only days 0 and 6 (not just the retry days 3/5). This forces a
//     persisted per-day high-water marker in D8 — grace_retry_count alone cannot distinguish a
//     re-run day-0/day-6 tick, so a verbatim-D8 implementation double-emails. [review BLOCKER 4]
//   · AC9 — recovery (subscription.active while past_due) with the UNCHANGED billing period —
//     the real dunning-retry-success shape (charge succeeds, period does NOT roll). This
//     exercises setPlanFromPolarTx's !genuine early-return: recovery MUST be status-based
//     (past_due → clear grace + cancel ticks + set active) and must NOT be gated on a genuine
//     plan/period change, or a paying center stays past_due and is wrongly downgraded at day 7.
//     [review BLOCKER 1 — the earlier red masked this by sending a fresh period]
//   · SEC-7 — the event resolves to the center bound to the subscription id, NOT the center
//     named in raw-body metadata (confused-deputy negative). [review HIGH]
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).SetEmailSender(service.EmailSender)
//   · (svc *service.BillingService).HandleGraceTick(ctx, tc) error
//   · ProcessPolarEvent payment-failure (idempotent, status-based enter) + recovery cases;
//     resolvePolarCenter learns the payment-failure type (persisted-sub-id-wins branch).
//   · migration 20261005120000+: grace cols + a per-day marker (e.g. grace_last_tick_day).
//
// RED: compile-fails on svc.SetEmailSender / svc.HandleGraceTick.

package test

import (
	"context"
	"strconv"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

// TestGrace_PaymentFailedRedelivery_DoesNotRestartClock covers AC2 both ways: the SAME event
// re-delivered (PK dedup) AND a second DISTINCT failure event while already past_due — neither
// re-stamps grace_period_start nor double-enqueues the grace tick.
func TestGrace_PaymentFailedRedelivery_DoesNotRestartClock(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	svc := service.NewBillingServiceWithClock(pool, clk)
	svc.SetEmailSender(&service.MockEmailSender{})

	centerID, _ := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	subID := newPolarSubID()
	bindPolarSubscription(t, centerID, subID)

	// First delivery enters grace.
	eventID := newWebhookEventID()
	body := polarPaymentFailed(centerID, subID)
	if err := svc.ProcessPolarEvent(ctx, eventID, polarPaymentFailedType, body); err != nil {
		t.Fatalf("ProcessPolarEvent #1: %v", err)
	}
	_, graceStart1, _, _ := readGraceState(t, centerID)
	ticks1 := countPendingGraceTicks(t, centerID)
	if graceStart1 == nil {
		t.Fatal("grace_period_start not set after first payment-failure")
	}

	// Exact re-delivery (same event_id) → whole-tx no-op via the polar_webhook_events PK.
	if err := svc.ProcessPolarEvent(ctx, eventID, polarPaymentFailedType, body); err != nil {
		t.Fatalf("ProcessPolarEvent exact re-delivery: %v", err)
	}
	if n := countWebhookEvents(t, eventID); n != 1 {
		t.Errorf("polar_webhook_events rows for %s = %d, want 1 (PK dedup)", eventID, n)
	}

	// A SECOND DISTINCT failure event (new event_id) while already past_due → target-state
	// guard: must NOT restart the clock or add a second tick (D19 idiom, AC2).
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), polarPaymentFailedType, polarPaymentFailed(centerID, subID)); err != nil {
		t.Fatalf("ProcessPolarEvent second distinct failure: %v", err)
	}
	_, graceStart2, _, _ := readGraceState(t, centerID)
	if graceStart2 == nil || !graceStart2.Equal(*graceStart1) {
		t.Errorf("grace_period_start after second failure = %v, want unchanged %v (clock must not restart)", graceStart2, graceStart1)
	}
	if ticks2 := countPendingGraceTicks(t, centerID); ticks2 != ticks1 {
		t.Errorf("pending grace ticks after second failure = %d, want %d (no double-enqueue)", ticks2, ticks1)
	}
}

// TestGrace_RerunTickSameDay_NoOp covers AC5 on EVERY acting day — including the email-only
// days 0 and 6 that no counter guards. Two HandleGraceTick calls at the same clock moment send
// exactly one email for that day. The day-0/day-6 cases are the ones a verbatim-D8
// implementation gets wrong (no per-day marker → re-run double-sends).
func TestGrace_RerunTickSameDay_NoOp(t *testing.T) {
	for _, dayN := range []int{0, 3, 6} {
		t.Run("day"+strconv.Itoa(dayN), func(t *testing.T) {
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

			clk.Set(graceDay(dayN))
			if err := svc.HandleGraceTick(ctx, tc); err != nil {
				t.Fatalf("HandleGraceTick day %d #1: %v", dayN, err)
			}
			emailsAfterFirst := sender.Count()
			_, _, _, retryAfterFirst := readGraceState(t, centerID)

			// Re-run the SAME day's tick — must be a pure no-op (email-only days 0/6 included).
			if err := svc.HandleGraceTick(ctx, tc); err != nil {
				t.Fatalf("HandleGraceTick day %d #2 (re-run): %v", dayN, err)
			}
			if got := sender.Count(); got != emailsAfterFirst {
				t.Errorf("emails after re-run day-%d tick = %d, want %d (idempotent per day — needs a persisted per-day marker)", dayN, got, emailsAfterFirst)
			}
			if _, _, _, retry := readGraceState(t, centerID); retry != retryAfterFirst {
				t.Errorf("grace_retry_count after re-run day %d = %d, want %d (no double re-collect)", dayN, retry, retryAfterFirst)
			}
		})
	}
}

// TestGrace_RecoverySamePeriod_CancelsTicksAndClears covers AC9 with the REAL recovery shape:
// a dunning-retry success fires subscription.active for the UNCHANGED billing period. Recovery
// must be detected because the center is past_due — NOT gated on a genuine plan/period change
// (the setPlanFromPolarTx !genuine early-return). A center that actually paid must return to
// active, clear grace, and cancel all pending ticks — never reach the day-7 downgrade.
func TestGrace_RecoverySamePeriod_CancelsTicksAndClears(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(billingEpoch)
	sender := &service.MockEmailSender{}
	svc := service.NewBillingServiceWithClock(pool, clk)
	svc.SetEmailSender(sender)

	periodStart := billingEpoch
	periodEnd := billingEpoch.AddDate(0, 1, 0)
	centerID, tc := newBillingCenter(t, "pro", 500, 0, 0, periodEnd)
	subID := newPolarSubID()
	bindPolarSubscription(t, centerID, subID)
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), polarPaymentFailedType, polarPaymentFailed(centerID, subID)); err != nil {
		t.Fatalf("ProcessPolarEvent payment-failure: %v", err)
	}

	// Advance to day 4 and recover — SAME period bounds (charge succeeded, period did NOT roll).
	clk.Set(graceDay(4))
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), "subscription.active",
		polarRecoveryActive(centerID, subID, "pro", "monthly", periodStart, periodEnd)); err != nil {
		t.Fatalf("ProcessPolarEvent recovery (same period): %v", err)
	}

	status, graceStart, _, _ := readGraceState(t, centerID)
	if status != "active" {
		t.Errorf("status after same-period recovery = %q, want active (recovery is status-based, not genuine-change-gated)", status)
	}
	if graceStart != nil {
		t.Errorf("grace_period_start after recovery = %v, want nil (cleared)", *graceStart)
	}
	if n := countPendingGraceTicks(t, centerID); n != 0 {
		t.Errorf("pending grace ticks after recovery = %d, want 0 (all cancelled)", n)
	}

	// Defense-in-depth: a stray tick AT the day-7 cutover must not re-downgrade or email a
	// center that already recovered.
	emailsAtRecovery := sender.Count()
	clk.Set(graceDeadline())
	if err := svc.HandleGraceTick(ctx, tc); err != nil {
		t.Fatalf("HandleGraceTick post-recovery: %v", err)
	}
	if got := sender.Count(); got != emailsAtRecovery {
		t.Errorf("emails after post-recovery tick = %d, want %d (no further emails once recovered)", got, emailsAtRecovery)
	}
	if plan, _, s, _ := readSubscriptionPlan(t, centerID); plan == "free" || s == "cancelled" {
		t.Error("recovered center was downgraded by the day-7 tick — a PAYING center must never auto-downgrade (BLOCKER: wrongful downgrade)")
	}
}

// TestGrace_PaymentFailed_ResolvesByBoundSubscription_NotMetadata is the SEC-7 confused-deputy
// negative: the event's data.id is bound to center A, but raw-body metadata.center_id names
// center B. Grace MUST land on A (the persisted-mapping-wins resolution, 9-2a D20) — a resolver
// that trusts metadata would enter grace on the attacker-named B.
func TestGrace_PaymentFailed_ResolvesByBoundSubscription_NotMetadata(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))
	svc.SetEmailSender(&service.MockEmailSender{})

	centerA, _ := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	centerB, _ := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))
	subID := newPolarSubID()
	bindPolarSubscription(t, centerA, subID) // the sub id belongs to A

	// Event carries A's sub id in data.id but B's id in metadata.center_id (the attack).
	body := polarPaymentFailed(centerB, subID)
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), polarPaymentFailedType, body); err != nil {
		t.Fatalf("ProcessPolarEvent confused-deputy: %v", err)
	}

	if statusA, graceA, _, _ := readGraceState(t, centerA); statusA != "past_due" || graceA == nil {
		t.Errorf("center A (bound to the sub) status=%q graceStart=%v, want past_due with grace set — resolution must follow the subscription id", statusA, graceA)
	}
	if statusB, graceB, _, _ := readGraceState(t, centerB); statusB == "past_due" || graceB != nil {
		t.Errorf("center B (named only in metadata) status=%q graceStart=%v, want UNCHANGED — SEC-7 confused-deputy: metadata must never win over the persisted subscription mapping", statusB, graceB)
	}
}

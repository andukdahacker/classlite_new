// Story 9.3 — the payment-failure grace-period state machine, layered on the shipped 9-2a
// Polar receiver + invoices table. Polar owns the CHARGE; we own the TIMING (D2 hybrid
// dunning): a payment-failure event starts OUR 7-day MockClock-driven clock
// (billing_grace_tick on the existing jobs queue), which sends warning emails on days
// 0/3/5/6, requests Polar re-collect on days 3/5 (grace_retry_count++), and auto-downgrades
// to Free at the day-7 23:59 deadline (R1) with ZERO row deletion (R24). Recovery before the
// deadline clears grace + cancels pending ticks + restores the plan. We NEVER collect payment
// ourselves / touch raw card data (FR-66).
//
// Also here (Story 9.3): the R3 grace-downgrade READ-ONLY guards (CheckClassMutable /
// CheckTeacherSeatMutable — a Free center over the grandfathered caps is read-only on mutation,
// an always-on path INDEPENDENT of BILLING_ENFORCEMENT_ENABLED), and the owner/admin grace
// block for the s73 strip.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net/mail"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/plan"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// graceWindowDays is the length of the payment-failure grace window (FR-65).
const graceWindowDays = 7

// graceEmailDays are the elapsed-day indices on which a warning email is sent (AC3).
var graceEmailDays = map[int]bool{0: true, 3: true, 5: true, 6: true}

// graceRetryDays are the elapsed-day indices on which OUR tick requests a Polar re-collect
// (AC4 — days 3 & 5). Provider-agnostic: we increment grace_retry_count; whether Polar exposes
// a manual re-collect or auto-retries is a provider fact (D2), so the attempt is DB-observable.
var graceRetryDays = map[int]bool{3: true, 5: true}

// gracePubEmailSubjectCap mirrors SEC-11's subject cap (used by the invoice email path).
const graceSubjectCap = 200

// graceDeadlineFrom returns the day-7 auto-downgrade deadline for a clock that started at
// graceStart: the END of the 7th calendar day (23:59), honoring R1 ("23:59"). Derived from the
// UTC date of graceStart so an owner who pays at day-7 10:00 is still in-window — the downgrade
// fires AT this instant and not before. Matches the reds' graceDeadline() exactly.
func graceDeadlineFrom(graceStart time.Time) time.Time {
	y, m, d := graceStart.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC).
		AddDate(0, 0, graceWindowDays).
		Add(23*time.Hour + 59*time.Minute)
}

// graceElapsedDay is the whole-days-since-start index (floor), TZ-agnostic (R1): day 0 is the
// day grace started. Never negative.
func graceElapsedDay(graceStart, now time.Time) int {
	d := int(now.Sub(graceStart) / (24 * time.Hour))
	if d < 0 {
		d = 0
	}
	return d
}

// graceEmailPlan is the post-commit email a tick decided to send (held out of the tx so the
// external send never holds the DB tx open — mirrors the 6.1 grade-release post-commit send).
type graceEmailPlan struct {
	to          string
	day         int
	deadline    time.Time
	settingsURL string
}

// graceTickActions are the post-commit side effects a tick decided on, held OUT of the DB tx so
// neither the email send nor the Polar re-collect network call holds the tenant tx open (D21 —
// outbound calls run outside the tx/lock; mirrors the 6.1 post-commit send).
type graceTickActions struct {
	email          *graceEmailPlan
	recollect      bool   // at least one retry day (3/5) elapsed this tick → request Polar re-collect
	subscriptionID string // the center's polar_subscription_id for the re-collect call ("" → skip)
}

// HandleGraceTick runs ONE grace tick for the center (AC3/AC4/AC5/AC6; D5). The
// billing_grace_tick worker calls it on dequeue (GFW-7); the reds drive it directly under
// MockClock. It computes the elapsed-day actions at clk.Now() inside a tenant tx (gated on the
// per-day high-water marker so a re-run is a no-op), then — post-commit — sends the day's warning
// email and makes the best-effort Polar re-collect call. Status != past_due (recovered / already
// downgraded) → a pure no-op.
func (s *BillingService) HandleGraceTick(ctx context.Context, tc model.TenantContext) error {
	var actions *graceTickActions
	if err := s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		a, err := s.handleGraceTickTx(ctx, q, tc)
		actions = a
		return err
	}); err != nil {
		return err
	}
	if actions == nil {
		return nil
	}
	if actions.email != nil {
		s.sendGraceWarningEmail(ctx, *actions.email)
	}
	// AC4 / code-review D6 — request Polar to re-collect the outstanding charge, POST-COMMIT and
	// OUTSIDE the tx (D21). Best-effort: a failed/absent re-collect is logged, never fatal — the
	// DB counter already recorded the attempt and the dunning clock keeps running. Skipped when
	// there is no Polar client (the 9-1a/CI paths) or no bound polar_subscription_id.
	if actions.recollect && actions.subscriptionID != "" && s.polar != nil {
		if err := s.polar.RetrySubscriptionCharge(context.WithoutCancel(ctx), actions.subscriptionID); err != nil {
			slog.WarnContext(ctx, "grace tick: polar re-collect call failed (best-effort)", "error", err.Error())
		}
	}
	return nil
}

func (s *BillingService) handleGraceTickTx(ctx context.Context, q *generated.Queries, tc model.TenantContext) (*graceTickActions, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	// Code-review P3 (2026-10-06) — serialize with the webhook recovery/dispatch path so a
	// last-minute recovery cannot race this tick's day-7 downgrade (R21 wrong-day transition).
	// Acquired before any lockClassCredit taken downstream (grantPlanAllocationFromPolarTx) so
	// the lock order is consistent with ProcessPolarEvent (no deadlock).
	if err := s.acquireLock(ctx, q, tc, lockClassSubscription); err != nil {
		return nil, err
	}
	sub, err := s.getOrCreateSubscription(ctx, q, tc)
	if err != nil {
		return nil, err
	}
	// Not in grace (recovered, already downgraded, or never entered) → no-op. This is the
	// defense that a stray tick after recovery/downgrade sends nothing and re-downgrades
	// nothing (AC9 / idempotency).
	if sub.Status != "past_due" || !sub.GracePeriodStart.Valid {
		return nil, nil
	}
	graceStart := sub.GracePeriodStart.Time
	now := s.clk.Now()
	deadline := graceDeadlineFrom(graceStart)

	// Day-7 23:59 deadline reached → auto-downgrade to Free, zero deletion (C6/C7/R24, R1).
	if !now.Before(deadline) {
		return nil, s.expireGraceToFreeTx(ctx, q, tc, centerUUID)
	}

	// Per-day idempotency (AC5 / BLOCKER-4): nothing new since the last acted-on day → no-op.
	elapsed := graceElapsedDay(graceStart, now)
	lastDay := int(sub.GraceLastTickDay)
	if elapsed <= lastDay {
		return nil, nil
	}

	// Code-review P2 (2026-10-06) — CATCH UP over every day skipped since the last tick, so a
	// late/missed tick (worker lag, downtime) never silently drops a day-3/5 re-collect. Warning
	// emails are COLLAPSED to the most-recent missed day (one up-to-date warning, not a burst of
	// stale back-dated ones); each missed retry day still increments the provider-agnostic
	// counter. The high-water marker advances once, to the current elapsed day.
	actions := &graceTickActions{}
	if sub.PolarSubscriptionID.Valid {
		actions.subscriptionID = sub.PolarSubscriptionID.String
	}
	latestEmailDay := -1
	for d := lastDay + 1; d <= elapsed; d++ {
		if graceEmailDays[d] {
			latestEmailDay = d
		}
		if graceRetryDays[d] {
			if err := q.IncrementGraceRetry(ctx, pgUUID(centerUUID)); err != nil {
				return nil, fmt.Errorf("grace tick: increment retry: %w", err)
			}
			actions.recollect = true
			slog.InfoContext(ctx, "grace tick: polar re-collect requested", "center_id", tc.CenterID, "grace_day", d)
		}
	}
	if latestEmailDay >= 0 {
		to, lookupErr := s.resolveOwnerEmail(ctx, q, centerUUID)
		if lookupErr != nil {
			return nil, lookupErr
		}
		if to != "" {
			actions.email = &graceEmailPlan{to: to, day: latestEmailDay, deadline: deadline, settingsURL: s.billingSettingsURL}
		}
	}
	if err := q.AdvanceGraceTickDay(ctx, generated.AdvanceGraceTickDayParams{
		GraceLastTickDay: int16(elapsed),
		CenterID:         pgUUID(centerUUID),
	}); err != nil {
		return nil, fmt.Errorf("grace tick: advance marker: %w", err)
	}
	return actions, nil
}

// RescheduleGraceTickTx enqueues the NEXT billing_grace_tick on the caller's tx (the worker's
// per-job tx) if the center is still past_due — the self-rescheduling cadence (D5/C4). The next
// tick is the following elapsed-day boundary, capped at the day-7 23:59 deadline so the final
// tick fires the downgrade. A recovered/downgraded center (status != past_due) enqueues nothing,
// so the chain terminates. The worker-package integration test driving ProcessOnce across the
// clock (D-green-1) is a deferred follow-up; the reds drive HandleGraceTick directly.
func (s *BillingService) RescheduleGraceTickTx(ctx context.Context, q *generated.Queries, tc model.TenantContext) error {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	sub, err := s.getOrCreateSubscription(ctx, q, tc)
	if err != nil {
		return err
	}
	if sub.Status != "past_due" || !sub.GracePeriodStart.Valid {
		return nil // recovered or downgraded — the chain terminates
	}
	graceStart := sub.GracePeriodStart.Time
	deadline := graceDeadlineFrom(graceStart)
	now := s.clk.Now()
	elapsed := graceElapsedDay(graceStart, now)
	next := graceStart.Add(time.Duration(elapsed+1) * 24 * time.Hour)
	if next.After(deadline) || !next.After(now) {
		next = deadline
	}
	params, err := json.Marshal(model.BillingGraceTickParams{GraceStartedAt: graceStart.Format(time.RFC3339)})
	if err != nil {
		return fmt.Errorf("reschedule grace tick: marshal: %w", err)
	}
	if _, err := q.InsertDelayedJob(ctx, generated.InsertDelayedJobParams{
		CenterID:            pgUUID(centerUUID),
		Type:                string(model.JobTypeBillingGraceTick),
		Params:              params,
		ParamsSchemaVersion: int32(model.BillingGraceTickParamsSchemaVersion),
		NextAttemptAt:       pgTimestamptz(next),
	}); err != nil {
		return fmt.Errorf("reschedule grace tick: enqueue: %w", err)
	}
	return nil
}

// enterGraceTx is the payment-failure dispatch case (AC1/AC2; D6). It flips the center to
// past_due, starts the 7-day clock, and enqueues the first grace tick — idempotent on the
// TARGET STATE: an already-past_due center (a re-delivered or a second distinct failure event)
// does NOT restart the clock or double-enqueue (the 9-2a D19 idiom). Runs on the dispatch tx.
//
// Returns transitioned=true ONLY when this call actually flipped the center from a
// non-grace state into past_due. An already-past_due no-op returns false (Story
// 10.1a code-review): the caller gates the on-bus PaymentFailed publish on this, so
// a multi-webhook dunning cycle yields exactly ONE owner "Payment failed" inbox row.
func (s *BillingService) enterGraceTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, ev polarEvent) (transitioned bool, err error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return false, &ForbiddenError{Reason: "invalid tenant context"}
	}
	sub, err := s.getOrCreateSubscription(ctx, q, tc)
	if err != nil {
		return false, err
	}
	if sub.Status == "past_due" {
		// Already in grace — target-state idempotency (AC2). Do not restart the clock or
		// enqueue a second tick, and signal NO transition so the caller skips the publish.
		return false, nil
	}
	now := s.clk.Now()
	if err := q.SetPastDueWithGrace(ctx, generated.SetPastDueWithGraceParams{
		GracePeriodStart: pgTimestamptz(now),
		PaymentFailedAt:  pgTimestamptz(now),
		CenterID:         pgUUID(centerUUID),
	}); err != nil {
		return false, fmt.Errorf("enter grace: set past_due: %w", err)
	}
	params, err := json.Marshal(model.BillingGraceTickParams{GraceStartedAt: now.Format(time.RFC3339)})
	if err != nil {
		return false, fmt.Errorf("enter grace: marshal tick params: %w", err)
	}
	// The first tick arms the clock (D5); claimable immediately (next_attempt_at = now) so the
	// worker runs the day-0 warning, then reschedules the next tick.
	if _, err := q.InsertDelayedJob(ctx, generated.InsertDelayedJobParams{
		CenterID:            pgUUID(centerUUID),
		Type:                string(model.JobTypeBillingGraceTick),
		Params:              params,
		ParamsSchemaVersion: int32(model.BillingGraceTickParamsSchemaVersion),
		NextAttemptAt:       pgTimestamptz(now),
	}); err != nil {
		return false, fmt.Errorf("enter grace: enqueue first tick: %w", err)
	}
	// Code-review D3 (2026-10-06, R2) — snapshot the FAILED charge as a 'declined' invoice so the
	// s70 history + the declined-only Retry action render a real row (recovery transitions it to
	// 'paid'). Idempotent on polar_order_id; skipped only when the failure event carries no id.
	if err := s.insertDeclinedInvoiceTx(ctx, q, tc, centerUUID, ev); err != nil {
		return false, err
	}
	return true, nil
}

// insertDeclinedInvoiceTx writes a 'declined' invoice for a payment-failure event (code-review
// D3 / R2). The id + polar_order_id derive from the failed-charge id (order_id, else the
// subscription/event id); ON CONFLICT(polar_order_id) DO NOTHING dedups a re-delivery. Amount is
// snapshotted VERBATIM from the payload (D25), currency defaults to VND. A failure event with no
// id at all is a logged skip (nothing idempotently writable) — the clock still runs.
func (s *BillingService) insertDeclinedInvoiceTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, centerUUID uuid.UUID, ev polarEvent) error {
	failedChargeID := ev.Data.OrderID
	if failedChargeID == "" {
		failedChargeID = ev.Data.ID
	}
	if failedChargeID == "" {
		slog.InfoContext(ctx, "grace: payment-failure event carried no charge id — no declined invoice snapshotted", "center_id", tc.CenterID)
		return nil
	}
	currency := ev.Data.Currency
	if currency == "" {
		currency = "VND"
	}
	if currency != "VND" {
		// Mirror insertChargeInvoice (P-9): ClassLite bills only integer VND; surface a mismatch as
		// a permanent (dead-lettered) error rather than corrupting the invoice.
		return model.ValidationError{Fields: []model.FieldError{{Field: "currency", Message: "unsupported charge currency: " + currency + " (expected VND)"}}}
	}
	if _, err := q.InsertDeclinedInvoice(ctx, generated.InsertDeclinedInvoiceParams{
		ID:           pgUUID(purchaseIDForOrder(failedChargeID)),
		CenterID:     pgUUID(centerUUID),
		PolarOrderID: pgtype.Text{String: failedChargeID, Valid: true},
		AmountVnd:    int32(ev.Data.Amount),
		Currency:     currency,
		IssuedAt:     pgTimestamptz(s.clk.Now()),
	}); err != nil {
		return fmt.Errorf("enter grace: snapshot declined invoice: %w", err)
	}
	return nil
}

// recoverFromGraceTx is the status-based recovery branch (AC9; BLOCKER-1). A center that is
// past_due AND receives a recovery-eligible event (order.paid / subscription.active/.updated)
// has recovered: clear grace, cancel all pending ticks, and return to active — INDEPENDENT of
// the genuine plan/period-change gate (a same-period dunning-retry success must still recover,
// or the setPlanFromPolarTx !genuine early-return would leave it past_due and wrongly downgrade
// at day 7). The subsequent normal dispatch (plan apply) is a no-op on an unchanged period.
func (s *BillingService) recoverFromGraceTx(ctx context.Context, q *generated.Queries, tc model.TenantContext) error {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	if err := q.ClearGrace(ctx, pgUUID(centerUUID)); err != nil {
		return fmt.Errorf("recover from grace: clear: %w", err)
	}
	if err := q.CancelPendingGraceTicks(ctx, pgUUID(centerUUID)); err != nil {
		return fmt.Errorf("recover from grace: cancel ticks: %w", err)
	}
	// Code-review D3 (2026-10-06, R2) — the retry charge succeeded: transition the center's most-
	// recent 'declined' invoice → 'paid' so the history reflects the recovery. A no-op (0 rows)
	// when no declined row exists (failure predated the producer, or a fresh order.paid already
	// wrote its own paid row); never an error.
	if _, err := q.MarkLatestDeclinedInvoicePaid(ctx, pgUUID(centerUUID)); err != nil {
		return fmt.Errorf("recover from grace: mark declined paid: %w", err)
	}
	slog.InfoContext(ctx, "grace recovered: payment resolved within window", "center_id", tc.CenterID)
	return nil
}

// expireGraceToFreeTx is the day-7 auto-downgrade (C6/C7; R24; M1). A DISTINCT write from
// setPlanFromPolarTx (which hardcodes status='active' + 422s on an empty cycle): it flips
// plan→free + status→cancelled + clears the grace cols, then reuses the discrete zero-deletion
// helpers — capture the grandfather high-water baseline (re-upgrade grandfathers), re-point the
// storage ceiling to Free, and cap the credit allocation to the Free tier (addon preserved,
// frozen by the D25 tier-gate). NOT ONE content row is deleted (R24). Finally cancels pending
// ticks so no stray tick re-fires.
func (s *BillingService) expireGraceToFreeTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, centerUUID uuid.UUID) error {
	if err := q.ExpireGraceToFree(ctx, pgUUID(centerUUID)); err != nil {
		return fmt.Errorf("expire grace: downgrade to free: %w", err)
	}
	// Grandfather high-water so a later re-upgrade (or trim) grandfathers the over-cap content
	// (FU-9-1-GRANDFATHER / D13) — reuse the same discrete capture the arming hook uses.
	if err := s.captureResourceBaselinesTx(ctx, q, centerUUID); err != nil {
		return err
	}
	if err := q.UpdateCenterStorageLimit(ctx, generated.UpdateCenterStorageLimitParams{
		ID:                pgUUID(centerUUID),
		StorageLimitBytes: plan.LimitsFor(plan.Free).StorageBytes,
	}); err != nil {
		return fmt.Errorf("expire grace: storage limit: %w", err)
	}
	// Cap the monthly AI allocation to Free (0); addon_remaining is PRESERVED (R24 — never
	// deleted) and frozen by the D25 tier-gate until re-upgrade. Reuses the existing grant path.
	if err := s.grantPlanAllocationFromPolarTx(ctx, q, tc, centerUUID, plan.Free); err != nil {
		return err
	}
	if err := q.CancelPendingGraceTicks(ctx, pgUUID(centerUUID)); err != nil {
		return fmt.Errorf("expire grace: cancel ticks: %w", err)
	}
	slog.InfoContext(ctx, "grace expired: auto-downgraded to Free (zero deletion)", "center_id", tc.CenterID)
	return nil
}

// captureResourceBaselinesTx freezes the center's live seat + class counts as the
// FU-9-1-GRANDFATHER high-water baselines on the CALLER's tx (D13). Extracted from
// CaptureResourceBaselines so the day-7 downgrade can capture inside its own dispatch tx.
func (s *BillingService) captureResourceBaselinesTx(ctx context.Context, q *generated.Queries, centerUUID uuid.UUID) error {
	seats, err := q.CountTeacherSeats(ctx, pgUUID(centerUUID))
	if err != nil {
		return fmt.Errorf("capture baselines: seats: %w", err)
	}
	classes, err := q.CountCenterClasses(ctx, pgUUID(centerUUID))
	if err != nil {
		return fmt.Errorf("capture baselines: classes: %w", err)
	}
	for _, b := range []struct {
		class int
		count int64
	}{{lockClassSeat, seats}, {lockClassClass, classes}} {
		if err := q.InsertResourceBaseline(ctx, generated.InsertResourceBaselineParams{
			CenterID:       pgUUID(centerUUID),
			ResourceClass:  int16(b.class),
			HighWaterCount: int32(b.count),
		}); err != nil {
			return fmt.Errorf("capture baselines: insert class %d: %w", b.class, err)
		}
	}
	return nil
}

// --- R3 grace-downgrade read-only guards (C8a/C8b) -------------------------------------
//
// An ALWAYS-ON enforcement path, INDEPENDENT of BILLING_ENFORCEMENT_ENABLED (which gates only
// the 9-1a *add* gates): a Free center's grandfathered over-cap resources become read-only on
// mutation so FR-65's advertised pause is live in prod even while the add-flag is dark. Only
// Free centers are affected (the plan flips to free at the day-7 downgrade); zero deletion still
// holds (read-only ≠ delete). The mutation handlers call these before a write.

// CheckClassMutable rejects a content mutation on a class that exceeds the Free students-per-
// class cap while the center is on Free (C8b). A class at/under the cap stays editable; a
// non-Free center is never locked. Own tenant tx (the public entry the reds drive directly);
// the inline wiring from class/enrollment mutation endpoints uses CheckClassMutableTx on the
// caller's tx (code-review D2, 2026-10-06).
func (s *BillingService) CheckClassMutable(ctx context.Context, tc model.TenantContext, classID uuid.UUID) error {
	return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		return s.CheckClassMutableTx(ctx, q, tc, classID)
	})
}

// CheckClassMutableTx is the on-the-caller's-tx core of CheckClassMutable (code-review D2) — the
// ALWAYS-ON (flag-independent) R3 read-only guard the enrollment/class mutation endpoints call
// inline, next to the flag-gated 9-1a add gate.
func (s *BillingService) CheckClassMutableTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, classID uuid.UUID) error {
	sub, err := s.getOrCreateSubscription(ctx, q, tc)
	if err != nil {
		return err
	}
	if plan.Tier(sub.Plan) != plan.Free {
		return nil // only a downgraded Free center is read-only locked
	}
	max := plan.LimitsFor(plan.Free).StudentsPerClassMax
	if max == plan.Unlimited {
		return nil
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	count, err := q.CountActiveEnrollmentsInClass(ctx, generated.CountActiveEnrollmentsInClassParams{
		CenterID: pgUUID(centerUUID),
		ClassID:  pgUUID(classID),
	})
	if err != nil {
		return fmt.Errorf("check class mutable: count: %w", err)
	}
	if int(count) > max {
		return PlanLimitExceededError{Limit: "studentsPerClass", Current: int(count), Max: max, CanManageBilling: tc.Role == string(model.RoleOwner)}
	}
	return nil
}

// CheckTeacherSeatMutable rejects a seat-affecting mutation when the center is on Free AND over
// the Free teacher-seat cap — the 2nd+ teacher seat locks (C8a/R3) until the owner trims or
// re-upgrades. A Free center at/under the cap, or any non-Free center, stays editable. Own tx
// (public entry for the reds); the inline teacher-seat wiring uses CheckTeacherSeatMutableTx.
func (s *BillingService) CheckTeacherSeatMutable(ctx context.Context, tc model.TenantContext) error {
	return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		return s.CheckTeacherSeatMutableTx(ctx, q, tc)
	})
}

// CheckTeacherSeatMutableTx is the on-the-caller's-tx core of CheckTeacherSeatMutable (code-
// review D2) — the ALWAYS-ON R3 guard the teacher-seat (invite-staff) endpoint calls inline.
func (s *BillingService) CheckTeacherSeatMutableTx(ctx context.Context, q *generated.Queries, tc model.TenantContext) error {
	sub, err := s.getOrCreateSubscription(ctx, q, tc)
	if err != nil {
		return err
	}
	if plan.Tier(sub.Plan) != plan.Free {
		return nil
	}
	max := plan.LimitsFor(plan.Free).TeachersMax
	if max == plan.Unlimited {
		return nil
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	// Teacher-ROLE members only (R3 — "the 2nd+ teacher seat locks"): a Free center with
	// more teacher members than the Free cap is read-only on seat management.
	count, err := q.CountCenterTeacherSeats(ctx, pgUUID(centerUUID))
	if err != nil {
		return fmt.Errorf("check teacher seat mutable: count: %w", err)
	}
	if int(count) > max {
		return PlanLimitExceededError{Limit: "teachers", Current: int(count), Max: max, CanManageBilling: tc.Role == string(model.RoleOwner)}
	}
	return nil
}

// --- grace block (s73 strip source, D9) ------------------------------------------------

// GraceInfo is the active grace window for the s73 strip (D9). Non-nil only while past_due.
type GraceInfo struct {
	GraceStartedAt   time.Time
	GraceEndsAt      time.Time
	PaymentFailedAt  time.Time
	RetryCount       int
	RetriesScheduled []int
}

// graceInfoFromSub builds the GraceInfo for a past_due subscription, or nil otherwise (GO-5
// explicit null). graceEndsAt is the day-7 23:59 deadline (R1) the FE countdown derives from.
func graceInfoFromSub(sub generated.Subscription) *GraceInfo {
	if sub.Status != "past_due" || !sub.GracePeriodStart.Valid {
		return nil
	}
	start := sub.GracePeriodStart.Time
	info := &GraceInfo{
		GraceStartedAt:   start,
		GraceEndsAt:      graceDeadlineFrom(start),
		RetryCount:       int(sub.GraceRetryCount),
		RetriesScheduled: []int{3, 5},
	}
	if sub.PaymentFailedAt.Valid {
		info.PaymentFailedAt = sub.PaymentFailedAt.Time
	}
	return info
}

// GetGrace returns the center's active grace block, or nil when not past_due (R4 — the scoped
// owner+admin s73 strip source). Lighter than GetUsageAndLimits: one tenant-tx subscription
// read, no reconcile / usage meters. Role authz (owner|admin) is enforced at the route.
func (s *BillingService) GetGrace(ctx context.Context, tc model.TenantContext) (*GraceInfo, error) {
	var info *GraceInfo
	if err := s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		sub, err := s.getOrCreateSubscription(ctx, q, tc)
		if err != nil {
			return err
		}
		info = graceInfoFromSub(sub)
		return nil
	}); err != nil {
		return nil, err
	}
	return info, nil
}

// --- email-to-accountant (AC16 / SEC-11) -----------------------------------------------

// EmailInvoicesToAccountant renders the center's invoice history and sends it to recipient
// via the EmailSender (AC16). SEC-11: the recipient MUST pass net/mail.ParseAddress, every
// header field is CRLF-stripped, and the subject is capped — a CRLF-injected recipient is
// rejected and NOTHING reaches the sender. Owner-gated at the handler; this is the service-
// layer sanitization.
func (s *BillingService) EmailInvoicesToAccountant(ctx context.Context, tc model.TenantContext, recipient string) error {
	// SEC-11 — reject anything that is not a single clean address BEFORE any send. ParseAddress
	// rejects embedded CRLF (BCC smuggling) and malformed input.
	addr, err := mail.ParseAddress(strings.TrimSpace(recipient))
	if err != nil || strings.ContainsAny(addr.Address, "\r\n") {
		return model.ValidationError{Fields: []model.FieldError{{Field: "recipient", Message: "invalid email address"}}}
	}
	if s.emailSender == nil {
		return fmt.Errorf("email invoices: no email sender configured")
	}

	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}

	var (
		invoices   []generated.Invoice
		centerName string
	)
	if err := s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		// Code-review D7 (2026-10-06) — the accountant email is the COMPLETE records history, so
		// list EVERY invoice (no page cap). The prior ListInvoices(PageSize=100) silently dropped
		// older rows for a center with >100 invoices while claiming to be the full history.
		rows, lerr := q.ListAllInvoices(ctx, pgUUID(centerUUID))
		if lerr != nil {
			return fmt.Errorf("email invoices: list: %w", lerr)
		}
		invoices = rows
		center, cerr := q.GetCenterByID(ctx, pgUUID(centerUUID))
		if cerr != nil && !errors.Is(cerr, pgx.ErrNoRows) {
			return fmt.Errorf("email invoices: center: %w", cerr)
		}
		centerName = center.Name
		return nil
	}); err != nil {
		return err
	}

	subject, body := RenderInvoiceHistoryEmail(centerName, renderInvoiceRows(invoices))
	// SEC-11 belt-and-braces: strip CRLF from the header fields + cap the subject (ParseAddress
	// already guarantees a clean To, but the sender contract must never carry raw newlines).
	cleanTo := stripCRLF(addr.Address)
	cleanSubject := capString(stripCRLF(subject), graceSubjectCap)
	if err := s.emailSender.Send(ctx, cleanTo, cleanSubject, body); err != nil {
		return fmt.Errorf("email invoices: send: %w", err)
	}
	return nil
}

// renderInvoiceRows builds the HTML-escaped <tr> rows for the accountant email (date · amount ·
// status). Money is integer VND verbatim (D25). All values HTML-escaped.
func renderInvoiceRows(invoices []generated.Invoice) string {
	var b strings.Builder
	for _, inv := range invoices {
		date := ""
		if inv.IssuedAt.Valid {
			date = inv.IssuedAt.Time.Format("2006-01-02")
		}
		fmt.Fprintf(&b, `<tr><td>%s</td><td>%d</td><td>%s</td></tr>`,
			html.EscapeString(date), inv.AmountVnd, html.EscapeString(inv.Status))
	}
	return b.String()
}

// --- shared internals ------------------------------------------------------------------

// resolveOwnerEmail looks up the center owner's email (D24 recipient for the grace warning).
// Returns "" (no send) when the center has no owner or the owner row is missing — a missing
// recipient is a logged skip, never a hard failure (anti-panic: the clock still advances).
func (s *BillingService) resolveOwnerEmail(ctx context.Context, q *generated.Queries, centerUUID uuid.UUID) (string, error) {
	owner, err := q.GetCenterOwnerUserID(ctx, pgUUID(centerUUID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("grace email: owner lookup: %w", err)
	}
	user, err := q.GetUserByID(ctx, owner)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("grace email: user lookup: %w", err)
	}
	return user.Email, nil
}

// sendGraceWarningEmail renders + sends the day's warning email post-commit (best-effort; a
// transient send failure is logged, not fatal — the next day's tick still warns and the
// downgrade still fires, so a lost email never blocks the clock). EDGE-4: metadata-only logs.
func (s *BillingService) sendGraceWarningEmail(ctx context.Context, p graceEmailPlan) {
	if s.emailSender == nil {
		return
	}
	deadlineText := p.deadline.Format("Jan 2, 2006")
	subject, body := RenderPaymentFailedEmail(p.day, deadlineText, p.settingsURL)
	if err := s.emailSender.Send(ctx, stripCRLF(p.to), capString(stripCRLF(subject), graceSubjectCap), body); err != nil {
		slog.WarnContext(ctx, "grace warning email send failed", "grace_day", p.day, "error", err.Error())
	}
}

// stripCRLF removes CR and LF from a header field (SEC-11).
func stripCRLF(s string) string {
	return strings.NewReplacer("\r", "", "\n", "").Replace(s)
}

// capString truncates s to at most n bytes (SEC-11 subject cap).
func capString(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// Package service — Story 9.1a BillingService: the keystone of Epic 9.
//
// It owns (a) the write-time plan-limit gates (teacher seats / classes / students-per-
// class) enforced INSIDE each resource service's tx under a per-center advisory lock
// (D3/D10/D13), (b) the AI-credit balance gate + accounting that closes FU-11-CREDITCAP
// (D-CREDIT/D5/D6/D14), and (c) the Owner-only read model (GetUsageAndLimits / ListPlans).
//
// Advisory locks (D13) are CENTER-ONLY, namespaced by resource_class:
// seat=1, class=2, enrollment=3, credit=4 — pg_advisory_xact_lock(hashtext(center),class).
// The v0.1 (center,user) credit key was a lost-update bug (ai_credits is one row/center).
//
// Credit model (D14): ai_credits is a TYPED PROJECTION of the ai_credit_ledger head —
// available = (monthly_allocation - monthly_used) + addon_remaining == latest ledger
// balance_after. Consume spends monthly THEN addon (FR-64); the monthly bucket resets
// lazily (D6) forfeiting the unused remainder; add-ons carry forward.
//
// Enforcement is DARK-LAUNCHED (D19): the resource-service WIRING calls the seat/class/
// student gates only when BILLING_ENFORCEMENT_ENABLED=true (default OFF in prod for
// 9-1a). CheckAndConsumeCredit is NOT flag-guarded here — the wiring decides whether to
// route AI enqueue through it — so the credit accounting/gate is unit-testable directly.
package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/plan"
	"github.com/ducdo/classlite-api/internal/polar"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Advisory-lock resource classes (D13) — the second int4 key that namespaces the
// per-center lock so seat/class/enrolment/credit gates never block each other.
const (
	lockClassSeat       = 1
	lockClassClass      = 2
	lockClassEnrollment = 3
	lockClassCredit     = 4
)

// ledger reasons (subset the 4.3a CHECK already admits).
const (
	reasonMonthlyGrant     = "monthly_grant"
	reasonJobDeduction     = "job_deduction"
	reasonJobFailedRefund  = "job_failed_refund"
	billingEnforcementFlag = "BILLING_ENFORCEMENT_ENABLED"
)

// PlanApproachingThreshold is the fraction of a limit at/above which a usage meter is
// flagged "approaching" (D4/D22 — server-computed so the FE never re-derives it).
const PlanApproachingThreshold = 0.8

// billingEnforcementEnabled reports whether the dark-launched plan gates are armed
// (D19). Read at call time so tests can flip it with t.Setenv. Default OFF.
func billingEnforcementEnabled() bool {
	return os.Getenv(billingEnforcementFlag) == "true"
}

// BillingEnforcementEnabled exposes the dark-launch flag (D19) to callers outside the
// service package — the worker's terminal-fail refund path mirrors the enqueue consume
// gate, reversing the armed ai_credits spend rather than the legacy ledger deduction
// (code-review 2026-09-29 F1).
func BillingEnforcementEnabled() bool { return billingEnforcementEnabled() }

// BillingService is constructed with a Clock so the lazy monthly-reset boundary (D6) is
// deterministic in tests. db is the pool (each method opens its own tenant tx) OR, for
// the write-time gates, the caller passes its own tx-bound *generated.Queries.
type BillingService struct {
	db  AuthDB
	clk clock.Clock
	// polar is the Story 9.2a Polar.sh client (checkout create, reconcile poll, proration
	// preview, scheduled downgrade). nil when the service is constructed without Polar (the
	// 9-1a credit/gate paths never touch it); the checkout/reconcile paths guard on nil.
	polar polar.Client
	// checkoutSuccessURL is the app URL Polar redirects to after a hosted checkout
	// (Story 9-2b, AC3). Set via SetCheckoutSuccessURL from cfg.AppBillingSuccessURL;
	// empty when unset (Polar then uses its own default return). Passed verbatim as
	// the checkout session's success_url.
	checkoutSuccessURL string
}

// SetCheckoutSuccessURL sets the post-checkout return URL (Story 9-2b, AC3). main.go
// wires it from cfg.AppBillingSuccessURL after construction (mirrors the SetBillingService
// setter pattern).
func (s *BillingService) SetCheckoutSuccessURL(url string) {
	s.checkoutSuccessURL = url
}

// NewBillingService wires the service with the real wall clock.
func NewBillingService(db AuthDB) *BillingService {
	return NewBillingServiceWithClock(db, clock.RealClock{})
}

// NewBillingServiceWithClock is the test-friendly constructor (nil clk → RealClock, D6).
func NewBillingServiceWithClock(db AuthDB, c clock.Clock) *BillingService {
	if c == nil {
		c = clock.RealClock{}
	}
	return &BillingService{db: db, clk: c}
}

// NewBillingServiceWithPolar wires the service with a Polar client (Story 9.2a) so the
// checkout / reconcile / downgrade-schedule paths can reach Polar. nil clk → RealClock (D6).
func NewBillingServiceWithPolar(db AuthDB, c clock.Clock, p polar.Client) *BillingService {
	if c == nil {
		c = clock.RealClock{}
	}
	return &BillingService{db: db, clk: c, polar: p}
}

// --- write-time plan-limit gates (run INSIDE the caller's tx — D3) ---------------------

// CheckStudentPerClass blocks the (cap+1)th active enrolment in a class (AC9/AC10/AC22).
// Runs on the caller's tx-bound queries so the live COUNT + the subsequent enrolment
// INSERT are atomic under the same (center, enrollment=3) advisory lock (D10/D13). Block
// iff currentCount >= planMax (D20 grandfather — existing rows are never touched, D11).
func (s *BillingService) CheckStudentPerClass(ctx context.Context, q *generated.Queries, tc model.TenantContext, classID uuid.UUID) error {
	sub, err := s.getOrCreateSubscription(ctx, q, tc)
	if err != nil {
		return err
	}
	max := plan.LimitsFor(plan.Tier(sub.Plan)).StudentsPerClassMax
	if max == plan.Unlimited {
		return nil
	}
	if err := s.acquireLock(ctx, q, tc, lockClassEnrollment); err != nil {
		return err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	current, err := q.CountActiveEnrollmentsInClass(ctx, generated.CountActiveEnrollmentsInClassParams{
		CenterID: pgUUID(centerUUID),
		ClassID:  pgUUID(classID),
	})
	if err != nil {
		return fmt.Errorf("check students-per-class: count: %w", err)
	}
	effMax, err := s.effectiveMax(ctx, q, centerUUID, lockClassEnrollment, max)
	if err != nil {
		return err
	}
	if int(current) >= effMax {
		return PlanLimitExceededError{Limit: "studentsPerClass", Current: int(current), Max: effMax, CanManageBilling: tc.Role == model.RoleOwner}
	}
	return nil
}

// effectiveMax applies the FU-9-1-GRANDFATHER high-water baseline (D13): a create is blocked
// iff currentCount >= max(planMax, high_water_baseline). A downgraded-then-trimmed center can
// re-add up to where it was at arming, never above. No baseline row (the common/unarmed case,
// pgx.ErrNoRows) → plain planMax (byte-identical 9-1a behavior). currentCount is ALWAYS a live
// COUNT under the lock (the 9-1a D20 rule) — this only raises the CEILING, never the count.
// Only pgx.ErrNoRows (the common/unarmed case) collapses to the plain plan cap; any OTHER DB
// error is propagated so a transient read failure can NOT silently drop a grandfathered ceiling
// back to planMax and wrongly block a legitimate create (review P-5).
func (s *BillingService) effectiveMax(ctx context.Context, q *generated.Queries, centerUUID uuid.UUID, resourceClass, planMax int) (int, error) {
	baseline, err := q.GetResourceBaseline(ctx, generated.GetResourceBaselineParams{
		CenterID:      pgUUID(centerUUID),
		ResourceClass: int16(resourceClass),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return planMax, nil // no baseline (unarmed) → plain plan cap
		}
		return 0, fmt.Errorf("effective max: resource baseline: %w", err)
	}
	if int(baseline) > planMax {
		return int(baseline), nil
	}
	return planMax, nil
}

// CheckTeacherSeat blocks adding/inviting a teacher past the plan's teacher-seat cap
// (AC7). Runs on the caller's tx under the (center, seat=1) lock.
func (s *BillingService) CheckTeacherSeat(ctx context.Context, q *generated.Queries, tc model.TenantContext) error {
	sub, err := s.getOrCreateSubscription(ctx, q, tc)
	if err != nil {
		return err
	}
	max := plan.LimitsFor(plan.Tier(sub.Plan)).TeachersMax
	if max == plan.Unlimited {
		return nil
	}
	if err := s.acquireLock(ctx, q, tc, lockClassSeat); err != nil {
		return err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	current, err := q.CountTeacherSeats(ctx, pgUUID(centerUUID))
	if err != nil {
		return fmt.Errorf("check teacher seat: count: %w", err)
	}
	effMax, err := s.effectiveMax(ctx, q, centerUUID, lockClassSeat, max)
	if err != nil {
		return err
	}
	if int(current) >= effMax {
		return PlanLimitExceededError{Limit: "teachers", Current: int(current), Max: effMax, CanManageBilling: tc.Role == model.RoleOwner}
	}
	return nil
}

// CheckClassLimit blocks creating a class past the plan's class cap (AC8). Runs on the
// caller's tx under the (center, class=2) lock.
func (s *BillingService) CheckClassLimit(ctx context.Context, q *generated.Queries, tc model.TenantContext) error {
	sub, err := s.getOrCreateSubscription(ctx, q, tc)
	if err != nil {
		return err
	}
	max := plan.LimitsFor(plan.Tier(sub.Plan)).ClassesMax
	if max == plan.Unlimited {
		return nil
	}
	if err := s.acquireLock(ctx, q, tc, lockClassClass); err != nil {
		return err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	current, err := q.CountCenterClasses(ctx, pgUUID(centerUUID))
	if err != nil {
		return fmt.Errorf("check class limit: count: %w", err)
	}
	effMax, err := s.effectiveMax(ctx, q, centerUUID, lockClassClass, max)
	if err != nil {
		return err
	}
	if int(current) >= effMax {
		return PlanLimitExceededError{Limit: "classes", Current: int(current), Max: effMax, CanManageBilling: tc.Role == model.RoleOwner}
	}
	return nil
}

// --- AI-credit gate + accounting (own tx — D5/D6/D14/D16) ------------------------------

// CheckAndConsumeCredit spends one credit for jobID or returns InsufficientCreditsError
// (402) when the balance is exhausted (AC11/AC12). One SHORT tx under the (center,
// credit=4) lock: lazy-reset if the period rolled over (D6), spend monthly-then-addon
// (D-CREDIT), append the -1 job_deduction ledger row. The tx COMMITS before any Gemini
// call (D16) — never hold the lock across the multi-second external call. Idempotent on
// jobID (ledger-insert-first: a second consume for the same job is a no-op).
func (s *BillingService) CheckAndConsumeCredit(ctx context.Context, tc model.TenantContext, jobID uuid.UUID) error {
	return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		return s.consumeCreditTx(ctx, q, tc, jobID)
	})
}

func (s *BillingService) consumeCreditTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, jobID uuid.UUID) error {
	centerUUID, userUUID, err := s.tenantUUIDs(tc)
	if err != nil {
		return err
	}
	if err := s.acquireLock(ctx, q, tc, lockClassCredit); err != nil {
		return err
	}
	credits, err := s.getOrCreateAICredits(ctx, q, tc)
	if err != nil {
		return err
	}
	credits, err = s.applyLazyReset(ctx, q, tc, credits)
	if err != nil {
		return err
	}

	// Idempotent FIRST (code-review 2026-09-29 F8): if this job was already charged, a
	// retry must be a silent no-op — never a 402 just because the balance has since hit
	// zero. This mirrors the ledger-insert-first no-op below, but pre-empts the balance
	// gate so an already-paid retry never surfaces INSUFFICIENT_CREDITS.
	if _, derr := q.GetJobDeductionRow(ctx, generated.GetJobDeductionRowParams{
		CenterID: pgUUID(centerUUID),
		RefJobID: pgUUID(jobID),
	}); derr == nil {
		return nil // already deducted for this job — idempotent no-op
	} else if !errors.Is(derr, pgx.ErrNoRows) {
		return fmt.Errorf("consume credit: check existing deduction: %w", derr)
	}

	// D25 (Story 9.2a) — TIER-ELIGIBILITY before the balance check. AI availability requires
	// the plan tier to INCLUDE AI (Pro/Studio), NOT merely a positive balance: a Free center
	// that carries add-on credits from a prior Pro plan (carry-forward, FR-64) has those
	// credits FROZEN — unusable until it re-upgrades. So a Free-tier consume is denied even
	// when addon_remaining > 0, and NOTHING is spent (the balance is untouched). Re-upgrading
	// via SetPlanFromPolar makes the same balance spendable again. The check is on the TIER's
	// catalog allowance (plan.AICreditsPerMonth), not the mutable ai_credits.monthly_allocation,
	// so a Pro center whose monthly bucket is exhausted still spends its add-on bucket.
	sub, err := s.getOrCreateSubscription(ctx, q, tc)
	if err != nil {
		return err
	}
	if plan.LimitsFor(plan.Tier(sub.Plan)).AICreditsPerMonth <= 0 {
		// The balance is frozen, not absent — surface it as INSUFFICIENT_CREDITS with 0
		// USABLE credits (the FE messages "N credits paused — available on Pro/Studio", 9-2b).
		return InsufficientCreditsError{Available: 0, Required: 1}
	}

	alloc := int(credits.MonthlyAllocation)
	used := int(credits.MonthlyUsed)
	addon := int(credits.AddonRemaining)
	available := (alloc - used) + addon
	if available <= 0 {
		if available < 0 {
			available = 0
		}
		return InsufficientCreditsError{Available: available, Required: 1}
	}

	// Spend monthly first, then addon (FR-64). period_end marks the monthly period a
	// monthly-bucket spend counts against so a cross-reset refund credits addon (D17).
	var periodEnd pgtype.Timestamptz
	if alloc-used > 0 {
		used++
		periodEnd = credits.ResetAt
	} else {
		addon--
	}
	newAvailable := (alloc - used) + addon

	// Ledger-insert-first (idempotent on (job, reason)): only mutate ai_credits if the
	// -1 row actually landed. A duplicate jobID consume is then a silent no-op.
	rows, err := q.InsertCreditLedgerRow(ctx, generated.InsertCreditLedgerRowParams{
		CenterID:     pgUUID(centerUUID),
		UserID:       pgUUID(userUUID),
		Change:       -1,
		Reason:       reasonJobDeduction,
		RefJobID:     pgUUID(jobID),
		BalanceAfter: int32(newAvailable),
		PeriodEnd:    periodEnd,
	})
	if err != nil {
		return fmt.Errorf("consume credit: ledger insert: %w", err)
	}
	if rows == 0 {
		return nil // already deducted for this job — idempotent no-op
	}
	if err := q.UpdateAICreditsBuckets(ctx, generated.UpdateAICreditsBucketsParams{
		CenterID:          pgUUID(centerUUID),
		MonthlyAllocation: int32(alloc),
		MonthlyUsed:       int32(used),
		AddonRemaining:    int32(addon),
		ResetAt:           credits.ResetAt,
	}); err != nil {
		return fmt.Errorf("consume credit: update buckets: %w", err)
	}
	return nil
}

// RefundCredit reverses the credit spent on a terminally-failed job (AC12/AC25/D17).
// Ledger-insert-FIRST idempotency: insert the +1 job_failed_refund row (ON CONFLICT DO
// NOTHING), then touch ai_credits ONLY if the row actually landed — so a double refund
// (or a refund of a never-deducted job) never double-credits. A refund whose deduction's
// period has already reset credits addon_remaining (never underflow monthly_used).
func (s *BillingService) RefundCredit(ctx context.Context, tc model.TenantContext, refJobID uuid.UUID) error {
	return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		return s.refundCreditTx(ctx, q, tc, refJobID)
	})
}

// RefundCreditTx reverses a terminally-failed job's credit on the CALLER's tx — the
// worker dispatcher's per-job tx when the D19 credit gate is armed — so the reversal
// commits atomically with the job's terminal transition (code-review 2026-09-29 F1).
// Mirrors consumeCreditTx's ledger-first idempotency; the own-tx RefundCredit wraps the
// same internal for the service/test path.
func (s *BillingService) RefundCreditTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, refJobID uuid.UUID) error {
	return s.refundCreditTx(ctx, q, tc, refJobID)
}

func (s *BillingService) refundCreditTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, refJobID uuid.UUID) error {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	if err := s.acquireLock(ctx, q, tc, lockClassCredit); err != nil {
		return err
	}

	// A refund of a never-deducted job is a no-op (never a free credit). The deduction
	// row also carries the user_id we attribute the reversal to (F1 — the worker path
	// has no enqueuing-user context).
	deduction, err := q.GetJobDeductionRow(ctx, generated.GetJobDeductionRowParams{
		CenterID: pgUUID(centerUUID),
		RefJobID: pgUUID(refJobID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("refund credit: read deduction: %w", err)
	}

	credits, err := s.getOrCreateAICredits(ctx, q, tc)
	if err != nil {
		return err
	}
	// Apply any pending lazy reset BEFORE deciding monthly-vs-addon (code-review
	// 2026-09-29 F4): if the wall clock has crossed reset_at but no consume/read has
	// rolled the period yet, the stale ResetAt would falsely match the deduction's
	// period and return the credit to monthly_used — which the reset then zeroes,
	// silently forfeiting it. Resetting first makes a cross-reset refund fall to addon.
	credits, err = s.applyLazyReset(ctx, q, tc, credits)
	if err != nil {
		return err
	}
	alloc := int(credits.MonthlyAllocation)
	used := int(credits.MonthlyUsed)
	addon := int(credits.AddonRemaining)

	// Same period as the deduction AND a monthly credit is reclaimable → give back to
	// monthly_used; otherwise (prior period, or nothing to reclaim) → addon_remaining
	// (D17 — never underflow monthly_used below 0).
	sameCurrentPeriod := deduction.PeriodEnd.Valid && credits.ResetAt.Valid &&
		deduction.PeriodEnd.Time.Equal(credits.ResetAt.Time)
	if sameCurrentPeriod && used > 0 {
		used--
	} else {
		addon++
	}
	newAvailable := (alloc - used) + addon

	rows, err := q.InsertCreditLedgerRow(ctx, generated.InsertCreditLedgerRowParams{
		CenterID:     pgUUID(centerUUID),
		UserID:       deduction.UserID,
		Change:       1,
		Reason:       reasonJobFailedRefund,
		RefJobID:     pgUUID(refJobID),
		BalanceAfter: int32(newAvailable),
	})
	if err != nil {
		return fmt.Errorf("refund credit: ledger insert: %w", err)
	}
	if rows == 0 {
		return nil // already refunded — idempotent no-op
	}
	if err := q.UpdateAICreditsBuckets(ctx, generated.UpdateAICreditsBucketsParams{
		CenterID:          pgUUID(centerUUID),
		MonthlyAllocation: int32(alloc),
		MonthlyUsed:       int32(used),
		AddonRemaining:    int32(addon),
		ResetAt:           credits.ResetAt,
	}); err != nil {
		return fmt.Errorf("refund credit: update buckets: %w", err)
	}
	return nil
}

// applyLazyReset rolls the monthly bucket over if the clock has crossed reset_at (D6):
// zero monthly_used (forfeiting the unused remainder), advance reset_at one month, carry
// addon forward, and append the monthly_grant ledger row whose balance_after re-syncs to
// the new available (D14 — delta = balance_after - prev, so the forfeit is auditable).
func (s *BillingService) applyLazyReset(ctx context.Context, q *generated.Queries, tc model.TenantContext, credits generated.AiCredit) (generated.AiCredit, error) {
	if !credits.ResetAt.Valid || s.clk.Now().Before(credits.ResetAt.Time) {
		return credits, nil
	}
	centerUUID, userUUID, err := s.tenantUUIDs(tc)
	if err != nil {
		return credits, err
	}
	alloc := int(credits.MonthlyAllocation)
	addon := int(credits.AddonRemaining)
	newAvailable := alloc + addon // monthly_used reset to 0
	// Advance reset_at past now, catching up EVERY elapsed period in one pass (code-review
	// 2026-09-29 F5): a center dormant for >1 month would otherwise show a past resetAt and
	// under-grant until enough calls accumulated. The forfeit model makes the net state
	// identical regardless of how many periods lapsed (monthly_used → 0), so a single grant
	// row to the new available is the correct, auditable outcome (D14).
	next := credits.ResetAt.Time
	for !next.After(s.clk.Now()) {
		next = next.AddDate(0, 1, 0)
	}
	newResetAt := pgTimestamptz(next)

	prevBalance := 0
	if bal, err := q.GetLatestLedgerBalanceAfter(ctx, pgUUID(centerUUID)); err == nil {
		prevBalance = int(bal)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return credits, fmt.Errorf("lazy reset: latest balance: %w", err)
	}

	if err := q.UpdateAICreditsBuckets(ctx, generated.UpdateAICreditsBucketsParams{
		CenterID:          pgUUID(centerUUID),
		MonthlyAllocation: int32(alloc),
		MonthlyUsed:       0,
		AddonRemaining:    int32(addon),
		ResetAt:           newResetAt,
	}); err != nil {
		return credits, fmt.Errorf("lazy reset: update buckets: %w", err)
	}
	if _, err := q.InsertCreditLedgerRow(ctx, generated.InsertCreditLedgerRowParams{
		CenterID:     pgUUID(centerUUID),
		UserID:       pgUUID(userUUID),
		Change:       int32(newAvailable - prevBalance),
		Reason:       reasonMonthlyGrant,
		RefJobID:     pgtype.UUID{}, // NULL — grants stack freely (NULLs distinct)
		BalanceAfter: int32(newAvailable),
		PeriodEnd:    newResetAt,
	}); err != nil {
		return credits, fmt.Errorf("lazy reset: grant ledger: %w", err)
	}

	credits.MonthlyUsed = 0
	credits.ResetAt = newResetAt
	return credits, nil
}

// --- get-or-create (D26c defensive; also the on-center-create + genesis path) ----------

func (s *BillingService) getOrCreateSubscription(ctx context.Context, q *generated.Queries, tc model.TenantContext) (generated.Subscription, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return generated.Subscription{}, &ForbiddenError{Reason: "invalid tenant context"}
	}
	sub, err := q.GetSubscription(ctx, pgUUID(centerUUID))
	if err == nil {
		return sub, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return generated.Subscription{}, fmt.Errorf("get subscription: %w", err)
	}
	created, err := q.InsertSubscriptionDefault(ctx, pgUUID(centerUUID))
	if err == nil {
		return created, nil
	}
	if errors.Is(err, pgx.ErrNoRows) { // ON CONFLICT DO NOTHING race — re-read the winner
		sub, rerr := q.GetSubscription(ctx, pgUUID(centerUUID))
		if rerr != nil {
			// The row must exist after a DO-NOTHING conflict; a miss here is an internal
			// invariant break — wrap it so it maps to a 500, never a bare/unmapped
			// pgx.ErrNoRows that could be mistaken for a NotFound (code-review F9).
			return generated.Subscription{}, fmt.Errorf("get subscription after conflict: %w", rerr)
		}
		return sub, nil
	}
	return generated.Subscription{}, fmt.Errorf("create subscription: %w", err)
}

func (s *BillingService) getOrCreateAICredits(ctx context.Context, q *generated.Queries, tc model.TenantContext) (generated.AiCredit, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return generated.AiCredit{}, &ForbiddenError{Reason: "invalid tenant context"}
	}
	credits, err := q.GetAICredits(ctx, pgUUID(centerUUID))
	if err == nil {
		return credits, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return generated.AiCredit{}, fmt.Errorf("get ai credits: %w", err)
	}
	// Defensive create — a genesis-Free 0/0/0 row with reset_at = start of next month
	// (UTC is acceptable for this fallback; the backfill computes the VN-local value).
	created, err := q.InsertAICreditsDefault(ctx, generated.InsertAICreditsDefaultParams{
		CenterID:          pgUUID(centerUUID),
		MonthlyAllocation: 0,
		ResetAt:           pgTimestamptz(startOfNextMonthUTC(s.clk.Now())),
	})
	if err == nil {
		return created, nil
	}
	if errors.Is(err, pgx.ErrNoRows) { // ON CONFLICT DO NOTHING race — re-read the winner
		credits, rerr := q.GetAICredits(ctx, pgUUID(centerUUID))
		if rerr != nil {
			return generated.AiCredit{}, fmt.Errorf("get ai credits after conflict: %w", rerr)
		}
		return credits, nil
	}
	return generated.AiCredit{}, fmt.Errorf("create ai credits: %w", err)
}

// SetPlan is the plan-override seam (D19 — pilot/dogfood → Studio) and the 9.2 plan-change
// write path. Writes the subscription row AND centers.storage_limit_bytes from the plan
// (D21) in one tenant tx.
func (s *BillingService) SetPlan(ctx context.Context, tc model.TenantContext, tier plan.Tier, cycle string) error {
	if !plan.IsValid(tier) {
		return model.ValidationError{Fields: []model.FieldError{{Field: "plan", Message: "unknown plan tier"}}}
	}
	// Reject an unknown billing cycle rather than silently coercing it to "monthly"
	// (code-review 2026-09-29 F11) — a caller typo must surface, not persist a wrong cycle.
	if cycle != "monthly" && cycle != "annual" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "billingCycle", Message: "must be 'monthly' or 'annual'"}}}
	}
	centerUUID, userUUID, err := s.tenantUUIDs(tc)
	if err != nil {
		return err
	}
	return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		if _, err := s.getOrCreateSubscription(ctx, q, tc); err != nil {
			return err
		}
		var periodEnd pgtype.Timestamptz
		if tier != plan.Free {
			periodEnd = pgTimestamptz(s.clk.Now().AddDate(0, 1, 0))
		}
		if err := q.SetPlan(ctx, generated.SetPlanParams{
			CenterID:           pgUUID(centerUUID),
			Plan:               string(tier),
			BillingCycle:       cycle,
			Status:             "active",
			CurrentPeriodStart: pgTimestamptz(s.clk.Now()),
			CurrentPeriodEnd:   periodEnd,
		}); err != nil {
			return fmt.Errorf("set plan: %w", err)
		}
		if err := q.UpdateCenterStorageLimit(ctx, generated.UpdateCenterStorageLimitParams{
			ID:                pgUUID(centerUUID),
			StorageLimitBytes: plan.LimitsFor(tier).StorageBytes,
		}); err != nil {
			return fmt.Errorf("set plan: storage limit: %w", err)
		}
		// Grant the tier's monthly AI-credit allocation (code-review 2026-09-29 F2). Before
		// this fix SetPlan wrote the plan + storage but left ai_credits.monthly_allocation
		// at the genesis 0 — so a center upgraded via this seam had 0 credits and 402'd
		// every AI job, defeating the seam's own purpose (testing enforcement before 9.2).
		// A plan change resets the monthly bucket and grants immediately (addon carries).
		return s.grantPlanAllocationTx(ctx, q, tc, centerUUID, userUUID, tier)
	})
}

// grantPlanAllocationTx sets ai_credits.monthly_allocation to the tier's allowance, resets
// monthly_used to 0, and appends a chain-consistent monthly_grant ledger row (D14). Runs on
// the caller's tx under the (center,credit) lock. Used by SetPlan (F2) — the immediate grant
// makes an upgraded plan usable at once; proration/timing refinements are a 9.2 concern.
func (s *BillingService) grantPlanAllocationTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, centerUUID, userUUID uuid.UUID, tier plan.Tier) error {
	if err := s.acquireLock(ctx, q, tc, lockClassCredit); err != nil {
		return err
	}
	credits, err := s.getOrCreateAICredits(ctx, q, tc)
	if err != nil {
		return err
	}
	newAlloc := plan.LimitsFor(tier).AICreditsPerMonth
	if newAlloc < 0 { // no tier is Unlimited on credits; defensive against a future sentinel
		newAlloc = 0
	}
	addon := int(credits.AddonRemaining)
	newAvailable := newAlloc + addon // monthly_used reset to 0 on a plan change

	// Keep a valid future reset boundary; recompute if it is stale/unset.
	resetAt := credits.ResetAt
	if !resetAt.Valid || !resetAt.Time.After(s.clk.Now()) {
		resetAt = pgTimestamptz(startOfNextMonthUTC(s.clk.Now()))
	}

	prevBalance := 0
	if bal, err := q.GetLatestLedgerBalanceAfter(ctx, pgUUID(centerUUID)); err == nil {
		prevBalance = int(bal)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("set plan: latest balance: %w", err)
	}

	if err := q.UpdateAICreditsBuckets(ctx, generated.UpdateAICreditsBucketsParams{
		CenterID:          pgUUID(centerUUID),
		MonthlyAllocation: int32(newAlloc),
		MonthlyUsed:       0,
		AddonRemaining:    int32(addon),
		ResetAt:           resetAt,
	}); err != nil {
		return fmt.Errorf("set plan: update buckets: %w", err)
	}
	if _, err := q.InsertCreditLedgerRow(ctx, generated.InsertCreditLedgerRowParams{
		CenterID:     pgUUID(centerUUID),
		UserID:       pgUUID(userUUID),
		Change:       int32(newAvailable - prevBalance),
		Reason:       reasonMonthlyGrant,
		RefJobID:     pgtype.UUID{}, // NULL — grants stack freely (NULLs distinct)
		BalanceAfter: int32(newAvailable),
		PeriodEnd:    resetAt,
	}); err != nil {
		return fmt.Errorf("set plan: grant ledger: %w", err)
	}
	return nil
}

// EnsureBillingRows creates the subscription + ai_credits rows for a center if absent
// (on-center-create wiring, D7/D26c). Callers pass the tx-bound queries so the rows land
// in the same tx as the center. resetAt should be the VN-local start of next month.
func (s *BillingService) EnsureBillingRows(ctx context.Context, q *generated.Queries, tc model.TenantContext, resetAt time.Time) error {
	if _, err := s.getOrCreateSubscription(ctx, q, tc); err != nil {
		return err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	if _, err := q.GetAICredits(ctx, pgUUID(centerUUID)); err == nil {
		return nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("ensure ai credits: %w", err)
	}
	if _, err := q.InsertAICreditsDefault(ctx, generated.InsertAICreditsDefaultParams{
		CenterID:          pgUUID(centerUUID),
		MonthlyAllocation: 0,
		ResetAt:           pgTimestamptz(resetAt),
	}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("ensure ai credits: %w", err)
	}
	return nil
}

// --- shared internals ------------------------------------------------------------------

func (s *BillingService) acquireLock(ctx context.Context, q *generated.Queries, tc model.TenantContext, resourceClass int) error {
	if err := q.AcquireCenterResourceLock(ctx, generated.AcquireCenterResourceLockParams{
		CenterID:      tc.CenterID,
		ResourceClass: int32(resourceClass),
	}); err != nil {
		return fmt.Errorf("acquire billing lock (class %d): %w", resourceClass, err)
	}
	return nil
}

func (s *BillingService) tenantUUIDs(tc model.TenantContext) (uuid.UUID, uuid.UUID, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	userUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context: user"}
	}
	return centerUUID, userUUID, nil
}

// inTenantTx runs fn in a fresh tenant-scoped tx (SET LOCAL app.current_tenant_id, PERF-1).
func (s *BillingService) inTenantTx(ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("billing tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("billing tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// startOfNextMonthUTC returns the first instant of the month after now, in UTC. Used only
// for the defensive get-or-create fallback (the genesis backfill computes VN-local).
func startOfNextMonthUTC(now time.Time) time.Time {
	y, m, _ := now.UTC().Date()
	return time.Date(y, m+1, 1, 0, 0, 0, 0, time.UTC)
}

// StartOfNextMonthInTZ returns the first instant of the month after now, at local
// midnight in the named timezone (D24/D26a — the VN-local reset boundary for a new
// center). An unknown tz falls back to UTC.
func StartOfNextMonthInTZ(now time.Time, tz string) time.Time {
	loc, err := time.LoadLocation(tz)
	if err != nil || loc == nil {
		loc = time.UTC
	}
	local := now.In(loc)
	return time.Date(local.Year(), local.Month()+1, 1, 0, 0, 0, 0, loc)
}

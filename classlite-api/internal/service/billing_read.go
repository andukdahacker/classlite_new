// Story 9.1a — the Owner-only billing read model (D9/D22/D24). GetUsageAndLimits drives
// GET /api/billing (plan + limits + live usage; NO next-invoice/payment-method — D-DASH);
// ListPlans drives GET /api/billing/plans (the static VND+VAT tier catalog). The read is
// the SINGLE source for the soft-warning `approaching` booleans (D22 — the FE renders,
// never recomputes). Max == plan.Unlimited (-1) is rendered as JSON null by the handler.
package service

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/plan"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
)

// CountMeter is a current/max usage meter with the server-computed approaching flag
// (D4/D22). Max == plan.Unlimited (-1) means no ceiling (JSON null on the wire).
type CountMeter struct {
	Current     int
	Max         int
	Approaching bool
}

// CreditMeter is the AI-credit bucket snapshot (D24). ResetAt is VN-local midnight of
// the next period start (documented; the handler serializes the instant).
type CreditMeter struct {
	MonthlyAllocation int
	MonthlyUsed       int
	AddonRemaining    int
	Available         int
	ResetAt           time.Time
}

// StorageMeter mirrors the 4.4a storage ceiling (now plan-driven, D21).
type StorageMeter struct {
	UsedBytes   int64
	LimitBytes  int64
	PercentUsed int
	Approaching bool
}

// BillingLimits is the plan's caps (Unlimited == -1 → JSON null).
type BillingLimits struct {
	Teachers          int
	Classes           int
	StudentsPerClass  int
	AICreditsPerMonth int
	StorageBytes      int64
}

// NextInvoiceInfo is the upcoming renewal charge projection (Story 9.2a, D-DASH). AmountVnd is
// the plan's price for the current cycle (display estimate — Polar is authoritative for the
// actual charge, D25); DueDate is the current period end. Null on a Free/no-Polar center.
type NextInvoiceInfo struct {
	AmountVnd int
	DueDate   time.Time
}

// PaymentMethodInfo is the card-on-file summary (Story 9.2a; persisted in 9.2b, Task 11).
// {Brand, Last4} is Polar's MASKED descriptor (e.g. 'visa' / '4242'), never raw card data
// (epic:127-130). Null when absent (Free / no Polar / pre-first-payment) — GO-5 explicit null.
type PaymentMethodInfo struct {
	Brand string
	Last4 string
}

// PendingDowngradeInfo is a scheduled at-renewal downgrade (Story 9.2a, E17/D9). Null when none.
type PendingDowngradeInfo struct {
	Plan        string
	EffectiveAt time.Time
}

// BillingSummary is the GET /api/billing model (AC15/AC27). Story 9.2a adds the D-DASH cards
// deferred from 9-1a: NextInvoice + PaymentMethod + PendingDowngrade (all explicit-null when
// absent — GO-5; every one is null on a Free/no-Polar center).
type BillingSummary struct {
	Plan               string
	BillingCycle       string
	Status             string
	IsFree             bool
	CreditsApplicable  bool
	CurrentPeriodStart time.Time
	CurrentPeriodEnd   *time.Time
	Limits             BillingLimits
	TeacherSeats       CountMeter
	Classes            CountMeter
	Credits            CreditMeter
	Storage            StorageMeter
	NextInvoice        *NextInvoiceInfo
	PaymentMethod      *PaymentMethodInfo
	PendingDowngrade   *PendingDowngradeInfo
}

// PlanCatalogEntry is one tier in GET /api/billing/plans (AC17).
type PlanCatalogEntry struct {
	Plan            string
	Limits          BillingLimits
	PriceMonthlyVnd int
	PriceAnnualVnd  int
	VAT             plan.VATBreakdown
}

// approaching reports current >= ceil(max * PlanApproachingThreshold) (D4). Unlimited or
// a non-positive max never approaches.
func approaching(current, max int) bool {
	if max == plan.Unlimited || max <= 0 {
		return false
	}
	return float64(current) >= math.Ceil(float64(max)*PlanApproachingThreshold)
}

func percentUsed(used, limit int64) int {
	if limit <= 0 {
		return 0
	}
	return int((used * 100) / limit)
}

func limitsFromPlan(l plan.Limits) BillingLimits {
	return BillingLimits{
		Teachers:          l.TeachersMax,
		Classes:           l.ClassesMax,
		StudentsPerClass:  l.StudentsPerClassMax,
		AICreditsPerMonth: l.AICreditsPerMonth,
		StorageBytes:      l.StorageBytes,
	}
}

// GetUsageAndLimits builds the billing summary for the caller's center (AC15). Owner-only
// authz is enforced at the route (RequireRole "owner", D9); this method assumes the
// caller passed the gate. It lazy-resets the credit period (D6) under the (center,credit)
// lock so the meter is fresh, then reads live counts (PERF-2 aggregate) for the meters.
func (s *BillingService) GetUsageAndLimits(ctx context.Context, tc model.TenantContext) (BillingSummary, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return BillingSummary{}, &ForbiddenError{Reason: "invalid tenant context"}
	}

	// Story 9.2a (D18) — lost-webhook reconcile BEFORE building the summary, so a checkout whose
	// confirming webhook never arrived is applied (once) and the fresh reads below reflect it.
	// No-op when no Polar client / no pending intents; idempotent on a second GET.
	if err := s.ReconcilePendingCheckouts(ctx, tc); err != nil {
		return BillingSummary{}, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return BillingSummary{}, fmt.Errorf("billing summary: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return BillingSummary{}, fmt.Errorf("billing summary: %w", err)
	}
	q := generated.New(tx)

	sub, err := s.getOrCreateSubscription(ctx, q, tc)
	if err != nil {
		return BillingSummary{}, err
	}
	// Acquire the (center,credit) lock BEFORE reading the credit row (code-review
	// 2026-09-29 F3). Reading first and then lazy-resetting on that pre-lock snapshot
	// races a concurrent consume: the unconditional bucket UPDATE inside applyLazyReset
	// would clobber the consume's decrement and append a duplicate monthly_grant row.
	// consumeCreditTx reads under the lock; this path must too.
	if err := s.acquireLock(ctx, q, tc, lockClassCredit); err != nil {
		return BillingSummary{}, err
	}
	credits, err := s.getOrCreateAICredits(ctx, q, tc)
	if err != nil {
		return BillingSummary{}, err
	}
	credits, err = s.applyLazyReset(ctx, q, tc, credits)
	if err != nil {
		return BillingSummary{}, err
	}

	tier := plan.Tier(sub.Plan)
	limits := plan.LimitsFor(tier)

	teacherCount, err := q.CountTeacherSeats(ctx, pgUUID(centerUUID))
	if err != nil {
		return BillingSummary{}, fmt.Errorf("billing summary: teacher count: %w", err)
	}
	classCount, err := q.CountCenterClasses(ctx, pgUUID(centerUUID))
	if err != nil {
		return BillingSummary{}, fmt.Errorf("billing summary: class count: %w", err)
	}
	storageUsed, err := q.SumFileSizeByCenter(ctx, pgUUID(centerUUID))
	if err != nil {
		return BillingSummary{}, fmt.Errorf("billing summary: storage used: %w", err)
	}
	storageLimit, err := q.GetCenterStorageLimit(ctx, pgUUID(centerUUID))
	if err != nil {
		return BillingSummary{}, fmt.Errorf("billing summary: storage limit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return BillingSummary{}, fmt.Errorf("billing summary: commit: %w", err)
	}

	alloc := int(credits.MonthlyAllocation)
	used := int(credits.MonthlyUsed)
	addon := int(credits.AddonRemaining)
	available := (alloc - used) + addon
	if available < 0 { // clamp for display — mirror the consume gate (code-review F12)
		available = 0
	}

	var periodEnd *time.Time
	if sub.CurrentPeriodEnd.Valid {
		t := sub.CurrentPeriodEnd.Time
		periodEnd = &t
	}

	// D-DASH cards (Story 9.2a). nextInvoice is the upcoming renewal charge (plan price at the
	// current cycle, display estimate — D25); pendingDowngrade surfaces a scheduled at-renewal
	// change (E17) — 9-2b renders "Downgrade scheduled for [date]" + warns an add-on purchase
	// when a downgrade-to-Free is pending (D25). paymentMethod stays null (PROVISIONAL — not yet
	// persisted from Polar, 9-2b co-finalizes).
	var nextInvoice *NextInvoiceInfo
	if tier != plan.Free && sub.CurrentPeriodEnd.Valid {
		prices := plan.PricesFor(tier)
		amount := prices.MonthlyVnd
		if sub.BillingCycle == "annual" {
			amount = prices.AnnualVnd
		}
		nextInvoice = &NextInvoiceInfo{AmountVnd: amount, DueDate: sub.CurrentPeriodEnd.Time}
	}
	var pendingDowngrade *PendingDowngradeInfo
	if sub.PendingPlan.Valid && sub.PendingPlan.String != "" {
		pd := &PendingDowngradeInfo{Plan: sub.PendingPlan.String}
		if sub.PendingEffectiveAt.Valid {
			pd.EffectiveAt = sub.PendingEffectiveAt.Time
		}
		pendingDowngrade = pd
	}
	// Story 9.2b (AC12) — the real card-on-file, persisted from the Polar webhook. Null when
	// absent (Free / no Polar / pre-first-payment); the FE degrades to "Managed by Polar".
	var paymentMethod *PaymentMethodInfo
	if sub.PaymentBrand.Valid && sub.PaymentBrand.String != "" &&
		sub.PaymentLast4.Valid && sub.PaymentLast4.String != "" {
		paymentMethod = &PaymentMethodInfo{Brand: sub.PaymentBrand.String, Last4: sub.PaymentLast4.String}
	}

	return BillingSummary{
		Plan:               sub.Plan,
		BillingCycle:       sub.BillingCycle,
		Status:             sub.Status,
		IsFree:             tier == plan.Free,
		CreditsApplicable:  limits.AICreditsPerMonth > 0,
		CurrentPeriodStart: sub.CurrentPeriodStart.Time,
		CurrentPeriodEnd:   periodEnd,
		Limits:             limitsFromPlan(limits),
		TeacherSeats:       CountMeter{Current: int(teacherCount), Max: limits.TeachersMax, Approaching: approaching(int(teacherCount), limits.TeachersMax)},
		Classes:            CountMeter{Current: int(classCount), Max: limits.ClassesMax, Approaching: approaching(int(classCount), limits.ClassesMax)},
		Credits: CreditMeter{
			MonthlyAllocation: alloc,
			MonthlyUsed:       used,
			AddonRemaining:    addon,
			Available:         available,
			ResetAt:           credits.ResetAt.Time,
		},
		Storage: StorageMeter{
			UsedBytes:   storageUsed,
			LimitBytes:  storageLimit,
			PercentUsed: percentUsed(storageUsed, storageLimit),
			Approaching: storageLimit > 0 && float64(storageUsed) >= math.Ceil(float64(storageLimit)*PlanApproachingThreshold),
		},
		NextInvoice:      nextInvoice,
		PaymentMethod:    paymentMethod,
		PendingDowngrade: pendingDowngrade,
	}, nil
}

// ListPlans returns the static three-tier catalog from the internal/plan constants
// (AC17) — the data the 9-1b picker + the landing pricing page both render. No DB access
// (display-only, D25).
func (s *BillingService) ListPlans() []PlanCatalogEntry {
	tiers := plan.AllTiers()
	out := make([]PlanCatalogEntry, 0, len(tiers))
	for _, t := range tiers {
		prices := plan.PricesFor(t)
		out = append(out, PlanCatalogEntry{
			Plan:            string(t),
			Limits:          limitsFromPlan(plan.LimitsFor(t)),
			PriceMonthlyVnd: prices.MonthlyVnd,
			PriceAnnualVnd:  prices.AnnualVnd,
			VAT:             plan.VATFor(t),
		})
	}
	return out
}

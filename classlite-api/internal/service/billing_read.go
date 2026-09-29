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

// BillingSummary is the GET /api/billing model (AC15/AC27). NO nextInvoice/paymentMethod
// (D-DASH → 9.2).
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

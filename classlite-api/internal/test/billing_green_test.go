// Story 9-1a — green-phase coverage for the ACs the 8 WF-8 reds don't exercise:
// the dark-launch flag (AC21/D19), monthly-then-addon spend ordering (AC12), the
// plan-driven storage ceiling (AC6/AC21/D21), the error actor-context (AC26/D23),
// on-center-create row provisioning (AC4/D7), and the month-arithmetic reset (AC30/D26f).
package test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/plan"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
)

// AC21/D19 — the enrollment gate is a pure no-op when BILLING_ENFORCEMENT_ENABLED is
// off (the 9-1a prod default): an over-cap enrolment SUCCEEDS. Flipped on, it 409s.
func TestBilling_EnforcementFlag_OffSucceeds_OnBlocks(t *testing.T) {
	ctx := context.Background()

	t.Run("flag off — over-cap enrolment succeeds", func(t *testing.T) {
		// (flag unset by default)
		pool := SetupRawPool(t)
		_, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0)) // Free/5
		classID, spares := seedFreeClass(t, pool, tc, 5 /*at cap*/, 1)
		enrollSvc := newEnrollmentServiceForRace(t, pool)

		if _, err := enrollSvc.CreateEnrollment(ctx, tc, spares[0], classID); err != nil {
			t.Fatalf("flag OFF: over-cap enrolment should succeed, got %v", err)
		}
		var active int
		_ = SuperuserPool(t).QueryRow(ctx, `SELECT count(*) FROM enrollments WHERE class_id=$1 AND status='active'`, classID).Scan(&active)
		if active != 6 {
			t.Errorf("flag OFF: want 6 active (no cap), got %d", active)
		}
	})

	t.Run("flag on — over-cap enrolment blocked", func(t *testing.T) {
		t.Setenv("BILLING_ENFORCEMENT_ENABLED", "true")
		pool := SetupRawPool(t)
		_, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
		classID, spares := seedFreeClass(t, pool, tc, 5 /*at cap*/, 1)
		enrollSvc := newEnrollmentServiceForRace(t, pool)

		_, err := enrollSvc.CreateEnrollment(ctx, tc, spares[0], classID)
		if !errors.As(err, &service.PlanLimitExceededError{}) {
			t.Fatalf("flag ON: over-cap enrolment should 409 PLAN_LIMIT_EXCEEDED, got %v", err)
		}
	})
}

// AC12/D-CREDIT — spend the monthly allowance FIRST, then addon (add-ons consumed after
// allocation, FR-64). A Pro center with allocation 1 + addon 2 (available 3): consume
// drains monthly_used to 1, then addon 2→1→0, then 402.
func TestBilling_SpendMonthlyThenAddon_Ordering(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	centerID, tc := newBillingCenter(t, "pro", 1, 0, 2, billingEpoch.AddDate(0, 1, 0)) // available 3
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	// 1st spend: monthly first.
	if err := svc.CheckAndConsumeCredit(ctx, tc, uuid.New()); err != nil {
		t.Fatalf("spend 1: %v", err)
	}
	if s := readAICredits(t, centerID); s.Used != 1 || s.Addon != 2 {
		t.Fatalf("after spend 1: want used=1 addon=2, got used=%d addon=%d", s.Used, s.Addon)
	}
	// 2nd + 3rd spends: monthly exhausted → addon drains.
	if err := svc.CheckAndConsumeCredit(ctx, tc, uuid.New()); err != nil {
		t.Fatalf("spend 2: %v", err)
	}
	if s := readAICredits(t, centerID); s.Used != 1 || s.Addon != 1 {
		t.Fatalf("after spend 2: want used=1 addon=1, got used=%d addon=%d", s.Used, s.Addon)
	}
	if err := svc.CheckAndConsumeCredit(ctx, tc, uuid.New()); err != nil {
		t.Fatalf("spend 3: %v", err)
	}
	if s := readAICredits(t, centerID); s.Addon != 0 {
		t.Fatalf("after spend 3: want addon=0, got addon=%d", s.Addon)
	}
	// 4th: exhausted → 402.
	if err := svc.CheckAndConsumeCredit(ctx, tc, uuid.New()); !errors.As(err, &service.InsufficientCreditsError{}) {
		t.Fatalf("spend 4 (exhausted): want INSUFFICIENT_CREDITS, got %v", err)
	}
}

// AC6/AC21/D21 — SetPlan writes centers.storage_limit_bytes FROM the plan (Studio → 50
// GiB) and flips the subscription tier, in one tx. The override seam (D19).
func TestBilling_SetPlan_WritesStorageCeilingFromPlan(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	centerID, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	if err := svc.SetPlan(ctx, tc, plan.Studio, "monthly"); err != nil {
		t.Fatalf("SetPlan(studio): %v", err)
	}
	var limit int64
	var planName string
	sp := SuperuserPool(t)
	_ = sp.QueryRow(ctx, `SELECT storage_limit_bytes FROM centers WHERE id=$1`, centerID).Scan(&limit)
	_ = sp.QueryRow(ctx, `SELECT plan FROM subscriptions WHERE center_id=$1`, centerID).Scan(&planName)
	if want := plan.LimitsFor(plan.Studio).StorageBytes; limit != want {
		t.Errorf("storage_limit_bytes = %d, want %d (Studio 50 GiB)", limit, want)
	}
	if planName != "studio" {
		t.Errorf("subscription.plan = %q, want studio", planName)
	}
}

// F2 (code-review 2026-09-29) — SetPlan must ALSO grant the tier's monthly AI-credit
// allocation. Before the fix it wrote plan + storage but left monthly_allocation at the
// genesis 0, so a center upgraded via the seam had 0 credits and 402'd every AI job —
// defeating the seam's stated purpose (testing enforcement before 9.2). A Free (0-credit)
// center set to Studio must end with allocation 2000, available 2000, and a spendable
// credit; the grant is a chain-consistent monthly_grant ledger row (D14).
func TestBilling_SetPlan_GrantsMonthlyCredits(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	centerID, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	if err := svc.SetPlan(ctx, tc, plan.Studio, "monthly"); err != nil {
		t.Fatalf("SetPlan(studio): %v", err)
	}

	want := plan.LimitsFor(plan.Studio).AICreditsPerMonth // 2000
	s := readAICredits(t, centerID)
	if s.Allocation != want || s.Used != 0 || s.Available() != want {
		t.Fatalf("after SetPlan(studio): want allocation=%d used=0 available=%d, got allocation=%d used=%d available=%d",
			want, want, s.Allocation, s.Used, s.Available())
	}
	// D14 — the grant re-synced the ledger head to the new available.
	if bal := latestLedgerBalanceAfter(t, centerID); bal != want {
		t.Errorf("ledger head balance_after = %d, want %d (grant re-sync)", bal, want)
	}
	assertLedgerChainIntegrity(t, centerID)
	// The upgraded plan is actually usable — a consume succeeds (no spurious 402).
	if err := svc.CheckAndConsumeCredit(ctx, tc, uuid.New()); err != nil {
		t.Fatalf("post-upgrade consume should succeed, got %v", err)
	}
	if s := readAICredits(t, centerID); s.Used != 1 {
		t.Errorf("after 1 consume: want used=1, got used=%d", s.Used)
	}
}

// F11 (code-review 2026-09-29) — an unknown billing cycle is rejected, not silently
// coerced to "monthly".
func TestBilling_SetPlan_RejectsUnknownCycle(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	_, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	err := svc.SetPlan(ctx, tc, plan.Pro, "quarterly")
	if !errors.As(err, &model.ValidationError{}) {
		t.Fatalf("SetPlan with bad cycle: want ValidationError, got %v", err)
	}
}

// AC26/D23 — the PlanLimitExceededError carries CanManageBilling: true for an owner (who
// can upgrade), false for a teacher (who must ask the owner). The load-bearing actor-context.
func TestBilling_PlanLimitError_CanManageBilling_ActorContext(t *testing.T) {
	t.Setenv("BILLING_ENFORCEMENT_ENABLED", "true")
	pool := SetupRawPool(t)
	ctx := context.Background()
	_, ownerTCx := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	classID, _ := seedFreeClass(t, pool, ownerTCx, 5 /*at cap*/, 0)
	svc := service.NewBillingService(pool)

	check := func(role string) service.PlanLimitExceededError {
		t.Helper()
		tc := model.TenantContext{CenterID: ownerTCx.CenterID, UserID: ownerTCx.UserID, Role: role}
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer func() { _ = tx.Rollback(context.Background()) }()
		if err := store.SetTenantContext(ctx, tx, tc); err != nil {
			t.Fatalf("set tenant: %v", err)
		}
		err = svc.CheckStudentPerClass(ctx, generated.New(tx), tc, classID)
		var limitErr service.PlanLimitExceededError
		if !errors.As(err, &limitErr) {
			t.Fatalf("role %s: want PlanLimitExceededError, got %v", role, err)
		}
		return limitErr
	}

	if !check(model.RoleOwner).CanManageBilling {
		t.Error("owner: CanManageBilling should be true")
	}
	if check(model.RoleTeacher).CanManageBilling {
		t.Error("teacher: CanManageBilling should be false (ask your center owner)")
	}
}

// AC4/D7/D26c — EnsureBillingRows provisions the Free subscription + 0/0/0 ai_credits row
// for a center that has neither (the on-center-create path), in the caller's tx.
func TestBilling_EnsureBillingRows_ProvisionsBothRows(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	sp := SuperuserPool(t)
	centerID := NewPGUUIDFromString(uuid.NewString())
	short := "ensure-" + uuid.NewString()[:8]
	if _, err := sp.Exec(ctx, `INSERT INTO centers (id, name, short_code) VALUES ($1,$2,$3)`, centerID, "Ensure", short); err != nil {
		t.Fatalf("create center: %v", err)
	}
	t.Cleanup(func() {
		_, _ = sp.Exec(ctx, `DELETE FROM ai_credits WHERE center_id=$1`, centerID)
		_, _ = sp.Exec(ctx, `DELETE FROM subscriptions WHERE center_id=$1`, centerID)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id=$1`, centerID)
	})
	tc := model.TenantContext{CenterID: UUIDString(centerID), UserID: uuid.NewString(), Role: string(model.RoleOwner)}

	svc := service.NewBillingService(pool)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		t.Fatalf("set tenant: %v", err)
	}
	resetAt := service.StartOfNextMonthInTZ(billingEpoch, "Asia/Ho_Chi_Minh")
	if err := svc.EnsureBillingRows(ctx, generated.New(tx), tc, resetAt); err != nil {
		t.Fatalf("EnsureBillingRows: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	var subs, credits int
	_ = sp.QueryRow(ctx, `SELECT count(*) FROM subscriptions WHERE center_id=$1 AND plan='free'`, centerID).Scan(&subs)
	_ = sp.QueryRow(ctx, `SELECT count(*) FROM ai_credits WHERE center_id=$1 AND monthly_allocation=0`, centerID).Scan(&credits)
	if subs != 1 || credits != 1 {
		t.Fatalf("want 1 free subscription + 1 zero ai_credits row, got subs=%d credits=%d", subs, credits)
	}
}

// AC30/D26f — the lazy reset advances reset_at by exactly one calendar month, correct
// across a short month (Feb→Mar) and a year boundary (Dec→Jan). reset_at is always a
// month-start, so AddDate(0,1,0) is unambiguous.
func TestBilling_LazyReset_MonthArithmetic(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name        string
		resetAt     time.Time
		wantAdvance time.Time
	}{
		{"feb-to-mar", time.Date(2027, 2, 1, 0, 0, 0, 0, time.UTC), time.Date(2027, 3, 1, 0, 0, 0, 0, time.UTC)},
		{"dec-to-jan", time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC), time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pool := SetupRawPool(t)
			// clk one day past reset_at → the consume triggers the lazy reset.
			clk := clock.NewMockClock(c.resetAt.AddDate(0, 0, 1))
			centerID, tc := newBillingCenter(t, "pro", 500, 0, 0, c.resetAt)
			svc := service.NewBillingServiceWithClock(pool, clk)
			if err := svc.CheckAndConsumeCredit(ctx, tc, uuid.New()); err != nil {
				t.Fatalf("consume: %v", err)
			}
			if got := readAICredits(t, centerID).ResetAt; !got.Equal(c.wantAdvance) {
				t.Errorf("reset_at = %s, want advanced one month to %s", got, c.wantAdvance)
			}
		})
	}
}

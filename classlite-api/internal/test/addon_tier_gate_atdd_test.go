// Story 9-2a — AC36 / AC9 / D25 (Ducdo-ruled, John: add-on credits are TIER-GATED).
// A Pro/Studio center that buys add-on credits then downgrades to Free keeps addon_remaining>0
// (carry-forward, FR-64) but those credits are UNUSABLE on Free — AI availability requires the
// tier to INCLUDE AI (Pro/Studio), NOT merely available>0. D25 changes CheckAndConsumeCredit
// (9-1a): a TIER-ELIGIBILITY check BEFORE the balance check. A Free center with
// addon_remaining=500 is denied (eligibility, not a payment problem); re-upgrade to Pro makes
// the same 500 usable. And a Free center can't even START an add-on purchase: CreateCheckout
// {kind:addon} → 403 ADDON_NOT_AVAILABLE, no Polar call. The 9-1a Pro spend path is unchanged.
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).CheckAndConsumeCredit — gains the D25 tier-eligibility
//       branch (Free denied even with addon balance). [signature exists; behavior is the seam]
//   · (svc *service.BillingService).SetPlanFromPolar(...) — the re-upgrade that re-enables it.
//   · (svc *service.BillingService).CreateCheckout(ctx, tc, kind, plan, cycle, addonPackID string)
//       (checkoutURL string, err error) — kind="addon" on Free → service.AddonNotAvailableError.
//   · service.AddonNotAvailableError — typed error → 403 ADDON_NOT_AVAILABLE (D7).
//   · plan.AddonPackByID(id) → {ID, Credits, PriceVnd, SubtotalVnd, VatVnd, Tiers} (D7 catalog).
//
// RED: compile-fails on svc.SetPlanFromPolar / svc.CreateCheckout / service.AddonNotAvailableError
// / plan.AddonPackByID (CheckAndConsumeCredit already exists — its D25 branch is behavioral).

package test

import (
	"context"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/plan"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

// TestAddonTierGate_FreeDeniedThenProSpends is the AC36/D25 core: a Free center with
// addon_remaining=500 is DENIED AI (tier eligibility before balance; the 500 is untouched);
// re-upgrading to Pro makes the same balance usable and a spend then succeeds.
func TestAddonTierGate_FreeDeniedThenProSpends(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	// Free tier, but carrying 500 add-on credits (bought on a prior Pro plan, carried forward).
	centerID, tc := newBillingCenter(t, "free", 0, 0, 500, billingEpoch.AddDate(0, 1, 0))

	// D25: eligibility fails on Free even though available == 500.
	if err := svc.CheckAndConsumeCredit(context.Background(), tc, uuid.New()); err == nil {
		t.Fatalf("CheckAndConsumeCredit on Free with addon_remaining=500 must DENY (tier eligibility before balance — D25)")
	}
	if got := readAddonRemaining(t, centerID); got != 500 {
		t.Errorf("addon_remaining = %d, want 500 untouched (a denied job must not spend)", got)
	}

	// Re-upgrade to Pro via the Polar apply path → the same 500 becomes usable.
	if err := svc.SetPlanFromPolar(context.Background(), tc, plan.Pro, "monthly", newPolarSubID(), billingEpoch, billingEpoch.AddDate(0, 1, 0)); err != nil {
		t.Fatalf("SetPlanFromPolar re-upgrade to Pro: %v", err)
	}

	availBefore := readAICredits(t, centerID).Available()
	if err := svc.CheckAndConsumeCredit(context.Background(), tc, uuid.New()); err != nil {
		t.Fatalf("CheckAndConsumeCredit after re-upgrade to Pro must SUCCEED: %v", err)
	}
	if got := readAICredits(t, centerID).Available(); got != availBefore-1 {
		t.Errorf("available = %d, want %d (exactly one credit spent after the tier became eligible)", got, availBefore-1)
	}
}

// TestAddonCheckout_FreeTier_AddonNotAvailable403 is AC9: a Free-tier owner starting an add-on
// purchase gets 403 ADDON_NOT_AVAILABLE (a plan-eligibility problem, not payment) and no
// checkout URL — no Polar call is made.
func TestAddonCheckout_FreeTier_AddonNotAvailable403(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	_, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))

	url, err := svc.CreateCheckout(context.Background(), tc, "addon", "", "", addonPack500ID)
	if err == nil {
		t.Fatalf("CreateCheckout{kind:addon} on Free must fail with ADDON_NOT_AVAILABLE (add-ons are Pro/Studio only — D7)")
	}
	if !errors.As(err, &service.AddonNotAvailableError{}) {
		t.Errorf("error = %T, want service.AddonNotAvailableError (→ 403 ADDON_NOT_AVAILABLE)", err)
	}
	if url != "" {
		t.Errorf("checkoutURL = %q, want empty (no Polar checkout created for an ineligible tier)", url)
	}
}

// TestAddonSpend_ProCenter_9_1a_Preserved proves the 9-1a add-on-spend behavior is unchanged
// for an eligible tier: a Pro center with addon_remaining=pack.credits and no monthly balance
// spends the add-on bucket (monthly-then-addon ordering), decrementing it by exactly 1.
func TestAddonSpend_ProCenter_9_1a_Preserved(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	pack := plan.AddonPackByID(addonPack100ID) // D7 catalog seam (100-credit pack, Pro-eligible)
	// Pro tier, monthly exhausted (alloc 0), addon = the pack's credits → a spend hits addon.
	centerID, tc := newBillingCenter(t, "pro", 0, 0, pack.Credits, billingEpoch.AddDate(0, 1, 0))

	if err := svc.CheckAndConsumeCredit(context.Background(), tc, uuid.New()); err != nil {
		t.Fatalf("CheckAndConsumeCredit on Pro with add-on balance must SUCCEED (9-1a monthly-then-addon): %v", err)
	}
	if got := readAddonRemaining(t, centerID); got != pack.Credits-1 {
		t.Errorf("addon_remaining = %d, want %d (exactly one credit spent from the add-on bucket)", got, pack.Credits-1)
	}
}

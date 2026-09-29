// Story 9.1a, AC5/AC29 — the locked tier model. Pins the exact numbers from
// epic-09:22-30 + blocker-resolutions A8 and the round-half-up VAT split (D25). If a
// value here changes, the price/limit contract 9-1b + 9.2 + the landing pricing page
// all build on has drifted — this test is the tripwire.
package plan_test

import (
	"testing"

	"github.com/ducdo/classlite-api/internal/plan"
)

func TestLimits_LockedValues(t *testing.T) {
	cases := []struct {
		tier plan.Tier
		want plan.Limits
	}{
		{plan.Free, plan.Limits{TeachersMax: 1, ClassesMax: 1, StudentsPerClassMax: 5, AICreditsPerMonth: 0, StorageBytes: 524288000}},
		{plan.Pro, plan.Limits{TeachersMax: 10, ClassesMax: plan.Unlimited, StudentsPerClassMax: 20, AICreditsPerMonth: 500, StorageBytes: 5368709120}},
		{plan.Studio, plan.Limits{TeachersMax: plan.Unlimited, ClassesMax: plan.Unlimited, StudentsPerClassMax: 60, AICreditsPerMonth: 2000, StorageBytes: 53687091200}},
	}
	for _, c := range cases {
		if got := plan.LimitsFor(c.tier); got != c.want {
			t.Errorf("LimitsFor(%s) = %+v, want %+v", c.tier, got, c.want)
		}
	}
}

func TestPrices_LockedValues(t *testing.T) {
	cases := []struct {
		tier            plan.Tier
		monthly, annual int
	}{
		{plan.Free, 0, 0},
		{plan.Pro, 399000, 3990000},
		{plan.Studio, 999000, 9990000},
	}
	for _, c := range cases {
		p := plan.PricesFor(c.tier)
		if p.MonthlyVnd != c.monthly || p.AnnualVnd != c.annual {
			t.Errorf("PricesFor(%s) = %+v, want monthly=%d annual=%d", c.tier, p, c.monthly, c.annual)
		}
	}
}

func TestVAT_RoundHalfUp_InclusiveSplitReSums(t *testing.T) {
	// The exact locked breakdowns (D25): Pro monthly 362727 + 36273 = 399000.
	cases := []struct {
		tier                   plan.Tier
		mSub, mVat, aSub, aVat int
	}{
		{plan.Free, 0, 0, 0, 0},
		{plan.Pro, 362727, 36273, 3627273, 362727},
		{plan.Studio, 908182, 90818, 9081818, 908182},
	}
	for _, c := range cases {
		v := plan.VATFor(c.tier)
		if v.MonthlySubtotal != c.mSub || v.MonthlyVat != c.mVat || v.AnnualSubtotal != c.aSub || v.AnnualVat != c.aVat {
			t.Errorf("VATFor(%s) = %+v, want {%d %d %d %d}", c.tier, v, c.mSub, c.mVat, c.aSub, c.aVat)
		}
		// The split must re-sum to the price exactly — no rounding drift (D25).
		p := plan.PricesFor(c.tier)
		if v.MonthlySubtotal+v.MonthlyVat != p.MonthlyVnd {
			t.Errorf("%s monthly subtotal+vat = %d, want price %d", c.tier, v.MonthlySubtotal+v.MonthlyVat, p.MonthlyVnd)
		}
		if v.AnnualSubtotal+v.AnnualVat != p.AnnualVnd {
			t.Errorf("%s annual subtotal+vat = %d, want price %d", c.tier, v.AnnualSubtotal+v.AnnualVat, p.AnnualVnd)
		}
	}
}

func TestAllTiers_DisplayOrder(t *testing.T) {
	got := plan.AllTiers()
	want := []plan.Tier{plan.Free, plan.Pro, plan.Studio}
	if len(got) != len(want) {
		t.Fatalf("AllTiers len = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("AllTiers[%d] = %s, want %s", i, got[i], want[i])
		}
	}
}

func TestIsValid(t *testing.T) {
	for _, tr := range []plan.Tier{plan.Free, plan.Pro, plan.Studio} {
		if !plan.IsValid(tr) {
			t.Errorf("IsValid(%s) = false, want true", tr)
		}
	}
	if plan.IsValid("enterprise") {
		t.Error("IsValid(enterprise) = true, want false")
	}
}

// LimitsFor of an unknown tier must fail CLOSED to Free (most restrictive), never open.
func TestLimitsFor_UnknownTierFailsClosedToFree(t *testing.T) {
	if got := plan.LimitsFor("enterprise"); got != plan.LimitsFor(plan.Free) {
		t.Errorf("LimitsFor(unknown) = %+v, want Free limits %+v", got, plan.LimitsFor(plan.Free))
	}
}

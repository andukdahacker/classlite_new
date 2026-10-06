// Story 9-3 — R3 (Ducdo 2026-10-06): the day-7 downgrade makes the pause REAL, not advisory.
// FU-9-3-READONLY is PULLED INTO 9.3. A downgraded (Free) center's existing over-cap resources
// become read-only on MUTATION: the teacher seats beyond the Free cap lock, and a class over the
// Free 5-student cap rejects content mutations — while under-cap resources stay editable. This
// is a NEW always-on enforcement path keyed off plan='free' + over-cap, INDEPENDENT of
// BILLING_ENFORCEMENT_ENABLED (which gates only the 9-1a *add* gates; the grace read-only must
// be live in prod even while that add-flag is dark, or FR-65's advertised pause never happens).
// Zero deletion still holds (R24) — read-only ≠ delete.
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).CheckClassMutable(ctx, tc, classID uuid.UUID) error —
//       PlanLimitExceededError when plan='free' AND the class exceeds the Free students-per-class
//       cap; nil otherwise. Own-tx wrapper the class/enrollment mutation handlers call.
//   · (svc *service.BillingService).CheckTeacherSeatMutable(ctx, tc) error —
//       PlanLimitExceededError when plan='free' AND the center's teacher seats exceed the Free
//       cap (seat management locked until trim/re-upgrade); nil when at/under cap.
//
// Mock seams: real DB in tx (TEST-BE-1/2, RLS never disabled), own-tenant tx (PERF-1).
//
// RED: compile-fails on svc.CheckClassMutable / svc.CheckTeacherSeatMutable.

package test

import (
	"context"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

// TestDowngradeReadOnly_OverCapClassRejectsMutation_C8b — on a Free center, a grandfathered
// class over the 5-student cap is read-only; an under-cap class stays editable.
func TestDowngradeReadOnly_OverCapClassRejectsMutation_C8b(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	// A downgraded Free center with two grandfathered classes: one over cap, one under.
	_, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	overCap, _ := seedFreeClass(t, pool, tc, 6, 0) // 6 active enrollments > Free cap (5)
	underCap, _ := seedFreeClass(t, pool, tc, 3, 0) // 3 <= 5

	var ple service.PlanLimitExceededError
	if err := svc.CheckClassMutable(ctx, tc, overCap); !errors.As(err, &ple) {
		t.Errorf("mutating an over-cap class on Free: want PlanLimitExceededError (read-only), got %v", err)
	}
	if err := svc.CheckClassMutable(ctx, tc, underCap); err != nil {
		t.Errorf("mutating an under-cap class on Free: want nil (still editable), got %v", err)
	}
}

// TestDowngradeReadOnly_OverCapSeatLocks_C8a — on a Free center over the teacher-seat cap, seat
// management is locked; a Free center at/under the cap stays editable.
func TestDowngradeReadOnly_OverCapSeatLocks_C8a(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	// Over-cap Free center: two grandfathered teacher seats (Free cap is one).
	centerOver, tcOver := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	seedTeacherSeat(t, centerOver)
	seedTeacherSeat(t, centerOver)

	var ple service.PlanLimitExceededError
	if err := svc.CheckTeacherSeatMutable(ctx, tcOver); !errors.As(err, &ple) {
		t.Errorf("seat mutation on an over-cap Free center: want PlanLimitExceededError (locked), got %v", err)
	}

	// Control: a Free center at/under the seat cap stays editable.
	centerOk, tcOk := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	seedTeacherSeat(t, centerOk)
	if err := svc.CheckTeacherSeatMutable(ctx, tcOk); err != nil {
		t.Errorf("seat mutation on an at-cap Free center: want nil (editable), got %v", err)
	}
}

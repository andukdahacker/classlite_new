// Story 9-1a, AC10 (R22 seat/enrolment race) + AC22 (grandfather) — the plan
// hard-block enforced at WRITE TIME inside the real enrollment path.
//
//	AC10 — two concurrent CreateEnrollment calls that would take a class from
//	cap-1(4) → cap(5) → cap+1(6) on Free (studentsPerClass=5) must yield EXACTLY
//	ONE success + ONE PLAN_LIMIT_EXCEEDED. The live-COUNT-then-insert is a race
//	unless serialized by the per-center (center, enrollment=3) advisory lock.
//
//	AC22 — grandfather: a class ALREADY over cap (8 on Free/5, e.g. after a future
//	downgrade) keeps all 8 usable; only a net-new +1 is blocked (block iff
//	currentCount >= planMax). Existing rows are never touched (D11/D20).
//
// Enforcement is DARK-LAUNCHED (D19, BILLING_ENFORCEMENT_ENABLED default OFF), so
// these arm it explicitly via t.Setenv.
//
// MUST use SetupRawPool (two real committed txns). GREEN SEAMS (dev, per repo
// per-story-helper convention — cf. test.NewStaffTestServerForRole):
//
//	test.newEnrollmentServiceForRace(t, pool) *service.EnrollmentService  // real service, billing gate wired
//	test.seedFreeClass(t, pool, tc, activeSeats, spareStudents int) (classID uuid.UUID, spares []uuid.UUID)
//
// NO-LOCK CONTROL (Murat): after green, drop the advisory lock and re-run
// TestPlanLimit_ConcurrentEnroll_* — it MUST then admit 2 successes (6 students).
//
// RED: compile-fails on service.PlanLimitExceededError + the greenfield helpers.
package test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/service"
)

const seatRaceTimeout = 30 * time.Second

func TestPlanLimit_ConcurrentEnroll_ExactlyOneWinsAtCap(t *testing.T) {
	t.Setenv("BILLING_ENFORCEMENT_ENABLED", "true") // arm the dark-launched gate (D19)
	pool := SetupRawPool(t)
	ctx := context.Background()

	_, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0)) // Free → studentsPerClass=5
	classID, spares := seedFreeClass(t, pool, tc, 4 /*activeSeats*/, 2 /*spareStudents*/)
	enrollSvc := newEnrollmentServiceForRace(t, pool)

	var (
		wg   sync.WaitGroup
		errs [2]error
	)
	enroll := func(idx int) {
		defer wg.Done()
		_, errs[idx] = enrollSvc.CreateEnrollment(ctx, tc, spares[idx], classID)
	}
	wg.Add(2)
	go enroll(0)
	go enroll(1)

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(seatRaceTimeout):
		t.Fatalf("seat race hung within %s", seatRaceTimeout)
	}

	var successes, blocked int
	for _, e := range errs {
		switch {
		case e == nil:
			successes++
		case errors.As(e, &service.PlanLimitExceededError{}):
			blocked++
		default:
			t.Fatalf("unexpected CreateEnrollment error: %v", e)
		}
	}
	if successes != 1 || blocked != 1 {
		t.Fatalf("at cap-1(4)→cap(5): want exactly 1 success + 1 PLAN_LIMIT_EXCEEDED, got %d/%d", successes, blocked)
	}

	var active int
	_ = SuperuserPool(t).QueryRow(ctx,
		`SELECT count(*) FROM enrollments WHERE class_id = $1 AND status = 'active'`, classID,
	).Scan(&active)
	if active != 5 {
		t.Errorf("live enrollment count = %d after the race, want exactly 5 (the Free cap), never 6", active)
	}
}

func TestPlanLimit_GrandfatherOverCap_BlocksNetNewOnly(t *testing.T) {
	t.Setenv("BILLING_ENFORCEMENT_ENABLED", "true")
	pool := SetupRawPool(t)
	ctx := context.Background()

	_, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0)) // Free/5
	classID, spares := seedFreeClass(t, pool, tc, 8 /*already over cap*/, 1 /*one more to try*/)
	enrollSvc := newEnrollmentServiceForRace(t, pool)

	// All 8 existing enrollments stay usable (D11 — existing access never degraded).
	var active int
	_ = SuperuserPool(t).QueryRow(ctx,
		`SELECT count(*) FROM enrollments WHERE class_id = $1 AND status = 'active'`, classID,
	).Scan(&active)
	if active != 8 {
		t.Fatalf("grandfathered class should keep all 8 existing enrollments, has %d", active)
	}

	// A net-new +1 is blocked (currentCount 8 >= planMax 5).
	_, err := enrollSvc.CreateEnrollment(ctx, tc, spares[0], classID)
	var limitErr service.PlanLimitExceededError
	if !errors.As(err, &limitErr) {
		t.Fatalf("net-new enrolment on an over-cap class: want PLAN_LIMIT_EXCEEDED, got %v", err)
	}
	if limitErr.Limit != "studentsPerClass" {
		t.Errorf("error.Limit = %q, want studentsPerClass", limitErr.Limit)
	}
}

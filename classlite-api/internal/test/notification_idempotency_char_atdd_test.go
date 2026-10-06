// Story 10-1a · Task 0.6 — idempotency CHARACTERIZATION (NOT a red; it pins the
// ACCEPTED v1 behavior so the known gap ships with coverage, the R11 lesson).
//
// The synchronous bus has no idempotency key in v1: re-delivering the SAME
// domain event inserts a SECOND notification row. This test asserts 2 — it
// FLIPS to assert 1 when FU-10-1-DURABLE adds a (event_id, user_id) idempotency
// key. Do not "fix" this test to 1 without that follow-up.
//
// Tagged `atdd_red_phase` (quarantined until green) but it is a pin, not a gate.
// Compile-FAILS on service.NewNotificationService / .Register (n101Wire).
package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/service"
)

func TestNotification_DoublePublish_PinsTwoRows_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	clk := clock.NewMockClock(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	submissionID := SeedWritingSubmissionForTenant(t, db, qaUUIDFromPg(center.ID))
	student, assignment := n101SubmissionActors(t, db, submissionID)

	bus, _ := n101Wire(t, db, clk, &service.MockEmailSender{})

	payload := n101GradeReleasedPayload(submissionID.String(), UUIDString(assignment))
	bus.Publish(ctx, n101Event(event.GradeReleased, UUIDString(center.ID), "", payload))
	bus.Publish(ctx, n101Event(event.GradeReleased, UUIDString(center.ID), "", payload))

	// Read within the same tenant-scoped tx (SeedWritingSubmission set the context).
	if got := n101CountByType(t, db, center.ID, student, n101TypeGradeReleased); got != 2 {
		t.Errorf("ACCEPTED-V1 DUP: double-publish grade.released must yield 2 rows (flips to 1 under FU-10-1-DURABLE), got %d", got)
	}
}

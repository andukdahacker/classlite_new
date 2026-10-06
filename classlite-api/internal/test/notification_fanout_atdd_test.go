// Story 10-1a · Task 0.8 / AC10 — fan-out cardinality: assignment.created and
// schedule.changed fan out to each ACTIVE enrolled student only (withdrawn
// excluded), one row each, no dupes; an empty class produces zero rows + no error.
//
// Guards the `INSERT … SELECT` server-side join against a wrong-audience bug (a
// row for a withdrawn/transferred 7.3a student) and against mis-join/double-count.
//
// RED (`//go:build atdd_red_phase`): compile-FAILS on
//
//	service.NewNotificationService / .Register (n101Wire).
package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

func TestNotification_Fanout_ActiveOnly_NoDupes_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	clk := clock.NewMockClock(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := qaUUIDFromPg(center.ID)

	// 3 active + 1 withdrawn enrollment in one class.
	fan := n101FanoutClass(t, db, centerUUID, 3, 1)
	assignment := n101SeedAssignment(t, db, centerUUID, fan.exerciseID, fan.classID, fan.teacherID)

	bus, _ := n101Wire(t, db, clk, &service.MockEmailSender{})

	// --- assignment.created → exactly 3 (one per active student) ---
	bus.Publish(ctx, n101Event(event.AssignmentCreated, UUIDString(center.ID), "", n101AssignmentCreatedPayload(assignment.String())))
	if got := n101CountForCenter(t, db, center.ID, n101TypeAssignmentCreated); got != 3 {
		t.Errorf("assignment.created fan-out must be exactly 3 (active only, no dupes), got %d", got)
	}
	for _, s := range fan.active {
		if got := n101CountByType(t, db, center.ID, qaPgUUID(s), n101TypeAssignmentCreated); got != 1 {
			t.Errorf("active student %s must have exactly 1 assignment_created row, got %d", s, got)
		}
	}

	// --- schedule.changed → exactly 3 (active only) ---
	bus.Publish(ctx, n101Event(event.ScheduleChanged, UUIDString(center.ID), "", n101ScheduleChangedPayload(uuid.NewString(), fan.classID.String())))
	if got := n101CountForCenter(t, db, center.ID, n101TypeScheduleChanged); got != 3 {
		t.Errorf("schedule.changed fan-out must be exactly 3 (active only), got %d", got)
	}
}

func TestNotification_Fanout_EmptyClass_ZeroRows_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	clk := clock.NewMockClock(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := qaUUIDFromPg(center.ID)

	fan := n101FanoutClass(t, db, centerUUID, 0, 0) // no enrollments
	assignment := n101SeedAssignment(t, db, centerUUID, fan.exerciseID, fan.classID, fan.teacherID)

	bus, _ := n101Wire(t, db, clk, &service.MockEmailSender{})
	bus.Publish(ctx, n101Event(event.AssignmentCreated, UUIDString(center.ID), "", n101AssignmentCreatedPayload(assignment.String())))

	if got := n101CountForCenter(t, db, center.ID, n101TypeAssignmentCreated); got != 0 {
		t.Errorf("empty class must produce 0 fan-out rows (no mis-join), got %d", got)
	}
}

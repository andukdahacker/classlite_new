// Story 10-1a · Task 0.7 / AC6 / DD2 — best-effort swallow: a failing subscriber
// (and a failing recipient resolution) must NOT propagate to or roll back the
// producer, and the notification is silently dropped (no row).
//
// The bus swallows handler ERRORS (bus.go:62-68) — this pins that. (Panic
// recovery is a separate concern the synchronous bus does NOT provide today, so
// this red uses error-returning handlers, matching DD2's "errors are logged and
// SWALLOWED".)
//
// RED (`//go:build atdd_red_phase`): compile-FAILS on
//
//	service.NewNotificationService / .Register (n101Wire).
package test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/service"
)

func TestNotification_HandlerError_SwallowedProducerUnaffected_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	clk := clock.NewMockClock(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))

	// A center with NO owner → the payment.failed subscriber's GetCenterOwnerUserID
	// resolution fails → it returns an error the bus must swallow.
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	student := qaSeedMember(t, db, qaUUIDFromPg(center.ID), "n101-swallow@example.com", "Sentinel User", "student")

	// Sentinel: a prior committed "producer action" that must survive the publish.
	sentinel := n101InsertNotif(t, db, center.ID, qaPgUUID(student), n101TypeAssignmentCreated, false, false)

	bus, _ := n101Wire(t, db, clk, &service.MockEmailSender{})
	// A second, independently failing handler on the same event type.
	bus.Subscribe(event.PaymentFailed, func(context.Context, event.Event) error {
		return fmt.Errorf("intentional handler failure")
	})

	// Publish must not panic or propagate.
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("DD2 VIOLATION: Publish propagated a panic to the producer: %v", r)
			}
		}()
		bus.Publish(ctx, n101Event(event.PaymentFailed, UUIDString(center.ID), "", nil))
	}()

	// The notification was silently dropped (no owner row anywhere in the center).
	if got := n101CountForCenter(t, db, center.ID, n101TypePaymentFailed); got != 0 {
		t.Errorf("failed subscriber must create ZERO rows, got %d", got)
	}

	// The producer's own prior action is intact (tx not poisoned / rolled back).
	var exists int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE id = $1`, sentinel).Scan(&exists); err != nil {
		t.Fatalf("producer tx poisoned — sentinel re-read failed: %v", err)
	}
	if exists != 1 {
		t.Errorf("producer action unaffected: sentinel row must survive, got count %d", exists)
	}
}

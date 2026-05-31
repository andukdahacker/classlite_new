package event_test

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/ducdo/classlite-api/internal/event"
)

func TestPublish_DispatchesToSubscriber(t *testing.T) {
	bus := event.NewBus()
	var called bool

	bus.Subscribe(event.GradeReleased, func(ctx context.Context, e event.Event) error {
		called = true
		if e.Type != event.GradeReleased {
			t.Errorf("expected type %s, got %s", event.GradeReleased, e.Type)
		}
		if e.CenterID != "center-1" {
			t.Errorf("expected center-1, got %s", e.CenterID)
		}
		if e.UserID != "user-1" {
			t.Errorf("expected user-1, got %s", e.UserID)
		}
		return nil
	})

	bus.Publish(context.Background(), event.Event{
		Type:     event.GradeReleased,
		CenterID: "center-1",
		UserID:   "user-1",
		Payload:  map[string]string{"submission_id": "sub-1"},
	})

	if !called {
		t.Error("handler was not called")
	}
}

func TestPublish_MultipleHandlers(t *testing.T) {
	bus := event.NewBus()
	var count int32

	for i := 0; i < 3; i++ {
		bus.Subscribe(event.AssignmentCreated, func(ctx context.Context, e event.Event) error {
			atomic.AddInt32(&count, 1)
			return nil
		})
	}

	bus.Publish(context.Background(), event.Event{
		Type:     event.AssignmentCreated,
		CenterID: "center-1",
		UserID:   "user-1",
	})

	if atomic.LoadInt32(&count) != 3 {
		t.Errorf("expected 3 handlers called, got %d", count)
	}
}

func TestPublish_UnregisteredEventType(t *testing.T) {
	bus := event.NewBus()

	// Should not panic or error — just a no-op.
	bus.Publish(context.Background(), event.Event{
		Type:     "unknown.event",
		CenterID: "center-1",
		UserID:   "user-1",
	})
}

func TestPublish_HandlerErrorDoesNotStopOthers(t *testing.T) {
	bus := event.NewBus()
	var secondCalled bool

	bus.Subscribe(event.EnrollmentChanged, func(ctx context.Context, e event.Event) error {
		return fmt.Errorf("handler 1 failed")
	})

	bus.Subscribe(event.EnrollmentChanged, func(ctx context.Context, e event.Event) error {
		secondCalled = true
		return nil
	})

	bus.Publish(context.Background(), event.Event{
		Type:     event.EnrollmentChanged,
		CenterID: "center-1",
		UserID:   "user-1",
	})

	if !secondCalled {
		t.Error("second handler should still be called after first handler error")
	}
}

func TestPublish_SetsTimestampIfZero(t *testing.T) {
	bus := event.NewBus()

	bus.Subscribe(event.GradeReleased, func(ctx context.Context, e event.Event) error {
		if e.Timestamp.IsZero() {
			t.Error("expected non-zero timestamp")
		}
		return nil
	})

	bus.Publish(context.Background(), event.Event{
		Type:     event.GradeReleased,
		CenterID: "center-1",
		UserID:   "user-1",
		// Timestamp intentionally left zero.
	})
}

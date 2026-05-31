package event

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// Event represents a domain event published through the bus.
type Event struct {
	Type      string
	CenterID  string
	UserID    string
	Payload   any
	Timestamp time.Time
}

// Handler processes a domain event. Errors are logged but do not stop other handlers.
type Handler func(ctx context.Context, event Event) error

// Bus is an in-process synchronous event bus. Goroutine-safe via sync.RWMutex.
type Bus struct {
	mu       sync.RWMutex
	handlers map[string][]Handler
}

// NewBus creates a new event bus.
func NewBus() *Bus {
	return &Bus{
		handlers: make(map[string][]Handler),
	}
}

// Subscribe registers a handler for an event type.
func (b *Bus) Subscribe(eventType string, handler Handler) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.handlers[eventType] = append(b.handlers[eventType], handler)
}

// Publish dispatches an event to all registered handlers synchronously.
// Handler errors are logged but do not stop other handlers or propagate to the caller.
// Payload is never logged to avoid PII leakage (EDGE-4).
func (b *Bus) Publish(ctx context.Context, event Event) {
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}

	slog.InfoContext(ctx, "event published",
		"type", event.Type,
		"center_id", event.CenterID,
		"user_id", event.UserID,
		"timestamp", event.Timestamp,
	)

	b.mu.RLock()
	handlers := b.handlers[event.Type]
	b.mu.RUnlock()

	for _, h := range handlers {
		if err := h(ctx, event); err != nil {
			slog.ErrorContext(ctx, "event handler failed",
				"type", event.Type,
				"center_id", event.CenterID,
				"user_id", event.UserID,
				"error", err,
			)
		}
	}
}

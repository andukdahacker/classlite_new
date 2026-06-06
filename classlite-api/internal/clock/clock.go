// Package clock provides a time abstraction for deterministic testing.
//
// Production code accepts a Clock dependency instead of calling time.Now()
// or time.Sleep() directly. Tests inject MockClock to control time without
// real waits. RealClock is the production implementation.
//
// Time-dependent services that should accept a Clock:
//   - AuthService: token expiry, lockout windows, verification expiry
//   - BillingService: plan grace period state machine (days 0/3/5/6/7)
//   - EnrollmentService: effective_date math, history timestamps
//   - ScheduleService: recurring session expansion, session boundaries
//   - AtRiskDetector: attendance and band-drop window calculations
//   - EmailRetryQueue: exponential backoff scheduling
//
// See WF-8 in docs/project-context.md and the test-design BLOCKER A4.
package clock

import (
	"sync"
	"time"
)

// Clock is the dependency seam used by every time-dependent service.
type Clock interface {
	// Now returns the current time as observed by this clock.
	Now() time.Time

	// Sleep blocks for the given duration. In production this delegates to
	// time.Sleep. In tests it advances the mock clock instantly and returns.
	Sleep(d time.Duration)
}

// RealClock is the production Clock backed by the wall clock.
type RealClock struct{}

// Now returns time.Now().
func (RealClock) Now() time.Time { return time.Now() }

// Sleep calls time.Sleep(d).
func (RealClock) Sleep(d time.Duration) { time.Sleep(d) }

// MockClock is a deterministic Clock for tests. Time advances only when
// Advance, Set, or Sleep is called. Safe for concurrent use.
//
// Usage:
//
//	c := clock.NewMockClock(time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC))
//	svc := billing.NewService(db, c)
//	svc.HandlePaymentFailure(ctx, subscriptionID)
//	c.Advance(72 * time.Hour) // jump to day 3
//	svc.RunGraceRetries(ctx)
//	c.Advance(24 * time.Hour) // day 4 — nothing should fire
//	c.Advance(24 * time.Hour) // day 5 — second retry
type MockClock struct {
	mu      sync.Mutex
	now     time.Time
	sleeps  []time.Duration
	advance chan time.Duration
}

// NewMockClock creates a MockClock anchored at start. Callers can pick any
// time; for grace-period tests a fixed UTC anchor like
// time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC) keeps assertions readable.
func NewMockClock(start time.Time) *MockClock {
	return &MockClock{now: start}
}

// Now returns the current mock time.
func (c *MockClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

// Sleep records the requested duration and advances the mock clock by it
// without any real wait. This lets services written against the Clock
// interface run in tests at full speed.
func (c *MockClock) Sleep(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sleeps = append(c.sleeps, d)
	c.now = c.now.Add(d)
}

// Advance jumps the mock clock forward by d. Use this in tests to simulate
// the passage of time between service calls (e.g., between grace-period days).
func (c *MockClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// Set moves the mock clock to an absolute time. Use this when a test needs
// to assert behavior at a specific calendar moment (e.g., day 7 at 23:59).
func (c *MockClock) Set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = t
}

// Sleeps returns a copy of every duration passed to Sleep since the clock
// was created. Useful for asserting backoff schedules.
func (c *MockClock) Sleeps() []time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]time.Duration, len(c.sleeps))
	copy(out, c.sleeps)
	return out
}

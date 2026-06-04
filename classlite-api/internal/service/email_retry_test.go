package service

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeClock is a manual clock for deterministic backoff tests.
type fakeClock struct {
	mu          sync.Mutex
	now         time.Time
	sleepCalls  []time.Duration
	sleepSignal chan struct{}
}

func newFakeClock() *fakeClock {
	return &fakeClock{
		now:         time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC),
		sleepSignal: make(chan struct{}, 64),
	}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Sleep(d time.Duration) {
	c.mu.Lock()
	c.sleepCalls = append(c.sleepCalls, d)
	c.now = c.now.Add(d)
	c.mu.Unlock()
	select {
	case c.sleepSignal <- struct{}{}:
	default:
	}
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// scriptedSender returns the queued error for each Send call. nil = success.
type scriptedSender struct {
	mu        sync.Mutex
	responses []error
	calls     int32
	onCall    func()
}

func (s *scriptedSender) Send(_ context.Context, _ string, _ string, _ string) error {
	atomic.AddInt32(&s.calls, 1)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.onCall != nil {
		s.onCall()
	}
	if len(s.responses) == 0 {
		return nil
	}
	resp := s.responses[0]
	s.responses = s.responses[1:]
	return resp
}

func (s *scriptedSender) CallCount() int32 {
	return atomic.LoadInt32(&s.calls)
}

// safeBuffer is a bytes.Buffer with locking, so a worker goroutine writing
// log lines does not race the test goroutine that calls String() to assert
// log content.
type safeBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *safeBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *safeBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// captureLogger redirects slog output into a buffer for assertions. The
// returned buffer is safe for concurrent Write (by the worker goroutine) and
// String (by the test goroutine).
func captureLogger() (*slog.Logger, *safeBuffer) {
	buf := &safeBuffer{}
	return slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})), buf
}

func waitForCalls(t *testing.T, s *scriptedSender, want int32, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if s.CallCount() >= want {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("expected %d sender calls, got %d after %s", want, s.CallCount(), timeout)
}

func TestRetryQueue_SuccessFirstAttempt(t *testing.T) {
	sender := &scriptedSender{}
	logger, _ := captureLogger()
	q := newQueue(sender, 8, newFakeClock(), logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go q.Start(ctx)

	if !q.Enqueue(EmailJob{To: "a@x.com", Subject: "s", HTML: "<p>h</p>"}) {
		t.Fatal("expected enqueue to succeed on empty buffer")
	}

	waitForCalls(t, sender, 1, 500*time.Millisecond)
	if sender.CallCount() != 1 {
		t.Errorf("expected 1 call, got %d", sender.CallCount())
	}
}

func TestRetryQueue_SuccessAfterTwoFailures(t *testing.T) {
	sender := &scriptedSender{responses: []error{errors.New("boom1"), errors.New("boom2"), nil}}
	logger, logBuf := captureLogger()
	clock := newFakeClock()
	q := newQueue(sender, 8, clock, logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go q.Start(ctx)

	q.Enqueue(EmailJob{To: "retry@x.com", Subject: "s", HTML: "<p>h</p>"})

	waitForCalls(t, sender, 3, 1*time.Second)
	if sender.CallCount() != 3 {
		t.Errorf("expected 3 calls, got %d", sender.CallCount())
	}

	// Two retry-scheduled log entries expected (after attempts 1 and 2).
	logs := logBuf.String()
	if strings.Count(logs, "verification_email_retry_scheduled") != 2 {
		t.Errorf("expected 2 retry-scheduled logs, got %d in:\n%s", strings.Count(logs, "verification_email_retry_scheduled"), logs)
	}
	if !strings.Contains(logs, "verification_email_sent") {
		t.Errorf("expected final success log, got:\n%s", logs)
	}

	// Fake clock recorded two sleeps matching the first two backoffs.
	clock.mu.Lock()
	defer clock.mu.Unlock()
	if len(clock.sleepCalls) < 2 {
		t.Fatalf("expected ≥2 sleep calls, got %d", len(clock.sleepCalls))
	}
	if clock.sleepCalls[0] != EmailBackoffs[1] {
		t.Errorf("first sleep = %v, want %v", clock.sleepCalls[0], EmailBackoffs[1])
	}
	if clock.sleepCalls[1] != EmailBackoffs[2] {
		t.Errorf("second sleep = %v, want %v", clock.sleepCalls[1], EmailBackoffs[2])
	}
}

func TestRetryQueue_DropAtMaxAttempts(t *testing.T) {
	failures := make([]error, MaxEmailAttempts)
	for i := range failures {
		failures[i] = errors.New("perma-fail")
	}
	sender := &scriptedSender{responses: failures}
	logger, logBuf := captureLogger()
	q := newQueue(sender, 8, newFakeClock(), logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go q.Start(ctx)

	q.Enqueue(EmailJob{To: "drop@x.com", Subject: "s", HTML: "<p>h</p>"})

	waitForCalls(t, sender, int32(MaxEmailAttempts), 2*time.Second)
	// Allow worker to log the drop.
	time.Sleep(20 * time.Millisecond)

	if sender.CallCount() != int32(MaxEmailAttempts) {
		t.Errorf("expected %d total calls, got %d", MaxEmailAttempts, sender.CallCount())
	}
	if !strings.Contains(logBuf.String(), "verification_email_dropped_max_attempts") {
		t.Errorf("expected drop log, got:\n%s", logBuf.String())
	}
}

func TestRetryQueue_PanicInSenderRecovered(t *testing.T) {
	calls := 0
	sender := &scriptedSender{
		responses: []error{nil, nil}, // both successful in principle, but...
		onCall: func() {
			calls++
			if calls == 1 {
				panic("boom")
			}
		},
	}
	logger, logBuf := captureLogger()
	q := newQueue(sender, 8, newFakeClock(), logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go q.Start(ctx)

	q.Enqueue(EmailJob{To: "panic@x.com", Subject: "s", HTML: "<p>h</p>"})

	waitForCalls(t, sender, 2, 500*time.Millisecond)
	if !strings.Contains(logBuf.String(), "email_retry_sender_panic") {
		t.Errorf("expected panic log, got:\n%s", logBuf.String())
	}
}

func TestRetryQueue_NonBlockingEnqueueWhenFull(t *testing.T) {
	// Capacity-1 queue, no worker — the buffer never drains.
	sender := &scriptedSender{}
	logger, logBuf := captureLogger()
	q := newQueue(sender, 1, newFakeClock(), logger)

	if !q.Enqueue(EmailJob{To: "first@x.com"}) {
		t.Fatal("first enqueue should succeed")
	}

	// Second enqueue must NOT block — wrap in a goroutine + timeout to verify.
	done := make(chan bool, 1)
	go func() {
		ok := q.Enqueue(EmailJob{To: "second@x.com"})
		done <- ok
	}()

	select {
	case ok := <-done:
		if ok {
			t.Fatal("second enqueue should have returned false (full)")
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("second Enqueue blocked — must be non-blocking")
	}

	if !strings.Contains(logBuf.String(), "email_retry_queue_full") {
		t.Errorf("expected queue-full log, got:\n%s", logBuf.String())
	}
}

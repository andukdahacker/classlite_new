// Package service — in-process best-effort email retry queue (story 1.4 task 9).
//
// Scope: this is intentionally an in-process queue. The architecture's
// PostgreSQL-backed job queue (architecture step 13) supersedes this when it
// lands. The user-driven /api/auth/resend-verification endpoint is the explicit
// fallback for messages dropped here.
package service

import (
	"context"
	"log/slog"
	"time"
)

// EmailJob is the unit of work processed by EmailRetryQueue.
type EmailJob struct {
	To            string
	Subject       string
	HTML          string
	Attempts      int
	NextAttemptAt time.Time
}

// EmailRetryQueue is the dependency seam used by AuthService when an email
// send needs to be retried in the background.
type EmailRetryQueue interface {
	// Enqueue is non-blocking. If the queue is full, the job is dropped and the
	// returned bool is false — callers can surface "failed" to the user.
	Enqueue(job EmailJob) (accepted bool)
}

// Clock abstracts time for deterministic retry-backoff tests.
type Clock interface {
	Now() time.Time
	Sleep(d time.Duration)
}

type realClock struct{}

func (realClock) Now() time.Time        { return time.Now() }
func (realClock) Sleep(d time.Duration) { time.Sleep(d) }

// MaxEmailAttempts is the total number of attempts (initial + retries).
// Backoff schedule: 30s, 2m, 8m, 30m, then drop.
const MaxEmailAttempts = 5

// EmailBackoffs is the per-attempt delay table. Attempts 1..5 use entries 0..4.
// If the job has Attempts >= MaxEmailAttempts the job is dropped.
var EmailBackoffs = []time.Duration{
	0,
	30 * time.Second,
	2 * time.Minute,
	8 * time.Minute,
	30 * time.Minute,
}

// InProcessRetryQueue is the production EmailRetryQueue. It runs one worker
// goroutine that owns the buffered channel.
type InProcessRetryQueue struct {
	ch     chan EmailJob
	sender EmailSender
	clock  Clock
	logger *slog.Logger
}

// NewEmailRetryQueue constructs an InProcessRetryQueue with the given buffer
// size and the real wall clock.
func NewEmailRetryQueue(sender EmailSender, bufferSize int) *InProcessRetryQueue {
	return newQueue(sender, bufferSize, realClock{}, slog.Default())
}

func newQueue(sender EmailSender, bufferSize int, clock Clock, logger *slog.Logger) *InProcessRetryQueue {
	if logger == nil {
		logger = slog.Default()
	}
	return &InProcessRetryQueue{
		ch:     make(chan EmailJob, bufferSize),
		sender: sender,
		clock:  clock,
		logger: logger,
	}
}

// Enqueue pushes a job onto the buffered channel. Returns false if the buffer
// is full so the caller can surface emailDelivery="failed".
func (q *InProcessRetryQueue) Enqueue(job EmailJob) bool {
	select {
	case q.ch <- job:
		return true
	default:
		q.logger.Error("email_retry_queue_full",
			"to", job.To,
			"subject", job.Subject,
			"attempts", job.Attempts,
		)
		return false
	}
}

// Start runs the worker loop until ctx is cancelled. Intended to be invoked
// as `go queue.Start(ctx)` from main.go.
//
// Why per-delayed-job goroutines: keeping a single worker that sleeps inline
// caused head-of-line blocking — one job with a 30-minute backoff froze every
// other queued send for that full window. By spawning a short-lived goroutine
// for each future-dated job, the worker stays free to pull ready-now jobs.
// Each delayed goroutine sleeps via q.clock.Sleep so deterministic clock
// injection still works in tests.
func (q *InProcessRetryQueue) Start(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case job := <-q.ch:
			if delay := job.NextAttemptAt.Sub(q.clock.Now()); delay > 0 {
				go q.processDelayed(ctx, job, delay)
				continue
			}
			q.process(ctx, job)
		}
	}
}

// processDelayed sleeps until the job's NextAttemptAt then runs the normal
// process path. Spawned as a fire-and-forget goroutine so the main worker is
// not blocked by long backoffs.
func (q *InProcessRetryQueue) processDelayed(ctx context.Context, job EmailJob, delay time.Duration) {
	q.clock.Sleep(delay)
	if ctx.Err() != nil {
		return
	}
	q.process(ctx, job)
}

// process calls sender.Send inside panic recovery, then either logs success,
// schedules a retry, or drops the job at the attempt cap.
func (q *InProcessRetryQueue) process(ctx context.Context, job EmailJob) {
	err := q.callSenderRecovered(ctx, job)

	if err == nil {
		q.logger.Info("verification_email_sent",
			"to", job.To,
			"subject", job.Subject,
			"attempts", job.Attempts+1,
		)
		return
	}

	job.Attempts++
	if job.Attempts >= MaxEmailAttempts {
		q.logger.Error("verification_email_dropped_max_attempts",
			"to", job.To,
			"subject", job.Subject,
			"attempts", job.Attempts,
			"error", err.Error(),
		)
		return
	}

	job.NextAttemptAt = q.clock.Now().Add(EmailBackoffs[job.Attempts])
	q.logger.Warn("verification_email_retry_scheduled",
		"to", job.To,
		"attempts", job.Attempts,
		"next_attempt_at", job.NextAttemptAt,
		"error", err.Error(),
	)
	q.Enqueue(job)
}

// callSenderRecovered wraps sender.Send in panic recovery so one bad provider
// call cannot kill the worker goroutine.
func (q *InProcessRetryQueue) callSenderRecovered(ctx context.Context, job EmailJob) (err error) {
	defer func() {
		if rec := recover(); rec != nil {
			q.logger.Error("email_retry_sender_panic", "panic", rec)
			err = &recoveredPanicError{value: rec}
		}
	}()
	return q.sender.Send(ctx, job.To, job.Subject, job.HTML)
}

// recoveredPanicError wraps a recovered panic value as an error so the worker
// loop can treat it like any other Send failure.
type recoveredPanicError struct {
	value any
}

func (e *recoveredPanicError) Error() string {
	switch v := e.value.(type) {
	case string:
		return "sender panic: " + v
	case error:
		return "sender panic: " + v.Error()
	default:
		return "sender panic"
	}
}

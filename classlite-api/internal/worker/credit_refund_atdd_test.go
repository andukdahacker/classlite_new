// Story 4.3a, AC7 + AC8 (credit refund on terminal failure) — GREEN.
//
// Encodes the A6 refund matrix (blocker-resolutions-2026-06-04.md:92-102):
//   - failed after max_retries (Gemini errors) → REFUND +1
//   - failed with invalid_ai_response         → REFUND +1 (terminal, NOT retried)
//   - failed via 5-min stuck-sweep            → REFUND +1
//   - complete (success)                      → NO refund
//
// Every refund row is inserted in the SAME tx as the state transition, and is
// idempotent via the unique (ref_job_id, reason) index (double-refund no-op —
// the SQL-level proof lives in ai_credit_ledger_rls_atdd_test.go).
//
// DI SEAM (dev confirms in green phase): the dispatcher owns claim → dispatch →
// retry/reschedule/refund. These tests drive one testable unit of that loop.
// `worker.NewDispatcher(...)` + `ProcessOnce`/`SweepStuckJobs` are the intended
// seams; adjust the two helpers below if the real names differ.
package worker_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/internal/test/workers"
	"github.com/ducdo/classlite-api/internal/worker"
)

const (
	reasonDeduction = "job_deduction"
	reasonRefund    = "job_failed_refund"
)

// newDispatcherForTest wires a dispatcher over the harness's tx-scoped DB with
// the mock Gemini client and deterministic clock, and all 3 ai_generate_*
// handlers registered.
func newDispatcherForTest(t *testing.T, h *workers.WorkerHarness, mock gemini.Client) *worker.Dispatcher {
	t.Helper()
	// GREEN-PHASE (dev): confirm constructor + handler registration API.
	return worker.NewDispatcher(h.DB, mock, h.Clock,
		worker.NewGenerateSectionHandler(h.DB, mock, h.Clock),
		worker.NewGenerateQuestionsHandler(h.DB, mock, h.Clock),
		worker.NewGenerateDistractorsHandler(h.DB, mock, h.Clock),
	)
}

// ledgerSum reads the SUM(change) for a job's ledger rows via raw SQL under the
// current tenant context. Kept raw (not sqlc) so it is stable across codegen.
func ledgerSum(t *testing.T, h *workers.WorkerHarness, jobID uuid.UUID) int {
	t.Helper()
	var sum int
	err := h.DB.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(change), 0) FROM ai_credit_ledger WHERE ref_job_id = $1`, jobID,
	).Scan(&sum)
	if err != nil {
		t.Fatalf("sum ledger for job %s: %v", jobID, err)
	}
	return sum
}

func countRefunds(t *testing.T, h *workers.WorkerHarness, jobID uuid.UUID) int {
	t.Helper()
	var n int
	if err := h.DB.QueryRow(context.Background(),
		`SELECT count(*) FROM ai_credit_ledger WHERE ref_job_id = $1 AND reason = $2`,
		jobID, reasonRefund,
	).Scan(&n); err != nil {
		t.Fatalf("count refunds: %v", err)
	}
	return n
}

// enqueueDeductedJob simulates a real enqueue: a pending job + its −1
// job_deduction row in one tx (AC1), so refund math starts from −1.
func enqueueDeductedJob(t *testing.T, h *workers.WorkerHarness) uuid.UUID {
	t.Helper()
	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.TenantContext(t, h.DB, center.ID)
	exID := seedExerciseForTenant(t, h, uuid.MustParse(testpkg.TenantAID))
	// GREEN-PHASE: prefer the real service.EnqueueGeneration here once it lands,
	// so this exercises the production single-tx path rather than a hand-rolled seed.
	return testpkg.SeedDeductedAIJob(t, h.DB, testpkg.TenantAID,
		string(model.JobTypeAIGenerateSection),
		model.AIGenerateSectionParams{ExerciseID: exID.String(), Topic: "x"})
}

// ===========================================================================
// AC7 S7.1 — Refund after max_retries exhausted (transient Gemini errors)
// ===========================================================================

func TestRefund_OnMaxRetriesExhausted(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockTransientError}) // always errors
	d := newDispatcherForTest(t, h, mock)
	jobID := enqueueDeductedJob(t, h)

	// Drive 3 attempts, advancing the clock past each backoff step (30/60/120s).
	backoffs := []time.Duration{0, 30 * time.Second, 60 * time.Second, 120 * time.Second}
	for i, b := range backoffs {
		h.Clock.Advance(b)
		if err := d.ProcessOnce(context.Background()); err != nil {
			t.Logf("attempt %d processing error (expected on transient): %v", i, err)
		}
	}

	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("after 3 retries job status = %q, want failed", got)
	}
	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("expected exactly 1 job_failed_refund after max-retries, got %d", n)
	}
	if sum := ledgerSum(t, h, jobID); sum != 0 {
		t.Errorf("balance for job = %d, want 0 (−1 deduction + 1 refund)", sum)
	}
}

// ===========================================================================
// AC7 S7.2 + AC6 — invalid_ai_response is TERMINAL (not retried) AND refunded
// ===========================================================================

func TestRefund_OnInvalidAIResponse_TerminalNotRetried(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockMalformed}) // parses/validates to failure
	d := newDispatcherForTest(t, h, mock)
	jobID := enqueueDeductedJob(t, h)

	// A single processing pass must go terminal — no reschedule, no second call.
	if err := d.ProcessOnce(context.Background()); err != nil {
		t.Logf("processing error (expected terminal): %v", err)
	}

	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("job status = %q, want failed", got)
	}
	// AC6: NOT retried — Gemini called exactly once, and a second ProcessOnce
	// finds nothing re-claimable for this job.
	if mock.CallCount() != 1 {
		t.Errorf("gemini called %d times, want 1 (invalid_ai_response must not retry)", mock.CallCount())
	}
	// GREEN-PHASE: assert jobs.error_details == 'invalid_ai_response'.
	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("expected 1 refund on invalid_ai_response, got %d", n)
	}
}

// ===========================================================================
// AC7 S7.3 — 5-minute stuck-sweep marks failed + refunds
// ===========================================================================

func TestRefund_OnStuckProcessingSweep(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSection})
	d := newDispatcherForTest(t, h, mock)
	jobID := enqueueDeductedJob(t, h)

	// Wedge the job in 'processing' with a started_at older than 5 minutes.
	testpkg.ForceJobProcessingSince(t, h.DB, jobID, h.Clock.Now().Add(-6*time.Minute))

	if err := d.SweepStuckJobs(context.Background()); err != nil {
		t.Fatalf("stuck sweep error: %v", err)
	}

	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("stuck job status = %q, want failed", got)
	}
	// GREEN-PHASE: assert error_details == 'stuck_timeout' (so it stops being re-swept).
	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("expected 1 refund from stuck-sweep, got %d", n)
	}
}

// ===========================================================================
// AC7 S7.5 — NO refund on complete (negative)
// ===========================================================================

func TestNoRefund_OnComplete(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSection})
	d := newDispatcherForTest(t, h, mock)
	jobID := enqueueDeductedJob(t, h)

	if err := d.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("happy path ProcessOnce error: %v", err)
	}

	if got := h.JobStatus(t, jobID); got != workers.StatusComplete {
		t.Fatalf("job status = %q, want complete", got)
	}
	if n := countRefunds(t, h, jobID); n != 0 {
		t.Fatalf("REFUND ON SUCCESS: expected 0 refunds on complete, got %d", n)
	}
	if sum := ledgerSum(t, h, jobID); sum != -1 {
		t.Errorf("balance for completed job = %d, want -1 (deduction stands, no refund)", sum)
	}
}

// ===========================================================================
// AC7 S7.4 — Worker/sweep race: two refund attempts collapse to one (idempotent)
// The pure SQL-layer proof is in ai_credit_ledger_rls_atdd_test.go; this asserts
// the behavior end-to-end through both terminal paths hitting the same job.
// ===========================================================================

func TestRefund_DoubleAttemptIsNoOp(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockTransientError})
	d := newDispatcherForTest(t, h, mock)
	jobID := enqueueDeductedJob(t, h)

	// Terminal via max-retries, then also run the sweep over the same row.
	for _, b := range []time.Duration{0, 30 * time.Second, 60 * time.Second, 120 * time.Second} {
		h.Clock.Advance(b)
		_ = d.ProcessOnce(context.Background())
	}
	_ = d.SweepStuckJobs(context.Background()) // must not double-refund

	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("DOUBLE REFUND: expected exactly 1 refund after worker+sweep race, got %d", n)
	}
	if sum := ledgerSum(t, h, jobID); sum != 0 {
		t.Errorf("balance = %d, want 0", sum)
	}
}

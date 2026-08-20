// Story 6.2a, AC7 + AC8 + AC12 (refund idempotency + failure taxonomy) — RED PHASE.
//
// Reuses the package-level refund helpers from credit_refund_atdd_test.go
// (ledgerSum, countRefunds, reasonRefund) — do NOT redefine them here. Adds
// grade-writing-specific dispatcher + enqueue helpers.
//
// WHY THESE EXIST
//   R23 (score 6): a credit is deducted at enqueue; a terminal failure must
//   refund it EXACTLY ONCE. The dangerous false-green is "refunds on every retry
//   but the (ref_job_id, reason) unique index hides the duplicates" — a
//   final-balance-only test passes while the code is wrong. The intra-retry
//   ledger poll (S5) catches it: after attempt 1 the ledger must hold exactly the
//   −1 deduct and NO refund yet.
//
//   D8 (type-based classification): retry-vs-terminal is decided by errors.Is on
//   the sentinels, NEVER strings.Contains on the message. A transient error whose
//   text contains "invalid" (e.g. "connection invalid, retrying") must RESCHEDULE,
//   not go terminal — the adversarial row proves it.
//
// SEAMS (dev, green phase):
//   - worker.NewGradeWritingHandler(h.DB, gemini.Client, clock.Clock)
//   - model.JobTypeAIGradeWriting / model.AIGradeWritingParams{SubmissionID}
//   - gemini.MockInvalidBandScores (band 9.5 → terminal invalid_band_scores)
//   - gemini.MockTransientErrorContainingInvalid (transient error whose message
//       contains the substring "invalid" — proves errors.Is, not strings.Contains)
//   - testpkg.SeedWritingSubmissionForTenant(t, db, centerID) uuid.UUID
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

// newGradeDispatcher wires a dispatcher over the harness DB with ONLY the
// grade-writing handler registered.
func newGradeDispatcher(t *testing.T, h *workers.WorkerHarness, mock gemini.Client) *worker.Dispatcher {
	t.Helper()
	return worker.NewDispatcher(h.DB, mock, h.Clock,
		worker.NewGradeWritingHandler(h.DB, mock, h.Clock),
	)
}

// enqueueDeductedGradeJob seeds center A + a writing submission under A, then a
// pending ai_grade_writing job + its −1 job_deduction row (one tx), so refund
// math starts from −1 — the production enqueue shape (AC1).
func enqueueDeductedGradeJob(t *testing.T, h *workers.WorkerHarness) uuid.UUID {
	t.Helper()
	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.TenantContext(t, h.DB, center.ID)
	subID := testpkg.SeedWritingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))
	return testpkg.SeedDeductedAIJob(t, h.DB, testpkg.TenantAID,
		string(model.JobTypeAIGradeWriting),
		model.AIGradeWritingParams{SubmissionID: subID.String()})
}

// ===========================================================================
// S6a — invalid_band_scores is TERMINAL (not retried) AND refunded
// ===========================================================================

func TestGradeWriting_Refund_OnInvalidBandScores_Terminal(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockInvalidBandScores})
	d := newGradeDispatcher(t, h, mock)
	jobID := enqueueDeductedGradeJob(t, h)

	if err := d.ProcessOnce(context.Background()); err != nil {
		t.Logf("processing error (expected terminal): %v", err)
	}

	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("job status = %q, want failed", got)
	}
	// AC5/AC6: NOT retried — Gemini called exactly once.
	if mock.CallCount() != 1 {
		t.Errorf("gemini called %d times, want 1 (invalid_band_scores must not retry)", mock.CallCount())
	}
	// D8: out-of-range/off-grid bands get the DISTINCT invalid_band_scores label (not
	// the generic invalid_ai_response) so 6.2b can tell "the AI proposed impossible
	// bands" apart from "the AI output was unparseable".
	if got := jobErrorDetails(t, h, jobID); got != model.JobErrorInvalidBandScores {
		t.Errorf("error_details = %q, want %q (D8)", got, model.JobErrorInvalidBandScores)
	}
	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("expected 1 refund on invalid_band_scores, got %d", n)
	}
	if sum := ledgerSum(t, h, jobID); sum != 0 {
		t.Errorf("balance = %d, want 0 (−1 deduct + 1 refund)", sum)
	}
}

// ===========================================================================
// S6b — invalid_ai_response (malformed) is TERMINAL AND refunded
// ===========================================================================

func TestGradeWriting_Refund_OnMalformed_Terminal(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockMalformed})
	d := newGradeDispatcher(t, h, mock)
	jobID := enqueueDeductedGradeJob(t, h)

	if err := d.ProcessOnce(context.Background()); err != nil {
		t.Logf("processing error (expected terminal): %v", err)
	}
	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("job status = %q, want failed", got)
	}
	if mock.CallCount() != 1 {
		t.Errorf("gemini called %d times, want 1 (invalid_ai_response must not retry)", mock.CallCount())
	}
	// D8: malformed/unparseable output gets the invalid_ai_response label (distinct
	// from invalid_band_scores).
	if got := jobErrorDetails(t, h, jobID); got != model.JobErrorInvalidAIResponse {
		t.Errorf("error_details = %q, want %q (D8)", got, model.JobErrorInvalidAIResponse)
	}
	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("expected 1 refund on invalid_ai_response, got %d", n)
	}
}

// ===========================================================================
// S6c — max_retries_exhausted (transient Gemini errors ×3) → terminal + refund
// ===========================================================================

func TestGradeWriting_Refund_OnMaxRetriesExhausted(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockTransientError})
	d := newGradeDispatcher(t, h, mock)
	jobID := enqueueDeductedGradeJob(t, h)

	for _, b := range []time.Duration{0, 30 * time.Second, 60 * time.Second, 120 * time.Second} {
		h.Clock.Advance(b)
		_ = d.ProcessOnce(context.Background())
	}

	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("after 3 retries job status = %q, want failed", got)
	}
	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("expected exactly 1 refund after max-retries, got %d", n)
	}
	if sum := ledgerSum(t, h, jobID); sum != 0 {
		t.Errorf("balance = %d, want 0", sum)
	}
}

// ===========================================================================
// S5 — R23 refund EXACTLY ONCE across a 3-retry-then-terminal run.
// The intra-retry ledger poll is the load-bearing assertion: after attempt 1 the
// ledger must hold ONLY the −1 deduct (0 refund rows). A per-attempt refund bug is
// invisible to a final-balance-only test because the unique index hides duplicates.
// ===========================================================================

func TestGradeWriting_RetryRefundExactlyOnce_IntraRetryPoll(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockTransientError})
	d := newGradeDispatcher(t, h, mock)
	jobID := enqueueDeductedGradeJob(t, h)

	// Attempt 1.
	h.Clock.Advance(0)
	_ = d.ProcessOnce(context.Background())

	// INTRA-RETRY POLL: the job is not terminal yet → the deduct stands, NO refund.
	if n := countRefunds(t, h, jobID); n != 0 {
		t.Fatalf("REFUND-PER-ATTEMPT BUG: %d refund rows after attempt 1, want 0 (job still retrying)", n)
	}
	if sum := ledgerSum(t, h, jobID); sum != -1 {
		t.Fatalf("ledger sum after attempt 1 = %d, want -1 (deduct only, no refund yet)", sum)
	}

	// Attempts 2 and 3, then exhaustion.
	for _, b := range []time.Duration{30 * time.Second, 60 * time.Second, 120 * time.Second} {
		h.Clock.Advance(b)
		_ = d.ProcessOnce(context.Background())
	}

	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("job status = %q, want failed after exhaustion", got)
	}
	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("expected exactly 1 refund at exhaustion, got %d", n)
	}
	if sum := ledgerSum(t, h, jobID); sum != 0 {
		t.Errorf("final balance = %d, want 0", sum)
	}
}

// ===========================================================================
// S6-neg — NO refund on complete (negative control)
// ===========================================================================

func TestGradeWriting_NoRefund_OnComplete(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidWritingGrade})
	d := newGradeDispatcher(t, h, mock)
	jobID := enqueueDeductedGradeJob(t, h)

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
		t.Errorf("balance for completed job = %d, want -1 (deduct stands)", sum)
	}
}

// ===========================================================================
// S7 — Worker/sweep race: two refund attempts collapse to one (idempotent).
// The pure SQL-layer proof is TestAICreditLedger_DoubleRefundIsNoOp; this asserts
// it end-to-end for the ai_grade_writing job type.
// ===========================================================================

func TestGradeWriting_DoubleRefundIsNoOp(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockTransientError})
	d := newGradeDispatcher(t, h, mock)
	jobID := enqueueDeductedGradeJob(t, h)

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

// ===========================================================================
// S13-adversarial — a TRANSIENT error whose text contains "invalid" must
// RESCHEDULE, not go terminal. Proves classification is errors.Is on the
// sentinels, NEVER strings.Contains on the message (D8).
// ===========================================================================

func TestGradeWriting_TransientErrorContainingInvalid_Reschedules(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockTransientErrorContainingInvalid})
	d := newGradeDispatcher(t, h, mock)
	jobID := enqueueDeductedGradeJob(t, h)

	// ONE pass. A correct (type-based) classifier treats this as transient →
	// the job reschedules and is NOT terminal, so NO refund yet.
	h.Clock.Advance(0)
	_ = d.ProcessOnce(context.Background())

	if got := h.JobStatus(t, jobID); got == workers.StatusFailed {
		t.Fatalf("MISCLASSIFIED: a transient error with 'invalid' in its text went terminal — classifier used strings.Contains, not errors.Is")
	}
	if n := countRefunds(t, h, jobID); n != 0 {
		t.Fatalf("premature refund: %d rows after a transient error, want 0", n)
	}
}

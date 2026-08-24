// Story 6.3b, AC7 + AC8 + AC12 (refund idempotency + failure taxonomy + the D17
// THREE-class transcode contract) — RED PHASE.
//
// Build-tagged `atdd_red_phase`: run with
//
//	go test -tags=atdd_red_phase ./internal/worker/...
//
// FAILS TO COMPILE until the green seams land (Task 9). Dev strips the tag per-AC.
//
// Reuses the package-level refund helpers from credit_refund_atdd_test.go
// (ledgerSum, countRefunds, reasonRefund) and jobErrorDetails from
// ai_grade_writing_atdd_test.go — do NOT redefine them here. Defines the speaking
// dispatcher + deducted-job helpers used by BOTH this file and the sibling
// ai_grade_speaking_atdd_test.go.
//
// WHY THE TRANSCODE TAXONOMY IS NET-NEW (D17 — the trap a copy-6-2a dev WILL hit):
//
//	6-2a writing has NO transcode. 6-3b0 shipped a THREE-class error contract, and
//	a LITERAL mirror (all transcode failure → terminal+refund) would refund AND
//	throw away a still-gradeable recording on a retryable infra blip. The mapping,
//	at the WORKER boundary (the dispatcher/4.3a spine must NOT import internal/media):
//	  media.ErrUnsupportedAudio  → terminal audio_unavailable (refund, dead-defense)
//	  media.ErrTranscodeFailed   → terminal audio_unavailable (refund)
//	  media.ErrTranscodeUnavailable → TRANSIENT (wrap ErrTransientGeneration) →
//	      reschedule → refund ONLY at exhaustion
//	  unclassified transcoder error → TRANSIENT (fail-safe default)
//	Classification is `errors.Is` on the 6-3b0 sentinels, NEVER strings.Contains.
//
// SEAMS (dev, green phase — see the sibling file header for the full list):
//   - worker.NewGradeSpeakingHandler(db, gem, clk, storage, transcoder)
//   - model.JobTypeAIGradeSpeaking / model.AIGradeSpeakingParams{SubmissionID}
//   - model.JobErrorAudioUnavailable = "audio_unavailable"
//   - model.TranscriptionStatus{Available,Unavailable}
//   - gemini modes: MockPartialSpeakingGrade (valid bands, transcript NULL),
//     MockInvalidSpeakingBandScores (a band 9.5), MockIncompleteBandsNoTranscript
//     (null/invalid bands AND null transcript — the T-C over-charge probe)
//   - media.NewMockTranscoder(out) success double + media.NewFailingMockTranscoder(err)
//     single-error double (both shipped 6-3b0) + a NEW attempt-aware
//     media.NewScriptedMockTranscoder(out []byte, script []error) (script[i] is the
//     error on attempt i+1; nil = success) for the fail-then-succeed recovery
//     (Task 9.a — TEST-ONLY, no 6-3b0 production re-open).
//   - service.MockStorageService.GetObjectKeys + GetObjectOwnedTenants spies
//     (Task 6/9.b — GetObjectOwnedTenants[i] = the tc.CenterID of the i-th owned
//     fetch, so T-D3 can prove the retry loop re-enters under the CORRECT tenant).
package worker_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/media"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/internal/test/workers"
	"github.com/ducdo/classlite-api/internal/worker"
)

// newSpeakingGradeDispatcher wires a dispatcher over the harness DB with ONLY the
// grade-speaking handler registered (storage + transcoder are constructor fields on
// the handler — the dispatcher stays storage/media-agnostic, D6/D17).
func newSpeakingGradeDispatcher(
	t *testing.T, h *workers.WorkerHarness, mock gemini.Client,
	storage service.StorageService, transcoder media.AudioTranscoder,
) *worker.Dispatcher {
	t.Helper()
	return worker.NewDispatcher(h.DB, mock, h.Clock,
		worker.NewGradeSpeakingHandler(h.DB, mock, h.Clock, storage, transcoder),
	)
}

// enqueueDeductedSpeakingGradeJob seeds center A + a speaking submission under A,
// then a pending ai_grade_speaking job + its −1 job_deduction (one tx), so refund
// math starts from −1 (the production enqueue shape, AC1). Returns the job id and
// the submission's owned audioKey so the caller can seed the storage double.
func enqueueDeductedSpeakingGradeJob(t *testing.T, h *workers.WorkerHarness) (uuid.UUID, string) {
	t.Helper()
	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.TenantContext(t, h.DB, center.ID)
	subID, audioKey := testpkg.SeedSpeakingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))
	jobID := testpkg.SeedDeductedAIJob(t, h.DB, testpkg.TenantAID,
		string(model.JobTypeAIGradeSpeaking),
		model.AIGradeSpeakingParams{SubmissionID: subID.String()})
	return jobID, audioKey
}

// speakingStorageWith seeds a storage double that returns webm bytes for the given
// owned audioKey (so the download succeeds and the transcode step is reached).
func speakingStorageWith(audioKey string) *service.MockStorageService {
	storage := service.NewMockStorageService()
	storage.SeedObject(audioKey, fakeWebmBytes)
	return storage
}

// ===========================================================================
// SS-partial — partial_success is a nil-error COMPLETE that keeps its charge
// (D3/D15/R23b). Valid bands + NULL transcript → complete,
// transcriptionStatus=unavailable, ledger = the −1 deduct only (NO refund).
// ===========================================================================

func TestGradeSpeaking_PartialSuccess_NoRefund(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	jobID, audioKey := enqueueDeductedSpeakingGradeJob(t, h)
	storage := speakingStorageWith(audioKey)
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockPartialSpeakingGrade})
	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)

	if err := d.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("partial_success must be a nil-error complete, got: %v", err)
	}
	if got := h.JobStatus(t, jobID); got != workers.StatusComplete {
		t.Fatalf("job status = %q, want complete (partial_success is NOT a failure — D3)", got)
	}
	if n := countRefunds(t, h, jobID); n != 0 {
		t.Fatalf("REFUND ON PARTIAL: partial_success must NOT refund (D15), got %d refund rows", n)
	}
	if sum := ledgerSum(t, h, jobID); sum != -1 {
		t.Errorf("ledger = %d, want -1 (deduct stands; complete-but-degraded keeps its charge)", sum)
	}
}

// ===========================================================================
// SS-full-control — the full-success control: transcript PRESENT → complete,
// also no refund. Guards against a bug that refunds on the available path.
// ===========================================================================

func TestGradeSpeaking_FullSuccess_NoRefund(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	jobID, audioKey := enqueueDeductedSpeakingGradeJob(t, h)
	storage := speakingStorageWith(audioKey)
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSpeakingGrade})
	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)

	if err := d.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("full-success ProcessOnce error: %v", err)
	}
	if got := h.JobStatus(t, jobID); got != workers.StatusComplete {
		t.Fatalf("job status = %q, want complete", got)
	}
	if n := countRefunds(t, h, jobID); n != 0 {
		t.Fatalf("REFUND ON SUCCESS: expected 0 refunds on complete, got %d", n)
	}
}

// ===========================================================================
// T-C — over-charge partial ordering (R23b=6, NEW/D3). Null/invalid bands AND
// null transcript. This is the "mark total failure as partial to dodge the
// refund" false-green: bands-absent MUST be terminal+refund, NOT complete/
// transcriptionStatus=unavailable. Proves the bands-check runs BEFORE the
// partial-return.
// ===========================================================================

func TestGradeSpeaking_OverChargePartialOrdering_TerminalRefund(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	jobID, audioKey := enqueueDeductedSpeakingGradeJob(t, h)
	storage := speakingStorageWith(audioKey)
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockIncompleteBandsNoTranscript})
	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)

	_ = d.ProcessOnce(context.Background())

	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("OVER-CHARGE BUG: null-bands+null-transcript went %q, want FAILED — it must NOT be laundered into a no-refund partial_success (D3)", got)
	}
	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("null bands must terminal-REFUND (bands = value), got %d refund rows", n)
	}
	// It must carry a bands/parse failure label, never a transcriptionStatus flag.
	if got := jobErrorDetails(t, h, jobID); got != model.JobErrorInvalidAIResponse && got != model.JobErrorInvalidBandScores {
		t.Errorf("error_details = %q, want invalid_ai_response|invalid_band_scores (bands checked BEFORE the partial return)", got)
	}
}

// ===========================================================================
// SS-audio-missing — a missing R2 object → terminal audio_unavailable + refund,
// Gemini/transcoder never called (the object read fails before transcode).
// ===========================================================================

func TestGradeSpeaking_AudioMissing_TerminalRefund_GeminiNeverCalled(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	jobID, _ := enqueueDeductedSpeakingGradeJob(t, h)
	// Storage double with NOTHING seeded → GetObjectOwned returns not-found.
	storage := service.NewMockStorageService()
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSpeakingGrade})
	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)

	_ = d.ProcessOnce(context.Background())

	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("missing audio must be terminal, job status = %q", got)
	}
	if got := jobErrorDetails(t, h, jobID); got != model.JobErrorAudioUnavailable {
		t.Errorf("error_details = %q, want %q", got, model.JobErrorAudioUnavailable)
	}
	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("expected 1 refund on audio_unavailable, got %d", n)
	}
	if mock.CallCount() != 0 {
		t.Errorf("gemini called %d times on a missing-audio path, want 0", mock.CallCount())
	}
	if transcoder.CallCount() != 0 {
		t.Errorf("transcoder called %d times on a missing-audio path, want 0 (nothing to transcode)", transcoder.CallCount())
	}
}

// ===========================================================================
// SS-invalid-bands — off-grid/out-of-range bands → terminal invalid_band_scores
// + refund; NOT retried (Gemini called exactly once).
// ===========================================================================

func TestGradeSpeaking_InvalidBandScores_TerminalRefund(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	jobID, audioKey := enqueueDeductedSpeakingGradeJob(t, h)
	storage := speakingStorageWith(audioKey)
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockInvalidSpeakingBandScores})
	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)

	_ = d.ProcessOnce(context.Background())

	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("invalid bands must be terminal, job status = %q", got)
	}
	if mock.CallCount() != 1 {
		t.Errorf("gemini called %d times, want 1 (invalid_band_scores must not retry)", mock.CallCount())
	}
	if got := jobErrorDetails(t, h, jobID); got != model.JobErrorInvalidBandScores {
		t.Errorf("error_details = %q, want %q (D8)", got, model.JobErrorInvalidBandScores)
	}
	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("expected 1 refund on invalid_band_scores, got %d", n)
	}
}

// ===========================================================================
// SS-intra-retry — R23 refund EXACTLY ONCE across a transient-Gemini 3-retry-
// then-terminal run. Intra-retry poll: after attempt 1 the ledger holds ONLY the
// −1 deduct (a per-attempt refund bug is invisible to a final-balance-only test
// because the (ref_job_id, reason) unique index hides duplicates).
// ===========================================================================

func TestGradeSpeaking_RetryRefundExactlyOnce_IntraRetryPoll(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	jobID, audioKey := enqueueDeductedSpeakingGradeJob(t, h)
	storage := speakingStorageWith(audioKey)
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockTransientError}) // Gemini transient
	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)

	// Attempt 1.
	h.Clock.Advance(0)
	_ = d.ProcessOnce(context.Background())
	if n := countRefunds(t, h, jobID); n != 0 {
		t.Fatalf("REFUND-PER-ATTEMPT BUG: %d refund rows after attempt 1, want 0 (still retrying)", n)
	}
	if sum := ledgerSum(t, h, jobID); sum != -1 {
		t.Fatalf("ledger after attempt 1 = %d, want -1 (deduct only)", sum)
	}

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
// SS-double-refund — worker+sweep race collapses to one refund (idempotent).
// ===========================================================================

func TestGradeSpeaking_DoubleRefundIsNoOp(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	jobID, audioKey := enqueueDeductedSpeakingGradeJob(t, h)
	storage := speakingStorageWith(audioKey)
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockTransientError})
	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)

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
// T-D1 — media.ErrUnsupportedAudio → terminal audio_unavailable + refund-once +
// Gemini never called (D17). DEAD-DEFENSE: unreachable past the enqueue empty-
// audioKey + size guards; asserted here for CONTRACT STABILITY, via errors.Is
// (never strings.Contains). Direct-inject.
// ===========================================================================

func TestGradeSpeaking_TranscodeUnsupported_TerminalRefund_GeminiNeverCalled(t *testing.T) {
	assertTranscodeTerminalRefund(t, media.ErrUnsupportedAudio)
}

// ===========================================================================
// T-D2 — media.ErrTranscodeFailed → terminal audio_unavailable + refund-once +
// Gemini never called (D17). Distinct error value, same terminal disposition.
// ===========================================================================

func TestGradeSpeaking_TranscodeFailed_TerminalRefund_GeminiNeverCalled(t *testing.T) {
	assertTranscodeTerminalRefund(t, media.ErrTranscodeFailed)
}

// assertTranscodeTerminalRefund drives one transcode-terminal class end-to-end:
// download succeeds, transcode returns `transcodeErr` (errors.Is-typed), the
// worker maps it to terminal audio_unavailable, the dispatcher refunds ONCE, and
// Gemini is NEVER reached.
func assertTranscodeTerminalRefund(t *testing.T, transcodeErr error) {
	t.Helper()
	h := workers.SetupWorkerHarness(t)
	jobID, audioKey := enqueueDeductedSpeakingGradeJob(t, h)
	storage := speakingStorageWith(audioKey) // download SUCCEEDS
	transcoder := media.NewFailingMockTranscoder(transcodeErr)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSpeakingGrade})
	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)

	_ = d.ProcessOnce(context.Background())

	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("%v must be terminal, job status = %q", transcodeErr, got)
	}
	if got := jobErrorDetails(t, h, jobID); got != model.JobErrorAudioUnavailable {
		t.Errorf("error_details = %q, want %q", got, model.JobErrorAudioUnavailable)
	}
	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("expected exactly 1 refund on terminal transcode, got %d", n)
	}
	if mock.CallCount() != 0 {
		t.Errorf("gemini called %d times on a terminal-transcode path, want 0", mock.CallCount())
	}
	if transcoder.CallCount() != 1 {
		t.Errorf("transcoder called %d times, want 1 (terminal transcode must NOT retry)", transcoder.CallCount())
	}
}

// ===========================================================================
// T-D3 — media.ErrTranscodeUnavailable → RESCHEDULE, NO refund on the retry
// attempts, refund EXACTLY ONCE at exhaustion; Gemini CallCount()==0 across ALL
// attempts (D17). R3=9 RE-SCOPE (Murat, hold-the-story item): the retry loop
// re-enters the tenant-scoped download path per attempt — a fresh forget-SET-LOCAL
// opportunity — so it MUST re-drive GetObjectOwned under the CORRECT tenant on
// every attempt (not assumed-sticky) and re-transcode (no cached bytes).
// ===========================================================================

func TestGradeSpeaking_TranscodeUnavailable_Reschedules_RefundOnceAtExhaustion(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	jobID, audioKey := enqueueDeductedSpeakingGradeJob(t, h)
	storage := speakingStorageWith(audioKey)
	transcoder := media.NewFailingMockTranscoder(media.ErrTranscodeUnavailable) // transient every attempt
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSpeakingGrade})
	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)

	// Attempt 1 — a transient infra fault must NOT burn the credit yet.
	h.Clock.Advance(0)
	_ = d.ProcessOnce(context.Background())
	if got := h.JobStatus(t, jobID); got == workers.StatusFailed {
		t.Fatalf("MISCLASSIFIED: ErrTranscodeUnavailable went terminal on attempt 1 — a retryable infra blip discarded a gradeable recording (D17)")
	}
	if n := countRefunds(t, h, jobID); n != 0 {
		t.Fatalf("premature refund: %d rows after a transient transcode, want 0", n)
	}

	// Drive the 30/60/120s backoff ladder to exhaustion.
	for _, b := range []time.Duration{30 * time.Second, 60 * time.Second, 120 * time.Second} {
		h.Clock.Advance(b)
		_ = d.ProcessOnce(context.Background())
	}

	// Anti-hostage guarantee (John): the bounded ladder MUST land on a GUARANTEED
	// terminal audio_unavailable + refund — never unsettled-credit purgatory.
	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("job status = %q, want failed after exhaustion (anti-hostage: bounded ladder must terminate)", got)
	}
	if got := jobErrorDetails(t, h, jobID); got != model.JobErrorAudioUnavailable {
		t.Errorf("error_details = %q, want %q at exhaustion", got, model.JobErrorAudioUnavailable)
	}
	if n := countRefunds(t, h, jobID); n != 1 {
		t.Fatalf("expected EXACTLY 1 refund at exhaustion (no fourth path, no double), got %d", n)
	}
	if sum := ledgerSum(t, h, jobID); sum != 0 {
		t.Errorf("final balance = %d, want 0 (deduct + one refund)", sum)
	}

	// Gemini NEVER reached — the transcode fails before it every attempt.
	if mock.CallCount() != 0 {
		t.Errorf("gemini called %d times across the transcode-retry ladder, want 0", mock.CallCount())
	}

	// R3=9 hold-the-line: the download+transcode ran once PER attempt (no caching),
	// and EVERY owned fetch was under tenant A (the retry loop never leaks tenant).
	// NB: the dispatcher runs generate() on the terminal pick too (MaxJobRetries=3
	// → 3 reschedules + 1 terminal run), so the count is >= 3; the invariant is the
	// per-attempt tenant, not the exact number.
	if transcoder.CallCount() != len(storage.GetObjectKeys) {
		t.Errorf("re-download/re-transcode mismatch: transcoder ran %d, downloads %d — every attempt must re-download AND re-transcode (no cached bytes)", transcoder.CallCount(), len(storage.GetObjectKeys))
	}
	if transcoder.CallCount() < 3 {
		t.Errorf("transcoder ran %d times, want >= 3 (the retry ladder must actually re-drive the transcode)", transcoder.CallCount())
	}
	if len(storage.GetObjectOwnedTenants) == 0 {
		t.Fatal("no owned fetches captured — the retry loop never re-entered the download path")
	}
	for i, tenant := range storage.GetObjectOwnedTenants {
		if tenant != testpkg.TenantAID {
			t.Errorf("R3 BREACH: attempt %d re-drove GetObjectOwned under tenant %q, want %q — a retry forgot SET LOCAL", i+1, tenant, testpkg.TenantAID)
		}
	}
}

// ===========================================================================
// T-D3-recovery — a transcode that fails transient on attempts 1–2 then SUCCEEDS
// on attempt 3 → (result, nil), NO refund, ONE grade. Proves a still-valid
// recording is not thrown away on an infra blip (D17).
// ===========================================================================

func TestGradeSpeaking_TranscodeUnavailable_ThenSuccess_NoRefund(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	jobID, audioKey := enqueueDeductedSpeakingGradeJob(t, h)
	storage := speakingStorageWith(audioKey)
	// Transient on attempts 1 and 2, then success on attempt 3.
	transcoder := media.NewScriptedMockTranscoder(fakeOggBytes, []error{
		media.ErrTranscodeUnavailable, media.ErrTranscodeUnavailable, nil,
	})
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSpeakingGrade})
	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)

	for _, b := range []time.Duration{0, 30 * time.Second, 60 * time.Second} {
		h.Clock.Advance(b)
		_ = d.ProcessOnce(context.Background())
	}

	if got := h.JobStatus(t, jobID); got != workers.StatusComplete {
		t.Fatalf("job status = %q, want complete (recovered on attempt 3)", got)
	}
	if n := countRefunds(t, h, jobID); n != 0 {
		t.Fatalf("NO refund on a recovered job, got %d", n)
	}
	if sum := ledgerSum(t, h, jobID); sum != -1 {
		t.Errorf("ledger = %d, want -1 (the grade was delivered — the teacher pays once)", sum)
	}
	if mock.CallCount() != 1 {
		t.Errorf("gemini called %d times, want 1 (once, on the successful transcode)", mock.CallCount())
	}
}

// ===========================================================================
// T-D-failsafe — an UNCLASSIFIED transcoder error (a bare errors.New that is NOT
// errors.Is any 6-3b0 sentinel) → TRANSIENT reschedule, NOT terminal (D17
// fail-safe default). Proves a future un-Is-able 6-3b0 error can't silently burn
// the credit: a wrong-terminal charges immediately; a retry eventually refunds.
// ===========================================================================

func TestGradeSpeaking_TranscodeUnclassifiedError_Reschedules(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	jobID, audioKey := enqueueDeductedSpeakingGradeJob(t, h)
	storage := speakingStorageWith(audioKey)
	transcoder := media.NewFailingMockTranscoder(errors.New("some brand-new 6-3b0 failure mode nobody mapped yet"))
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSpeakingGrade})
	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)

	// ONE pass. A correct fail-safe treats the unclassified error as transient →
	// the job reschedules, is NOT terminal, and NO refund fires yet.
	h.Clock.Advance(0)
	_ = d.ProcessOnce(context.Background())

	if got := h.JobStatus(t, jobID); got == workers.StatusFailed {
		t.Fatalf("FAIL-SAFE VIOLATION: an unclassified transcoder error went terminal — a future un-Is-able 6-3b0 error would burn the credit immediately (D17)")
	}
	if n := countRefunds(t, h, jobID); n != 0 {
		t.Fatalf("premature refund: %d rows after an unclassified transcode error, want 0", n)
	}
	if mock.CallCount() != 0 {
		t.Errorf("gemini called %d times on a transcode failure, want 0", mock.CallCount())
	}
}

// Story 6.3b, AC11 + AC12 (AI speaking-grade worker: transcode + Gemini audio) —
// RED PHASE.
//
// Build-tagged `atdd_red_phase` (6-3a convention): excluded from `go test ./...`;
// run with `go test -tags=atdd_red_phase ./internal/worker/...`. FAILS TO COMPILE
// today (worker.NewGradeSpeakingHandler, model.JobTypeAIGradeSpeaking, the gemini
// speaking mock modes, the extended media.MockTranscoder, and
// testpkg.SeedSpeakingSubmissionForTenant do not exist yet). Dev removes this
// file's build tag per-AC as the seams land (Task 9).
//
// This is the STRUCTURAL MIRROR of ai_grade_writing_atdd_test.go over the speaking
// domain, plus the net-new transcode read surface. The refund/taxonomy/transcode-
// class scaffolds live in the sibling ai_grade_speaking_refund_atdd_test.go.
//
// WHAT THIS PROVES (R3/A7 = BLOCK(9), the async equivalent of GO-1, now over a
// THIRD read surface — the R2 AUDIO object):
//
//	The job row's center_id is the SOLE tenant trust anchor. This worker reads a
//	SUBMISSION row AND downloads an R2 audio object. A missing SET LOCAL or an
//	honored payload center_id must fail closed (0 rows → NotFoundError) BEFORE the
//	audio is ever fetched, and NEITHER Gemini NOR the transcoder may ever touch
//	another tenant's recording (CallCount()==0 on both is the load-bearing
//	tripwire — the writing mirror only had the Gemini tripwire).
//
// SEAMS (dev confirms exact shapes in green phase — the ONE place to edit):
//   - worker.NewGradeSpeakingHandler(h.DB, gemini.Client, clock.Clock,
//     service.StorageService, media.AudioTranscoder) workers.JobHandler
//     · storage + transcoder are CONSTRUCTOR fields (NOT on the generic
//     generate() signature — the dispatcher/4.3a spine stays storage- and
//     media-agnostic, D6/D17).
//   - model.JobTypeAIGradeSpeaking model.JobType = "ai_grade_speaking"
//   - model.AIGradeSpeakingParams { SubmissionID string `json:"submissionId"` }
//   - model.AISpeakingGradeResult { Criteria{fluencyCoherence,lexicalResource,
//     grammaticalRange,pronunciation:{band,rationale,confidence}},
//     Moments[]{type,criterion,timestampMs*,text,confidence}, Transcript*,
//     TranscriptionStatus, OverallFeedback*, AnalyzedDurationMs, LatencyMs }
//   - model.TranscriptionStatusAvailable = "available" /
//     model.TranscriptionStatusUnavailable = "unavailable"
//   - model.JobErrorAudioUnavailable = "audio_unavailable"
//   - gemini speaking mock modes on gemini.MockClient (canned JSON; the mock's
//     Generate ignores its request arg): MockValidSpeakingGrade (four valid bands,
//     transcript PRESENT, one IN-bound moment + one OUT-of-bound moment relative
//     to the fixture duration so the demote-not-drop assertion is non-vacuous),
//     MockSpeakingNullMomentConfidence (a moment with null confidence),
//     MockSpeakingMalformedMoment (valid bands + transcript + one structurally-bad
//     moment: bad type/criterion/blank text). See SpeakingGradeFixture.
//   - media.NewMockTranscoder(out []byte) — success double already exists (6-3b0);
//     returns (out, media.OutputMIME, nil) + CallCount().
//   - service.MockStorageService.GetObjectOwned + SeedObject + GetObjectKeys spy
//     (Task 6, sibling storage_get_object_owned_atdd_test.go pins the guard).
//   - testpkg.SeedSpeakingSubmissionForTenant(t, h.DB, centerID uuid.UUID)
//     (subID uuid.UUID, audioKey string)
//     — seeds the class/exercise(speaking)/assignment/student/submission chain
//     under centerID; content.audioKey is under centerID's prefix (SEC-8) and
//     content.durationSec == SpeakingGradeFixtureDurationSec so the mock's
//     moment offsets align (mirror SeedWritingSubmissionForTenant).
//   - testpkg.SeedSpeakingSubmissionWithAudioKey(t, h.DB, centerID uuid.UUID,
//     audioKey string) uuid.UUID
//     — same chain, but with a caller-supplied audioKey (the T-B poisoned key
//     carries a FOREIGN center prefix while the submission is legit under A).
package worker_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/media"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/internal/test/workers"
	"github.com/ducdo/classlite-api/internal/worker"
)

// fakeWebmBytes is the canned "downloaded audio" the storage mock hands back — the
// worker transcodes it (via the mock transcoder) before Gemini, so its content is
// irrelevant; it exists only to prove a NON-empty download reached the transcoder.
var fakeWebmBytes = []byte("fake-webm-container-bytes-not-real-audio")

// fakeOggBytes is what the mock transcoder returns — the "Gemini-ingestible ogg".
var fakeOggBytes = []byte("fake-ogg-opus-bytes")

// newGradeSpeakingHandler is the single DI reconciliation point for the speaking
// grader. Intent: it depends on the tx-scoped DB, the injected gemini client, the
// deterministic clock, and — NET-NEW over writing — an injected StorageService
// (audio download, SEC-8) and media.AudioTranscoder (6-3b0). Nothing tenant-ish
// comes from the payload.
func newGradeSpeakingHandler(
	t *testing.T, h *workers.WorkerHarness, gem gemini.Client,
	storage service.StorageService, transcoder media.AudioTranscoder,
) workers.JobHandler {
	t.Helper()
	return worker.NewGradeSpeakingHandler(h.DB, gem, h.Clock, storage, transcoder)
}

// ===========================================================================
// SS1 — Pattern 1: HappyPath (row tenant set; result shape + transcode + demote)
// ===========================================================================

func TestGradeSpeaking_HappyPath(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	subID, audioKey := testpkg.SeedSpeakingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	// Storage returns the (webm) recording for the submission's owned audioKey;
	// the transcoder re-encodes it to ogg before Gemini.
	storage := service.NewMockStorageService()
	storage.SeedObject(audioKey, fakeWebmBytes)
	transcoder := media.NewMockTranscoder(fakeOggBytes)

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSpeakingGrade})
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeSpeaking),
		model.AIGradeSpeakingParams{SubmissionID: subID.String()})

	// Drive through the dispatcher so job.result is persisted via MarkJobComplete.
	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)
	if err := d.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("happy path returned error: %v", err)
	}
	if got := h.JobStatus(t, jobID); got != workers.StatusComplete {
		t.Fatalf("job status = %q, want %q", got, workers.StatusComplete)
	}
	if mock.CallCount() != 1 {
		t.Errorf("gemini.Generate called %d times, want exactly 1", mock.CallCount())
	}
	if transcoder.CallCount() != 1 {
		t.Errorf("transcoder called %d times, want exactly 1 (audio must be re-encoded before Gemini)", transcoder.CallCount())
	}

	var res model.AISpeakingGradeResult
	if err := json.Unmarshal(jobResultRaw(t, h, jobID), &res); err != nil {
		t.Fatalf("job.result is not a valid AISpeakingGradeResult: %v", err)
	}

	// Seam invariant (D3): a complete result carries all four valid+on-grid bands.
	for name, cr := range map[string]model.AISpeakingGradeCriterion{
		"fluencyCoherence": res.Criteria.FluencyCoherence,
		"lexicalResource":  res.Criteria.LexicalResource,
		"grammaticalRange": res.Criteria.GrammaticalRange,
		"pronunciation":    res.Criteria.Pronunciation,
	} {
		if cr.Band < 1.0 || cr.Band > 9.0 || cr.Band*2 != float64(int(cr.Band*2)) {
			t.Errorf("criterion %s band %.2f out of range / off the 0.5 grid", name, cr.Band)
		}
		if cr.Confidence != "high" && cr.Confidence != "medium" {
			t.Errorf("criterion %s confidence %q not in {high, medium}", name, cr.Confidence)
		}
	}

	// Transcript PRESENT → transcriptionStatus available (the partial_success flag
	// is exercised in the refund suite).
	if res.TranscriptionStatus != model.TranscriptionStatusAvailable {
		t.Errorf("transcriptionStatus = %q, want %q (transcript present)", res.TranscriptionStatus, model.TranscriptionStatusAvailable)
	}
	if res.Transcript == nil || *res.Transcript == "" {
		t.Error("expected a non-empty transcript on the available path")
	}

	// Moment handling (D5/D11): the OUT-of-bound moment is DEMOTED to null-timestamp
	// (a general note) but KEPT, never dropped; the in-bound moment retains its pin.
	var sawDemoted, sawPinned bool
	for _, m := range res.Moments {
		if m.Type != strings.ToLower(m.Type) {
			t.Errorf("moment type %q is not lowercase", m.Type)
		}
		if strings.Contains(m.Text, "OUTOFBOUND") {
			if m.TimestampMs != nil {
				t.Errorf("out-of-bound moment not demoted: timestampMs=%v", *m.TimestampMs)
			}
			sawDemoted = true
		}
		if strings.Contains(m.Text, "PINNED") && m.TimestampMs != nil {
			sawPinned = true
		}
	}
	if !sawDemoted {
		t.Error("expected the out-of-bound moment present-and-demoted, not dropped (D11)")
	}
	if !sawPinned {
		t.Error("expected the in-bound moment to retain its timestamp pin")
	}
}

// ===========================================================================
// SS2 — Pattern 2: PayloadCenterIdIgnored (job row=A; payload smuggles B).
// Neither Gemini NOR the transcoder may be reached on a cross-tenant miss.
// ===========================================================================

func TestGradeSpeaking_PayloadCenterIdIgnored(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantBID, "Tenant B", "TENB")

	bSub, _ := testpkg.SeedSpeakingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantBID))

	// Job row says A; payload smuggles B's submission id → must resolve under A's
	// RLS → 0 rows → NotFoundError, before any download/transcode/Gemini.
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeSpeaking),
		model.AIGradeSpeakingParams{SubmissionID: bSub.String()})

	storage := service.NewMockStorageService()
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSpeakingGrade})

	err := h.ProcessSpecific(context.Background(), t, jobID, newGradeSpeakingHandler(t, h, mock, storage, transcoder))

	var nf model.NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("RLS VIOLATION (R3): payload submissionId=B honored under tenant A — want NotFoundError, got %v", err)
	}
	assertGeminiAndTranscoderUntouched(t, mock, transcoder, storage)
}

// ===========================================================================
// SS3 — Pattern 3: NullTenantContextRejected (simulate the SET LOCAL bug).
// ===========================================================================

func TestGradeSpeaking_NullTenantContextRejected(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.TenantContext(t, h.DB, center.ID)
	subID, _ := testpkg.SeedSpeakingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeSpeaking),
		model.AIGradeSpeakingParams{SubmissionID: subID.String()})

	storage := service.NewMockStorageService()
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSpeakingGrade})

	if err := h.ProcessWithoutTenantContext(context.Background(), t, jobID, newGradeSpeakingHandler(t, h, mock, storage, transcoder)); err == nil {
		t.Fatal("RLS VIOLATION (SEC-6/GO-1): grader succeeded with NO tenant context set")
	}
	assertGeminiAndTranscoderUntouched(t, mock, transcoder, storage)
}

// ===========================================================================
// SS4 — R3-submission cross-tenant read + Gemini/transcoder never invoked
// (AC12; R3=9). The generic grid tests a JOB read; THIS proves the SUBMISSION
// read fails closed BEFORE the audio download — the R3=9 headline miss, now
// over the third (audio) read surface.
// ===========================================================================

func TestGradeSpeaking_SubmissionCrossTenant_GeminiAndTranscoderNeverInvoked(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantBID, "Tenant B", "TENB")

	// Submission S seeded under tenant B.
	bSub, _ := testpkg.SeedSpeakingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantBID))

	// Job ROW is tenant A, referencing B's submission.
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeSpeaking),
		model.AIGradeSpeakingParams{SubmissionID: bSub.String()})

	storage := service.NewMockStorageService()
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSpeakingGrade})

	err := h.ProcessSpecific(context.Background(), t, jobID, newGradeSpeakingHandler(t, h, mock, storage, transcoder))

	var nf model.NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("R3 BREACH: submission fetch under A returned B's row — want NotFoundError, got %v", err)
	}
	// The submission read fails closed BEFORE GetObjectOwned is ever reached.
	if len(storage.GetObjectKeys) != 0 {
		t.Errorf("R3 BREACH: audio download attempted (%v) on a cross-tenant submission miss — must never reach GetObjectOwned", storage.GetObjectKeys)
	}
	assertGeminiAndTranscoderUntouched(t, mock, transcoder, storage)
	if raw := jobResultRaw(t, h, jobID); len(raw) != 0 && string(raw) != "null" {
		t.Errorf("R3 BREACH: job.result was written (%s) on a cross-tenant miss, want NULL", string(raw))
	}
}

// ===========================================================================
// T-B — poisoned-audioKey end-to-end (AC12; R3=9, NEW/D13/D14). The submission
// is LEGITIMATELY under tenant A (step-1 passes), but its content.audioKey
// carries tenant B's prefix. GetObjectOwned's guard is the ONLY defense left:
// it must terminal-fail audio_unavailable, emit a DISTINCT discrepancy log
// (D14, attack signal), never call Gemini/transcoder, and never read B's bytes.
// ===========================================================================

func TestGradeSpeaking_PoisonedAudioKey_GuardIsOnlyDefense(t *testing.T) {

	// Capture slog so we can prove the discrepancy log fires (D14) WITHOUT the
	// external error label becoming an oracle.
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantBID, "Tenant B", "TENB")

	// Submission legit under A, but its audioKey points into B's prefix.
	poisonedKey := testpkg.TenantBID + "/speaking/" + uuid.NewString() + ".webm"
	subID := testpkg.SeedSpeakingSubmissionWithAudioKey(t, h.DB, uuid.MustParse(testpkg.TenantAID), poisonedKey)

	// Seed B's bytes at the poisoned key so a missing guard would exfiltrate them —
	// the test proves they are never fetched.
	storage := service.NewMockStorageService()
	storage.SeedObject(poisonedKey, []byte("tenant-B-private-audio"))
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSpeakingGrade})

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeSpeaking),
		model.AIGradeSpeakingParams{SubmissionID: subID.String()})

	err := h.ProcessSpecific(context.Background(), t, jobID, newGradeSpeakingHandler(t, h, mock, storage, transcoder))

	// Terminal audio_unavailable (external label — clean, no cross-tenant oracle).
	var tr *worker.TerminalReasonError
	if !errors.As(err, &tr) || tr.Reason != model.JobErrorAudioUnavailable {
		t.Fatalf("poisoned audioKey must terminal-fail audio_unavailable, got %v", err)
	}
	// B's bytes never read; nothing downstream reached.
	if len(storage.GetObjectKeys) != 0 {
		t.Errorf("R3 BREACH: the guard must fire before fetch, but B's bytes were fetched: %v", storage.GetObjectKeys)
	}
	assertGeminiAndTranscoderUntouched(t, mock, transcoder, storage)

	// D14: a DISTINCT internal discrepancy log fires (attack signal, alertable) —
	// but it must NOT leak the foreign bytes.
	logs := buf.String()
	if !strings.Contains(logs, "discrepancy") {
		t.Errorf("D14 VIOLATION: expected a distinct discrepancy log on a cross-tenant-prefix audioKey.\n---LOGS---\n%s", logs)
	}
	if strings.Contains(logs, "tenant-B-private-audio") {
		t.Errorf("LEAK: foreign audio bytes surfaced in logs.\n---LOGS---\n%s", logs)
	}
}

// ===========================================================================
// SS-null-moment-conf — a moment with null confidence → terminal
// invalid_ai_response (D5/D11). Guards the positional zip nil-deref; DISTINCT
// from null-CRITERION-confidence. This is a completeness pre-check that runs
// BEFORE the drop pass, so it must NOT be silently dropped like a structural
// moment error.
// ===========================================================================

func TestGradeSpeaking_NullMomentConfidence_Terminal(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	subID, audioKey := testpkg.SeedSpeakingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	storage := service.NewMockStorageService()
	storage.SeedObject(audioKey, fakeWebmBytes)
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockSpeakingNullMomentConfidence})

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeSpeaking),
		model.AIGradeSpeakingParams{SubmissionID: subID.String()})

	err := h.ProcessSpecific(context.Background(), t, jobID, newGradeSpeakingHandler(t, h, mock, storage, transcoder))
	if err == nil {
		t.Fatal("a null moment-confidence must be a terminal error, got nil (positional-zip nil-deref guard)")
	}
	if !errors.Is(err, worker.ErrInvalidAIResponse) {
		t.Errorf("err = %v, want errors.Is ErrInvalidAIResponse (D5 completeness)", err)
	}
	if raw := jobResultRaw(t, h, jobID); len(raw) != 0 && string(raw) != "null" {
		t.Errorf("incomplete result was stored (%s), want NULL — seam invariant: complete ⇒ gradeable", string(raw))
	}
}

// ===========================================================================
// SS-drop-moment — a structurally-malformed moment does NOT sink a full-value
// grade (D11, Ducdo Option ii): DROP the bad moment, KEEP the graded result,
// CHARGE the credit. The antithesis of null-moment-confidence (terminal). This
// is the single sharpest divergence from the writing mirror (writing terminal-
// fails on a bad comment).
// ===========================================================================

func TestGradeSpeaking_MalformedMoment_Dropped_NotTerminal(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	subID, audioKey := testpkg.SeedSpeakingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	storage := service.NewMockStorageService()
	storage.SeedObject(audioKey, fakeWebmBytes)
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	// Valid bands + present transcript + one structurally-bad moment (bad
	// type/criterion/blank text) alongside one good moment.
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockSpeakingMalformedMoment})

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeSpeaking),
		model.AIGradeSpeakingParams{SubmissionID: subID.String()})

	d := newSpeakingGradeDispatcher(t, h, mock, storage, transcoder)
	if err := d.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("a malformed MOMENT must NOT terminal-fail a full-value grade (D11), got: %v", err)
	}
	if got := h.JobStatus(t, jobID); got != workers.StatusComplete {
		t.Fatalf("job status = %q, want complete (D11 — drop the bad moment, keep the grade)", got)
	}

	var res model.AISpeakingGradeResult
	if err := json.Unmarshal(jobResultRaw(t, h, jobID), &res); err != nil {
		t.Fatalf("job.result not a valid AISpeakingGradeResult: %v", err)
	}
	// The good moment survives; the structurally-bad one is dropped (not present).
	for _, m := range res.Moments {
		if strings.Contains(m.Text, "BADMOMENT") {
			t.Errorf("the structurally-malformed moment was NOT dropped: %+v", m)
		}
	}
	if len(res.Moments) == 0 {
		t.Error("expected the good moment to survive the drop pass")
	}
}

// ===========================================================================
// SS-zero-writes — a successful (or partial_success) job writes NEITHER a
// grades row NOR a submissions UPDATE (D1). Positive proof via pre/post
// snapshot, asserted AFTER a partial_success run (the degraded-but-complete
// path must still write nothing but the job).
// ===========================================================================

func TestGradeSpeaking_Success_WritesNoGradeNorSubmission(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	subID, audioKey := testpkg.SeedSpeakingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	beforeSub := submissionRowFingerprint(t, h, subID)
	beforeGrades := gradesCountForSubmission(t, h, subID)

	storage := service.NewMockStorageService()
	storage.SeedObject(audioKey, fakeWebmBytes)
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	// Partial success (valid bands, null transcript) — the degraded complete path.
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockPartialSpeakingGrade})

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeSpeaking),
		model.AIGradeSpeakingParams{SubmissionID: subID.String()})
	if err := h.ProcessSpecific(context.Background(), t, jobID, newGradeSpeakingHandler(t, h, mock, storage, transcoder)); err != nil {
		t.Fatalf("partial_success path must be a nil-error complete, got: %v", err)
	}

	if after := submissionRowFingerprint(t, h, subID); after != beforeSub {
		t.Errorf("D1 VIOLATION: submission row mutated by the AI grader\n before=%s\n after =%s", beforeSub, after)
	}
	if after := gradesCountForSubmission(t, h, subID); after != beforeGrades {
		t.Errorf("D1 VIOLATION: grades rows changed %d→%d — the worker inserted a grade", beforeGrades, after)
	}
}

// ===========================================================================
// SS-no-log — secret / prompt / AUDIO bytes / transcript never logged (R49;
// AC12). Extends the writing R49 test with two speaking-specific PII surfaces:
// the raw audio bytes and the auto-transcribed transcript.
// ===========================================================================

func TestGradeSpeaking_SecretsPromptAudioAndTranscript_NeverLogged(t *testing.T) {

	const secretKeyValue = "AIzaSy-DEADBEEF-super-secret-gemini-key-do-not-log"
	const promptMarker = "SENSITIVE_PROMPT_MARKER_should_never_be_logged"
	const transcriptMarker = "SENSITIVE_TRANSCRIPT_MARKER_should_never_be_logged"
	audioMarker := "SENSITIVE_AUDIO_BYTES_should_never_be_logged"

	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	subID, audioKey := testpkg.SeedSpeakingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	storage := service.NewMockStorageService()
	storage.SeedObject(audioKey, []byte(audioMarker)) // the "audio bytes" carry a sentinel
	transcoder := media.NewMockTranscoder(fakeOggBytes)
	mock := gemini.NewMockClient(gemini.MockConfig{
		Mode:           gemini.MockValidSpeakingGrade,
		APIKey:         secretKeyValue,
		PromptMarker:   promptMarker,
		ResponseMarker: transcriptMarker, // rides inside the transcript in the response
	})

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeSpeaking),
		model.AIGradeSpeakingParams{SubmissionID: subID.String()})
	_ = h.ProcessSpecific(context.Background(), t, jobID, newGradeSpeakingHandler(t, h, mock, storage, transcoder))

	logs := buf.String()
	for _, forbidden := range []string{secretKeyValue, promptMarker, transcriptMarker, audioMarker} {
		if strings.Contains(logs, forbidden) {
			t.Errorf("R49 VIOLATION: forbidden value %q leaked into logs.\n---LOGS---\n%s", forbidden, logs)
		}
	}
	// Positive control so the negative check is not vacuous.
	if !strings.Contains(logs, testpkg.TenantAID) && !strings.Contains(logs, jobID.String()) {
		t.Error("expected job_id/center_id correlation fields in logs; buffer had neither")
	}
}

// assertGeminiAndTranscoderUntouched is the speaking tripwire: on any fail-closed
// path NEITHER the model NOR the transcoder may run, and no audio may be fetched.
func assertGeminiAndTranscoderUntouched(t *testing.T, mock *gemini.MockClient, transcoder *media.MockTranscoder, storage *service.MockStorageService) {
	t.Helper()
	if mock.CallCount() != 0 {
		t.Errorf("gemini.Generate called %d times on a fail-closed path, want 0", mock.CallCount())
	}
	if transcoder.CallCount() != 0 {
		t.Errorf("transcoder called %d times on a fail-closed path, want 0", transcoder.CallCount())
	}
	if len(storage.GetObjectKeys) != 0 {
		t.Errorf("audio fetched %d time(s) on a fail-closed path, want 0: %v", len(storage.GetObjectKeys), storage.GetObjectKeys)
	}
}

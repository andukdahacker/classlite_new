// Story 6.3b — the ai_grade_speaking job handler. The SPEAKING twin of
// ai_grade_writing.go: it rides the SAME 4.3a dispatcher (jobs.type is free text, no
// migration) and, like the writing grader, is a DB-READING handler that produces a
// reviewable AISpeakingGradeResult SUGGESTION in jobs.result. It writes NOTHING but the
// job result (D1): no grades row, no submissions UPDATE — the teacher commits via the
// shipped 6.3a POST /grade speaking branch.
//
// NET-NEW over the writing mirror (all party-verified):
//   - A THIRD read surface: after the RLS submission read it downloads the R2 AUDIO
//     object through StorageService.GetObjectOwned (SEC-8, the shared prefix guard).
//     R3/A7 (the async GO-1) now spans three surfaces — a cross-tenant / null-tenant
//     read must fail closed BEFORE the audio is fetched, and NEITHER Gemini NOR the
//     transcoder may ever touch another tenant's recording.
//   - A transcode step (6-3b0): Gemini inline audio rejects webm/mp4, so the recording
//     is re-encoded to ogg first. 6-3b0 exposes a THREE-class errors.Is error contract;
//     the translation onto the dispatcher's terminal-vs-retry vocabulary happens HERE,
//     at the worker boundary — the dispatcher/4.3a spine MUST NOT import internal/media
//     (D17), so the churny infra package never forces a shared-spine edit.
//   - partial_success (D3): a valid-bands-but-null-transcript result is a nil-error
//     COMPLETE carrying transcriptionStatus=unavailable — never a terminal failure, and
//     the credit is NOT refunded (D15). Bands are REQUIRED for any complete result; the
//     transcript is OPTIONAL.
//   - Moment handling DIVERGES from writing (D11): a structurally-bad moment is DROPPED
//     FIRST (keep the full-value grade + charge the credit), not terminal-failed — even
//     when it also lacks confidence (code review: a junk moment never sinks a grade). A
//     SURVIVING moment missing its confidence is still terminal (its confidence is
//     load-bearing — it is dereferenced into the stored value).
package worker

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/media"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/service/grading"
	"github.com/ducdo/classlite-api/internal/store/generated"
)

// defaultMaxInlineAudioBytes is the defensive ceiling on the BASE64 WIRE payload handed
// to Gemini inline. Gemini's ~20 MB inline cap applies to the encoded request body, not
// the raw bytes (base64 inflates ×1.33), so the worker guards base64.EncodedLen(ogg),
// not len(ogg) (code review). The 6-3b0 voice-Opus re-encode keeps a real recording far
// under this. An over-cap output is terminal audio_unavailable (a retry cannot shrink
// it). Kept a field on the handler so a determinism test can inject a small threshold
// rather than a real 18 MB slice.
const defaultMaxInlineAudioBytes = 20 * 1024 * 1024

// audioDownloadTimeout bounds the SEC-8 owned-audio download (code review). The
// transcoder self-bounds at 30s and the Gemini client at 120s, but the download rode
// the long-lived worker ctx — a hung/slow R2 read could pin a worker slot until the
// transport default or shutdown, and three concurrent hangs starve the 3-slot pool. A
// download that exceeds this surfaces as a transient error → reschedule (a slow R2 blip
// may clear on the next attempt).
const audioDownloadTimeout = 60 * time.Second

// TransientReasonError carries a DISTINCT terminal error_details label to use IF a
// transient job exhausts its retries (Story 6.3b, D17). It wraps ErrTransientGeneration
// so the dispatcher's TYPE-BASED classifier still reschedules it on attempts 1..N; only
// at exhaustion does terminalFail read Reason (so a transcode-infra ladder lands on
// audio_unavailable, not the generic max_retries_exhausted). Classification never
// inspects the message text (a transient whose text contains "invalid" still retries).
type TransientReasonError struct {
	Reason string
	err    error
}

// Error renders "<reason>: <wrapped>".
func (e *TransientReasonError) Error() string { return e.Reason + ": " + e.err.Error() }

// Unwrap exposes the wrapped chain so errors.Is(err, ErrTransientGeneration) — and the
// media cause carried alongside it — both hold.
func (e *TransientReasonError) Unwrap() error { return e.err }

// GradeSpeakingHandler runs AI over a Speaking submission and produces a suggestion.
// storage + transcoder are CONSTRUCTOR fields (not on the generic generate() signature)
// so the dispatcher/4.3a spine stays storage- and media-agnostic (D6/D17).
type GradeSpeakingHandler struct {
	db                  generated.DBTX
	gem                 gemini.Client
	clk                 clock.Clock
	storage             service.StorageService
	transcoder          media.AudioTranscoder
	maxInlineAudioBytes int
}

// NewGradeSpeakingHandler builds the handler bound to db (the harness/per-job tx), the
// injected Gemini client, the deterministic clock (latencyMs is measured off clk), the
// StorageService (SEC-8 audio download) and the media.AudioTranscoder (6-3b0).
func NewGradeSpeakingHandler(
	db generated.DBTX, gem gemini.Client, clk clock.Clock,
	storage service.StorageService, transcoder media.AudioTranscoder,
) *GradeSpeakingHandler {
	return &GradeSpeakingHandler{db: db, gem: gem, clk: clk, storage: storage, transcoder: transcoder}
}

// JobType reports the AI speaking-grade job type.
func (h *GradeSpeakingHandler) JobType() model.JobType { return model.JobTypeAIGradeSpeaking }

// ProcessTask satisfies the tenant-isolation harness — it runs the same logic against
// the handler's bound DB and discards the captured result fragment.
func (h *GradeSpeakingHandler) ProcessTask(ctx context.Context, tc model.TenantContext, payload json.RawMessage) error {
	_, err := h.generate(ctx, h.db, h.gem, tc, payload)
	return err
}

func (h *GradeSpeakingHandler) generate(
	ctx context.Context, db generated.DBTX, gem gemini.Client, tc model.TenantContext, payload json.RawMessage,
) (json.RawMessage, error) {
	var params model.AIGradeSpeakingParams
	if err := json.Unmarshal(payload, &params); err != nil {
		return nil, fmt.Errorf("%w: unmarshal ai_grade_speaking params", ErrInvalidAIResponse)
	}
	logProcessing(tc, model.JobTypeAIGradeSpeaking)

	// RLS gate: read the submission BEFORE any audio download / transcode / Gemini
	// call. A cross-tenant / missing / null-tenant read returns 0 rows → NotFoundError,
	// so nothing downstream ever touches an audio object the job's tenant cannot see
	// (R3/A7 — the load-bearing tripwire, now over a third read surface).
	sub, err := h.readSubmissionForTenant(ctx, db, params.SubmissionID)
	if err != nil {
		return nil, err
	}

	// Audio download (SEC-8 — the shared owned-key prefix guard). Error classification
	// is the download twin of the transcode 3-class contract (D17-symmetric, code
	// review): a genuinely-missing / over-cap object → terminal audio_unavailable
	// (a retry cannot help); a foreign-prefix key trips the guard → terminal +
	// a DISTINCT discrepancy log (D14 — an attack signal); a transient transport error
	// (network / 5xx / timeout) → reschedule, audio_unavailable at exhaustion.
	audioKey := grading.SpeakingAudioKeyFromContent(sub.Content)
	if audioKey == "" {
		// A keyless/legacy submission that slipped past the enqueue guard: a benign
		// data gap, NOT a poisoned cross-tenant key. Terminal audio_unavailable (no
		// recording to grade), logged as a data gap — never the D14 discrepancy signal
		// (which must stay a real cross-tenant attack alert).
		slog.InfoContext(ctx, "ai_grade_speaking_missing_audio_key", "center_id", tc.CenterID)
		return nil, terminalReason(model.JobErrorAudioUnavailable, ErrInvalidAIResponse)
	}
	audioBytes, err := h.downloadAudio(ctx, audioKey, tc)
	if err != nil {
		return nil, classifyDownloadError(ctx, err, tc, audioKey)
	}

	// Transcode webm/mp4 → ogg (6-3b0) BEFORE Gemini. The transcoder applies its own
	// 30s deadline internally; the dispatcher imposes NO shorter per-attempt budget on
	// ctx, so a genuine timeout surfaces as media.ErrTranscodeFailed (terminal), not a
	// retryable parent-ctx cancel — the D17 timeout-ordering invariant holds by
	// construction (transcode deadline < unbounded job-attempt budget).
	oggBytes, _, err := h.transcoder.Transcode(ctx, audioBytes, speakingSrcMIME(audioKey))
	if err != nil {
		return nil, classifyTranscodeError(err)
	}
	if len(oggBytes) == 0 {
		// Defensive: a nil-error transcode yielding zero bytes would marshal an EMPTY
		// inlineData part → Gemini 400 → wasted retries. A retry cannot fill it →
		// terminal audio_unavailable (never Gemini).
		slog.WarnContext(ctx, "ai_grade_speaking_transcoded_empty", "center_id", tc.CenterID)
		return nil, terminalReason(model.JobErrorAudioUnavailable, ErrInvalidAIResponse)
	}
	if wireBytes := base64.StdEncoding.EncodedLen(len(oggBytes)); wireBytes > h.inlineAudioCap() {
		// Guard the BASE64 WIRE size (~1.33× raw), not the raw length — Gemini's inline
		// cap applies to the encoded request body. An over-cap output cannot ride
		// inline; a retry cannot shrink it → terminal audio_unavailable (never Gemini).
		slog.WarnContext(ctx, "ai_grade_speaking_transcoded_over_inline_cap",
			"center_id", tc.CenterID, "wire_bytes", wireBytes, "cap", h.inlineAudioCap())
		return nil, terminalReason(model.JobErrorAudioUnavailable, ErrInvalidAIResponse)
	}

	start := h.clk.Now()
	raw, err := gem.Generate(ctx, gemini.GenerateRequest{
		Mode:          "speaking_grade",
		Prompt:        buildSpeakingGradePrompt(),
		AudioData:     oggBytes,
		AudioMimeType: media.OutputMIME, // the 6-3b0 output-MIME constant, never a literal (D17)
	})
	if err != nil {
		return nil, fmt.Errorf("%w: gemini", ErrTransientGeneration)
	}
	latencyMs := h.clk.Now().Sub(start).Milliseconds()

	var resp model.AISpeakingGradeResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, fmt.Errorf("%w: parse speaking grade response", ErrInvalidAIResponse)
	}

	durationMs := grading.SpeakingDurationMsFromContent(sub.Content)
	result, err := buildSpeakingGradeResult(ctx, resp, durationMs, latencyMs)
	if err != nil {
		return nil, err
	}
	return json.Marshal(result)
}

// readSubmissionForTenant reads the submission RLS-scoped on the caller's tx. 0 rows
// (cross-tenant / missing / null tenant) → NotFoundError (terminal; nothing downstream).
func (h *GradeSpeakingHandler) readSubmissionForTenant(ctx context.Context, db generated.DBTX, submissionID string) (generated.Submission, error) {
	id, err := uuid.Parse(submissionID)
	if err != nil {
		return generated.Submission{}, submissionNotFound(submissionID)
	}
	sub, err := generated.New(db).GetSubmissionByID(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return generated.Submission{}, submissionNotFound(submissionID)
		}
		return generated.Submission{}, fmt.Errorf("read submission for ai speaking grade: %w", err)
	}
	return sub, nil
}

// downloadAudio fetches the owned recording under a bounded deadline (code review — a
// hung R2 read must not pin a worker slot). The SEC-8 prefix guard fires inside
// GetObjectOwned before any bytes are read; the deadline is cancelled promptly on
// return so it never outlives the download.
func (h *GradeSpeakingHandler) downloadAudio(ctx context.Context, audioKey string, tc model.TenantContext) ([]byte, error) {
	downloadCtx, cancel := context.WithTimeout(ctx, audioDownloadTimeout)
	defer cancel()
	return h.storage.GetObjectOwned(downloadCtx, audioKey, tc)
}

// classifyDownloadError maps a GetObjectOwned error onto the dispatcher's terminal-vs-
// retry vocabulary — the download twin of classifyTranscodeError (code review, Decision
// 2). errors.As on the typed storage errors, NEVER strings.Contains:
//   - KeyPrefixMismatchError → terminal audio_unavailable + a DISTINCT discrepancy log
//     (D14 — a real cross-tenant attack signal; the empty-key case is guarded upstream
//     so this only fires for a genuinely foreign prefix).
//   - ObjectNotFoundError / ObjectTooLargeError → terminal audio_unavailable (a retry
//     cannot conjure or shrink the object).
//   - anything else (transient transport: network / 5xx / timeout / parent cancel) →
//     TRANSIENT (reschedule → refund at exhaustion, audio_unavailable label via
//     TransientReasonError — the anti-hostage guarantee, symmetric with D17 transcode).
func classifyDownloadError(ctx context.Context, err error, tc model.TenantContext, audioKey string) error {
	var prefixMismatch service.KeyPrefixMismatchError
	var notFound service.ObjectNotFoundError
	var tooLarge service.ObjectTooLargeError
	switch {
	case errors.As(err, &prefixMismatch):
		slog.WarnContext(ctx, "ai_grade_speaking_audio_key_discrepancy",
			"center_id", tc.CenterID, "audio_key", audioKey, "reason", "prefix_mismatch")
		return terminalReason(model.JobErrorAudioUnavailable, ErrInvalidAIResponse)
	case errors.As(err, &notFound), errors.As(err, &tooLarge):
		return terminalReason(model.JobErrorAudioUnavailable, ErrInvalidAIResponse)
	default:
		return &TransientReasonError{
			Reason: model.JobErrorAudioUnavailable,
			err:    fmt.Errorf("%w: audio download: %w", ErrTransientGeneration, err),
		}
	}
}

// inlineAudioCap returns the effective transcoded-bytes ceiling (the injectable field,
// or the default).
func (h *GradeSpeakingHandler) inlineAudioCap() int {
	if h.maxInlineAudioBytes > 0 {
		return h.maxInlineAudioBytes
	}
	return defaultMaxInlineAudioBytes
}

// classifyTranscodeError translates the 6-3b0 THREE-class errors.Is contract onto the
// dispatcher's terminal-vs-retry vocabulary at the WORKER boundary (D17). Classification
// is errors.Is on the 6-3b0 sentinels, NEVER strings.Contains:
//   - ErrTranscodeFailed / ErrUnsupportedAudio → terminal audio_unavailable (refund).
//   - ErrTranscodeUnavailable → TRANSIENT (reschedule ×3 → refund at exhaustion, with
//     the audio_unavailable label via TransientReasonError — the anti-hostage guarantee).
//   - anything else (a future un-Is-able 6-3b0 error) → TRANSIENT (fail-safe default:
//     a wrong-terminal burns the credit immediately, a retry eventually refunds anyway).
func classifyTranscodeError(err error) error {
	switch {
	case errors.Is(err, media.ErrTranscodeUnavailable):
		return &TransientReasonError{
			Reason: model.JobErrorAudioUnavailable,
			err:    fmt.Errorf("%w: transcode unavailable: %w", ErrTransientGeneration, err),
		}
	case errors.Is(err, media.ErrTranscodeFailed), errors.Is(err, media.ErrUnsupportedAudio):
		return terminalReason(model.JobErrorAudioUnavailable, ErrInvalidAIResponse)
	default:
		return fmt.Errorf("%w: transcode: %w", ErrTransientGeneration, err)
	}
}

// speakingSrcMIME derives the source MIME the transcoder validates against, from the
// audioKey's extension (the recorder produces webm on Chrome/Android, mp4 on iOS). The
// transcoder normalizes to voice-Opus regardless; an unknown extension defaults to webm
// (the dominant recorder format) and the transcoder's own allow-list is the backstop.
func speakingSrcMIME(key string) string {
	switch {
	case strings.HasSuffix(key, ".mp4"), strings.HasSuffix(key, ".m4a"):
		return "audio/mp4"
	case strings.HasSuffix(key, ".ogg"):
		return "audio/ogg"
	case strings.HasSuffix(key, ".wav"):
		return "audio/wav"
	case strings.HasSuffix(key, ".mp3"):
		return "audio/mpeg"
	default:
		return "audio/webm"
	}
}

// buildSpeakingGradeResult validates, completeness-checks, and normalizes the Gemini
// response into a stored AISpeakingGradeResult. Order is FIXED (the AC prose supersedes
// any "return before normalize" reading, AC5) — the comment matches the code (code
// review P6):
//
//	(1) criterion completeness — every criterion band + confidence non-null+valid →
//	    else terminal invalid_ai_response;
//	(2) band range/grid — out-of-range/off-grid → terminal invalid_band_scores (BEFORE
//	    the partial-success return, so bad-bands + null-transcript is terminal, never
//	    laundered into a no-refund partial — T-C);
//	(3) moment DROP-then-validate (D11) — DROP a structurally-bad moment (bad type/
//	    criterion/blank text) FIRST so a junk moment never sinks a full-value grade,
//	    THEN a surviving moment's missing/invalid confidence is terminal
//	    invalid_ai_response; demote an out-of-bound timestamp to null (never drop);
//	(4) transcript → transcriptionStatus (absent/empty → unavailable = partial_success);
//	(5) assemble + return (result, nil).
func buildSpeakingGradeResult(ctx context.Context, resp model.AISpeakingGradeResponse, durationMs int, latencyMs int64) (model.AISpeakingGradeResult, error) {
	// (1) Criterion completeness: every criterion must carry a non-null band + a valid
	// confidence (a missing key unmarshals to a nil Band/Confidence — invalid_ai_response).
	criteria := []struct {
		key string
		cr  model.AISpeakingCriterionResponse
	}{
		{grading.CriterionFluencyCoherence, resp.Criteria.FluencyCoherence},
		{grading.CriterionLexicalResource, resp.Criteria.LexicalResource},
		{grading.CriterionGrammaticalRange, resp.Criteria.GrammaticalRange},
		{grading.CriterionPronunciation, resp.Criteria.Pronunciation},
	}
	for _, c := range criteria {
		if c.cr.Band == nil || c.cr.Confidence == nil || !validAIConfidence(*c.cr.Confidence) {
			return model.AISpeakingGradeResult{}, fmt.Errorf("%w: criterion %s incomplete", ErrInvalidAIResponse, c.key)
		}
	}

	// (2) Band range/grid — reuse 6.3a's validator (D5). Out of range / off-grid →
	// terminal, distinct error_details label invalid_band_scores (D4). This runs BEFORE
	// the partial-success return so a null/invalid-bands + null-transcript result is
	// terminal+refund, never laundered into a no-refund partial_success (T-C).
	scores := grading.SpeakingCriterionScores{
		FluencyCoherence: *resp.Criteria.FluencyCoherence.Band,
		LexicalResource:  *resp.Criteria.LexicalResource.Band,
		GrammaticalRange: *resp.Criteria.GrammaticalRange.Band,
		Pronunciation:    *resp.Criteria.Pronunciation.Band,
	}
	if err := grading.ValidateSpeakingCriterionScores(scores); err != nil {
		return model.AISpeakingGradeResult{}, terminalReason(model.JobErrorInvalidBandScores, ErrInvalidAIResponse)
	}

	// (3) Moment DROP-then-validate (D11 + code review): DROP a structurally-invalid
	// moment (bad type/criterion/blank text) FIRST, then check confidence only on the
	// SURVIVORS. This is the load-bearing fix for the D11 overlap: a junk moment that
	// ALSO lacks confidence must not sink a full-value four-band grade — it is dropped,
	// the grade ships, the credit is charged. Confidence is only dereferenced into the
	// stored value for a KEPT moment, so a missing/invalid confidence there is still
	// terminal invalid_ai_response (that moment is real and its confidence is used).
	// Out-of-bound timestamps demote to null (never drop); confidence travels WITH each
	// kept moment (a drop changes length — no positional re-zip).
	moments := make([]model.AISpeakingGradeComment, 0, len(resp.Moments))
	dropped := 0
	for i := range resp.Moments {
		m := resp.Moments[i]
		if !grading.ValidSpeakingMoment(m.Type, m.Criterion, m.Text) {
			dropped++
			continue
		}
		if m.Confidence == nil || !validAIConfidence(*m.Confidence) {
			return model.AISpeakingGradeResult{}, fmt.Errorf("%w: moment %d confidence invalid", ErrInvalidAIResponse, i)
		}
		moments = append(moments, model.AISpeakingGradeComment{
			Type:        m.Type,
			Criterion:   m.Criterion,
			TimestampMs: grading.BoundSpeakingTimestampMs(roundMomentTimestampMs(m.TimestampMs), durationMs),
			Text:        m.Text,
			Confidence:  *m.Confidence,
		})
	}
	if dropped > 0 {
		// Observability only — the COUNT, never the moment text (EDGE-4).
		slog.WarnContext(ctx, "ai_grade_speaking_dropped_malformed_moments", "dropped", dropped)
	}

	// (4) Transcript → transcriptionStatus. Present + non-empty → available; absent/
	// empty → unavailable (partial_success — a nil-error COMPLETE that keeps its charge,
	// D3/D15). The counter makes the ratified no-refund decision revisitable with data.
	transcriptionStatus := model.TranscriptionStatusAvailable
	if resp.Transcript == nil || strings.TrimSpace(*resp.Transcript) == "" {
		transcriptionStatus = model.TranscriptionStatusUnavailable
		resp.Transcript = nil
		slog.InfoContext(ctx, "ai_grade_speaking_partial_success", "transcription_status", transcriptionStatus)
	}

	return model.AISpeakingGradeResult{
		Criteria: model.AISpeakingGradeCriteria{
			FluencyCoherence: aiSpeakingCriterion(resp.Criteria.FluencyCoherence),
			LexicalResource:  aiSpeakingCriterion(resp.Criteria.LexicalResource),
			GrammaticalRange: aiSpeakingCriterion(resp.Criteria.GrammaticalRange),
			Pronunciation:    aiSpeakingCriterion(resp.Criteria.Pronunciation),
		},
		Moments:             moments,
		Transcript:          resp.Transcript,
		TranscriptionStatus: transcriptionStatus,
		OverallFeedback:     resp.OverallFeedback,
		AnalyzedDurationMs:  durationMs,
		LatencyMs:           latencyMs,
	}, nil
}

// aiSpeakingCriterion collapses a validated response criterion to its stored value
// shape. Precondition: cr passed the completeness check (Band + Confidence non-nil).
func aiSpeakingCriterion(cr model.AISpeakingCriterionResponse) model.AISpeakingGradeCriterion {
	return model.AISpeakingGradeCriterion{Band: *cr.Band, Rationale: cr.Rationale, Confidence: *cr.Confidence}
}

// roundMomentTimestampMs rounds the tolerant *float64 parse to the stored integer pin
// (code review P1). Gemini may emit a whole millisecond as 5000.0 or 5e3, which a *int
// field would reject and fail the entire response parse; parsing as *float64 and
// rounding here preserves the four-band grade. nil stays nil (a general/unpinned moment).
func roundMomentTimestampMs(ms *float64) *int {
	if ms == nil {
		return nil
	}
	rounded := int(math.Round(*ms))
	return &rounded
}

// buildSpeakingGradePrompt embeds the IELTS Speaking rubric into a single instruction.
// The audio rides as a separate inlineData part (the client attaches it), so the prompt
// asks the model to transcribe AND grade, emitting the exact AISpeakingGradeResponse
// shape the worker unmarshals. There is no student text — the recording IS the input.
func buildSpeakingGradePrompt() string {
	var b strings.Builder
	b.WriteString("You are an experienced IELTS Speaking examiner. The attached audio is a student's spoken response. ")
	b.WriteString("First transcribe it, then grade it against the four IELTS Speaking criteria: ")
	b.WriteString("fluencyCoherence, lexicalResource, grammaticalRange, pronunciation. ")
	b.WriteString("For each criterion return a band from 1.0 to 9.0 on a 0.5 grid, a short rationale, and a confidence of \"high\" or \"medium\". ")
	b.WriteString("Also return timestamped moments — each with a type (error|praise|suggestion), a criterion, a timestampMs into the recording (or null for a general note), the moment text, and a confidence. ")
	b.WriteString("Return the full transcript (or null if you could not transcribe the audio), and optionally overallFeedback (or null). ")
	b.WriteString("Respond ONLY with JSON matching: {\"criteria\":{\"fluencyCoherence\":{\"band\":number,\"rationale\":string,\"confidence\":string}, ...for all four}, \"moments\":[{\"type\":string,\"criterion\":string,\"timestampMs\":number|null,\"text\":string,\"confidence\":string}], \"transcript\":string|null, \"overallFeedback\":string|null}.")
	return b.String()
}

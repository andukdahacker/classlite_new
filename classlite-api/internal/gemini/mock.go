// Story 4.3a — the deterministic Gemini mock. It is the ONLY Gemini
// implementation exercised in PR tests (a real call is banned from CI). Each
// mode returns canned JSON that either maps to a structurally-valid
// ExerciseContent fragment (the MockValid* modes) or drives a specific failure
// path (MockTransientError → provider error → retry; MockMalformed → unparseable
// bytes → terminal invalid_ai_response).
//
// The APIKey / PromptMarker / ResponseMarker fields let the R49 secret-in-logs
// test inject sensitive values into the pipeline and prove they never surface in
// a log line. The mock itself never logs any of them.
package gemini

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
)

// MockMode selects the mock's canned behavior.
type MockMode string

const (
	// MockValidSection returns a valid section-generation response.
	MockValidSection MockMode = "valid_section"
	// MockValidQuestions returns a valid questions-generation response.
	MockValidQuestions MockMode = "valid_questions"
	// MockValidDistractors returns a valid distractors-generation response.
	MockValidDistractors MockMode = "valid_distractors"
	// MockTransientError returns a non-nil error — a transient provider failure
	// the worker retries with backoff (AC5).
	MockTransientError MockMode = "transient_error"
	// MockMalformed returns unparseable bytes — a terminal invalid_ai_response
	// the worker does NOT retry (AC6).
	MockMalformed MockMode = "malformed"

	// --- Story 6.2a — AI Writing-grade modes ---

	// MockValidWritingGrade returns a well-formed AIWritingGradeResponse: four
	// in-range criteria + three comments — one valid-anchored, one ORPHAN at
	// len(WritingGradeFixtureEssay)+5 (out of range), and one straddling the fox
	// emoji's surrogate pair. The latter two MUST demote to whole-essay so the S1/S15
	// demotion assertions are not vacuously green (D5/D10).
	MockValidWritingGrade MockMode = "valid_writing_grade"
	// MockInvalidBandScores returns a criterion band of 9.5 (off the 0.5 grid AND
	// out of the 1.0–9.0 range) → terminal invalid_band_scores (AC5).
	MockInvalidBandScores MockMode = "invalid_band_scores"
	// MockIncompleteWritingGrade returns a parseable result MISSING the
	// grammaticalRange criterion key → terminal invalid_ai_response (the D10
	// completeness rule: complete ⇒ gradeable).
	MockIncompleteWritingGrade MockMode = "incomplete_writing_grade"
	// MockTransientErrorContainingInvalid returns a TRANSIENT provider error whose
	// message contains the substring "invalid" — it MUST still reschedule (not go
	// terminal), proving the dispatcher classifies by errors.Is on the sentinel, NOT
	// strings.Contains on the message (D8).
	MockTransientErrorContainingInvalid MockMode = "transient_error_containing_invalid"

	// --- Story 6.3b — AI Speaking-grade modes ---

	// MockValidSpeakingGrade returns a well-formed AISpeakingGradeResponse: four valid
	// bands, a PRESENT transcript (→ transcriptionStatus available), and two moments —
	// one IN-bound (text "PINNED", keeps its pin) and one OUT-of-bound (text
	// "OUTOFBOUND", demoted to null but KEPT, D11). The demote assertion is coupled to
	// SpeakingGradeFixtureDurationSec so it is never vacuously green.
	MockValidSpeakingGrade MockMode = "valid_speaking_grade"
	// MockPartialSpeakingGrade returns four valid bands but a NULL transcript → a
	// nil-error COMPLETE carrying transcriptionStatus=unavailable (partial_success):
	// the credit is NOT refunded (D3/D15).
	MockPartialSpeakingGrade MockMode = "partial_speaking_grade"
	// MockInvalidSpeakingBandScores returns a criterion band of 9.5 (off the 0.5 grid
	// AND out of the 1.0–9.0 range) → terminal invalid_band_scores (AC5).
	MockInvalidSpeakingBandScores MockMode = "invalid_speaking_band_scores"
	// MockIncompleteBandsNoTranscript returns a result MISSING the pronunciation
	// criterion (a nil band) AND a null transcript — the T-C over-charge probe: it must
	// go terminal+refund (bands checked BEFORE the partial return), never be laundered
	// into a no-refund partial_success (D3).
	MockIncompleteBandsNoTranscript MockMode = "incomplete_bands_no_transcript"
	// MockSpeakingNullMomentConfidence returns four valid bands + a transcript but a
	// moment whose confidence is null → terminal invalid_ai_response (the completeness
	// pre-check that guards the positional-zip nil-deref, D5/D11) — DISTINCT from a
	// structurally-bad moment (which is dropped).
	MockSpeakingNullMomentConfidence MockMode = "speaking_null_moment_confidence"
	// MockSpeakingMalformedMoment returns four valid bands + a transcript + one
	// structurally-bad moment (bad type/criterion/blank text, marked "BADMOMENT")
	// alongside one good moment → complete + charged, the bad moment DROPPED (D11).
	MockSpeakingMalformedMoment MockMode = "speaking_malformed_moment"
)

// SpeakingGradeFixtureDurationSec is the recording duration (seconds) seeded by
// test.SeedSpeakingSubmissionForTenant and analysed by the speaking mock modes. The
// mock's OUT-of-bound moment timestamp is expressed relative to it (past the lenient
// max(duration,60min)+1s demote bound), so the demote-not-drop assertion in the worker
// tests is coupled to a KNOWN duration and cannot go vacuously green.
const SpeakingGradeFixtureDurationSec = 278

// speakingOutOfBoundMomentMs is a pin far past the lenient NormalizeTimestampComments
// bound (max(durationMs, 60min)+1s) — guaranteed to demote for any real duration.
const speakingOutOfBoundMomentMs = 9_999_999

// WritingGradeFixtureEssay is the exact essay text seeded by
// test.SeedWritingSubmissionForTenant and analysed by MockValidWritingGrade. The
// mock's comment offsets are expressed relative to it (an orphan at
// len(WritingGradeFixtureEssay)+5; a comment straddling the 🦊 surrogate pair at
// UTF-16 index writingGradeEmojiSplitIndex), so the demotion assertions in the
// worker tests are coupled to a KNOWN essay and cannot go vacuously green. The fox
// emoji (U+1F98A) is a surrogate pair in UTF-16, occupying code units 20 (high) and
// 21 (low); a boundary at index 21 splits it.
const WritingGradeFixtureEssay = "The quick brown fox 🦊 jumps over the lazy dog."

// writingGradeEmojiSplitIndex is the UTF-16 code-unit boundary that falls between
// the two halves of 🦊 in WritingGradeFixtureEssay — an anchor here splits a
// surrogate pair and must be demoted to whole-essay (D5/D10).
const writingGradeEmojiSplitIndex = 21

// MockConfig configures a MockClient.
type MockConfig struct {
	Mode MockMode
	// APIKey is held (never logged) so the R49 test can prove the secret does
	// not leak — the mock never emits it.
	APIKey string
	// PromptMarker, if set, is a sentinel the R49 test threads through the prompt
	// (via the job Topic); the assertion is that it never reaches a log line.
	PromptMarker string
	// ResponseMarker, if set, is embedded in the returned response body so the
	// R49 test can prove the raw response is never logged.
	ResponseMarker string
}

// MockClient is a deterministic gemini.Client for tests.
type MockClient struct {
	cfg   MockConfig
	mu    sync.Mutex
	calls int
}

// NewMockClient builds a MockClient for the given config.
func NewMockClient(cfg MockConfig) *MockClient {
	return &MockClient{cfg: cfg}
}

// CallCount returns how many times Generate has been invoked. Used by the
// adversarial tests to assert Gemini is NOT called on a tenant-scope miss and is
// called exactly once on the happy path.
func (m *MockClient) CallCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls
}

// Generate returns canned output for the configured mode. It records the call
// even on the error/malformed paths (the happy-vs-miss assertions count every
// reached invocation).
func (m *MockClient) Generate(_ context.Context, _ GenerateRequest) (json.RawMessage, error) {
	m.mu.Lock()
	m.calls++
	m.mu.Unlock()

	switch m.cfg.Mode {
	case MockTransientError:
		return nil, fmt.Errorf("gemini: simulated transient failure")
	case MockTransientErrorContainingInvalid:
		// Transient — but the message CONTAINS "invalid". A strings.Contains
		// classifier would wrongly go terminal; a type-based one reschedules (D8).
		return nil, fmt.Errorf("gemini: connection invalid, retrying")
	case MockMalformed:
		return json.RawMessage(`{ this is : not valid json`), nil
	case MockValidQuestions:
		return m.validQuestions(), nil
	case MockValidDistractors:
		return m.validDistractors(), nil
	case MockValidWritingGrade:
		return m.validWritingGrade(), nil
	case MockInvalidBandScores:
		return m.invalidBandScores(), nil
	case MockIncompleteWritingGrade:
		return m.incompleteWritingGrade(), nil
	case MockValidSpeakingGrade:
		return m.validSpeakingGrade(), nil
	case MockPartialSpeakingGrade:
		return m.partialSpeakingGrade(), nil
	case MockInvalidSpeakingBandScores:
		return m.invalidSpeakingBandScores(), nil
	case MockIncompleteBandsNoTranscript:
		return m.incompleteBandsNoTranscript(), nil
	case MockSpeakingNullMomentConfidence:
		return m.speakingNullMomentConfidence(), nil
	case MockSpeakingMalformedMoment:
		return m.speakingMalformedMoment(), nil
	case MockValidSection:
		fallthrough
	default:
		return m.validSection(), nil
	}
}

func (m *MockClient) validSection() json.RawMessage {
	passage := "The generated passage text for the requested topic."
	if m.cfg.ResponseMarker != "" {
		passage = passage + " " + m.cfg.ResponseMarker
	}
	body := map[string]any{
		"schemaVersion": 1,
		"sectionType":   "reading",
		"title":         "Generated Reading",
		"passage":       passage,
		"questionGroups": []any{
			map[string]any{
				"type":         "multiple_choice",
				"instructions": "Choose the best answer.",
				"questions": []any{
					map[string]any{
						"text":          "What is the passage mainly about?",
						"type":          "multiple_choice",
						"options":       []string{"The topic", "A distractor", "Another distractor"},
						"correctAnswer": "The topic",
					},
				},
			},
		},
	}
	raw, _ := json.Marshal(body)
	return raw
}

func (m *MockClient) validQuestions() json.RawMessage {
	body := map[string]any{
		"schemaVersion": 1,
		"questionGroups": []any{
			map[string]any{
				"type":         "short_answer",
				"instructions": "Answer in a few words.",
				"questions": []any{
					map[string]any{
						"text":             "Give one detail from the passage.",
						"type":             "short_answer",
						"correctAnswer":    "a detail",
						"acceptedVariants": []string{"a detail", "one detail"},
					},
				},
			},
		},
	}
	raw, _ := json.Marshal(body)
	return raw
}

func (m *MockClient) validDistractors() json.RawMessage {
	body := map[string]any{
		"schemaVersion": 1,
		"correctAnswer": "The correct option",
		"options":       []string{"The correct option", "A plausible distractor", "Another distractor"},
	}
	raw, _ := json.Marshal(body)
	return raw
}

// validWritingGrade returns a well-formed 6.2a grade response over
// WritingGradeFixtureEssay: four in-range criteria + three comments whose offsets
// are pinned to the fixture essay so the demotion assertions are non-vacuous. The
// R49 markers, when set, ride inside the response so the secret-logging test proves
// the worker never logs the raw response.
func (m *MockClient) validWritingGrade() json.RawMessage {
	orphanStart := len(WritingGradeFixtureEssay) + 5 // guaranteed out of UTF-16 range → demote
	orphanEnd := orphanStart + 4
	emojiStart := writingGradeEmojiSplitIndex // splits the 🦊 surrogate pair → demote
	emojiEnd := emojiStart + 4

	rationale := "Addresses the task with a clear position."
	if m.cfg.ResponseMarker != "" {
		rationale = rationale + " " + m.cfg.ResponseMarker
	}
	overall := "A solid response overall."
	if m.cfg.PromptMarker != "" {
		overall = overall + " " + m.cfg.PromptMarker
	}

	body := map[string]any{
		"criteria": map[string]any{
			"taskResponse":      map[string]any{"band": 6.5, "rationale": rationale, "confidence": "high"},
			"coherenceCohesion": map[string]any{"band": 6.0, "rationale": "Ideas are logically ordered.", "confidence": "medium"},
			"lexicalResource":   map[string]any{"band": 7.0, "rationale": "Good range of vocabulary.", "confidence": "high"},
			"grammaticalRange":  map[string]any{"band": 6.0, "rationale": "Mostly accurate structures.", "confidence": "medium"},
		},
		"comments": []any{
			// Valid span anchor over "The" — SURVIVES normalization.
			map[string]any{"type": "praise", "criterion": "taskResponse", "anchorStart": 0, "anchorEnd": 3, "text": "Strong opening.", "confidence": "high"},
			// ORPHAN: out of range → demoted to whole-essay (null/null), never dropped.
			map[string]any{"type": "error", "criterion": "grammaticalRange", "anchorStart": orphanStart, "anchorEnd": orphanEnd, "text": "ORPHAN out-of-range note.", "confidence": "medium"},
			// EMOJI straddle: splits the surrogate pair → demoted to whole-essay.
			map[string]any{"type": "suggestion", "criterion": "lexicalResource", "anchorStart": emojiStart, "anchorEnd": emojiEnd, "text": "EMOJI straddle note.", "confidence": "medium"},
		},
		"overallFeedback": overall,
	}
	raw, _ := json.Marshal(body)
	return raw
}

// invalidBandScores returns a parseable response with an off-grid, out-of-range
// band (9.5) → terminal invalid_band_scores (AC5).
func (m *MockClient) invalidBandScores() json.RawMessage {
	body := map[string]any{
		"criteria": map[string]any{
			"taskResponse":      map[string]any{"band": 9.5, "rationale": "x", "confidence": "high"},
			"coherenceCohesion": map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
			"lexicalResource":   map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
			"grammaticalRange":  map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
		},
		"comments":        []any{},
		"overallFeedback": nil,
	}
	raw, _ := json.Marshal(body)
	return raw
}

// incompleteWritingGrade returns a parseable result MISSING the grammaticalRange
// criterion → terminal invalid_ai_response (D10 completeness). Its band is absent,
// so the worker's pointer-based completeness check trips before validation.
func (m *MockClient) incompleteWritingGrade() json.RawMessage {
	body := map[string]any{
		"criteria": map[string]any{
			"taskResponse":      map[string]any{"band": 6.5, "rationale": "x", "confidence": "high"},
			"coherenceCohesion": map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
			"lexicalResource":   map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
			// grammaticalRange deliberately omitted.
		},
		"comments":        []any{},
		"overallFeedback": nil,
	}
	raw, _ := json.Marshal(body)
	return raw
}

// --- Story 6.3b speaking-grade generators ---

// validSpeakingCriteriaBlob returns the four valid IELTS Speaking criteria. The
// fluencyCoherence rationale carries the R49 ResponseMarker (when set) so the
// secret-logging test can prove the raw response is never logged.
func (m *MockClient) validSpeakingCriteriaBlob() map[string]any {
	fcRationale := "Speaks at length with natural pace."
	if m.cfg.ResponseMarker != "" {
		fcRationale = fcRationale + " " + m.cfg.ResponseMarker
	}
	return map[string]any{
		"fluencyCoherence": map[string]any{"band": 6.5, "rationale": fcRationale, "confidence": "high"},
		"lexicalResource":  map[string]any{"band": 6.0, "rationale": "Adequate range of vocabulary.", "confidence": "medium"},
		"grammaticalRange": map[string]any{"band": 6.0, "rationale": "Mostly accurate structures.", "confidence": "medium"},
		"pronunciation":    map[string]any{"band": 6.5, "rationale": "Generally clear.", "confidence": "high"},
	}
}

// validSpeakingGrade returns a well-formed speaking grade over the fixture recording:
// four valid bands, a PRESENT transcript, and two moments (one in-bound "PINNED", one
// out-of-bound "OUTOFBOUND" for the demote-not-drop assertion). The R49 markers, when
// set, ride inside the transcript + overallFeedback so the secret-logging test proves
// they are never logged.
func (m *MockClient) validSpeakingGrade() json.RawMessage {
	transcript := "Well, my hometown is a small coastal city and I really enjoy living there."
	if m.cfg.ResponseMarker != "" {
		transcript = transcript + " " + m.cfg.ResponseMarker
	}
	overall := "A confident, fluent performance overall."
	if m.cfg.PromptMarker != "" {
		overall = overall + " " + m.cfg.PromptMarker
	}
	body := map[string]any{
		"criteria": m.validSpeakingCriteriaBlob(),
		"moments": []any{
			// IN-bound pin — SURVIVES with its timestamp.
			map[string]any{"type": "praise", "criterion": "fluencyCoherence", "timestampMs": 5000, "text": "PINNED strong, natural opening.", "confidence": "high"},
			// OUT-of-bound pin — DEMOTED to null (general), never dropped (D11).
			map[string]any{"type": "suggestion", "criterion": "pronunciation", "timestampMs": speakingOutOfBoundMomentMs, "text": "OUTOFBOUND general delivery note.", "confidence": "medium"},
		},
		"transcript":      transcript,
		"overallFeedback": overall,
	}
	raw, _ := json.Marshal(body)
	return raw
}

// partialSpeakingGrade returns four valid bands but a NULL transcript → a nil-error
// COMPLETE carrying transcriptionStatus=unavailable (partial_success, no refund).
func (m *MockClient) partialSpeakingGrade() json.RawMessage {
	body := map[string]any{
		"criteria":        m.validSpeakingCriteriaBlob(),
		"moments":         []any{},
		"transcript":      nil,
		"overallFeedback": nil,
	}
	raw, _ := json.Marshal(body)
	return raw
}

// invalidSpeakingBandScores returns a parseable response with an off-grid, out-of-range
// band (9.5) → terminal invalid_band_scores (AC5).
func (m *MockClient) invalidSpeakingBandScores() json.RawMessage {
	criteria := m.validSpeakingCriteriaBlob()
	criteria["fluencyCoherence"] = map[string]any{"band": 9.5, "rationale": "x", "confidence": "high"}
	body := map[string]any{
		"criteria":        criteria,
		"moments":         []any{},
		"transcript":      "a transcript",
		"overallFeedback": nil,
	}
	raw, _ := json.Marshal(body)
	return raw
}

// incompleteBandsNoTranscript returns a result MISSING the pronunciation criterion (a
// nil band → the completeness check trips) AND a null transcript. The T-C over-charge
// probe: bands are checked BEFORE the partial return, so this is terminal+refund, NOT a
// no-refund partial_success (D3).
func (m *MockClient) incompleteBandsNoTranscript() json.RawMessage {
	body := map[string]any{
		"criteria": map[string]any{
			"fluencyCoherence": map[string]any{"band": 6.5, "rationale": "x", "confidence": "high"},
			"lexicalResource":  map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
			"grammaticalRange": map[string]any{"band": 6.0, "rationale": "x", "confidence": "medium"},
			// pronunciation deliberately omitted → nil band → invalid_ai_response.
		},
		"moments":         []any{},
		"transcript":      nil,
		"overallFeedback": nil,
	}
	raw, _ := json.Marshal(body)
	return raw
}

// speakingNullMomentConfidence returns four valid bands + a transcript but a moment
// with a NULL confidence → terminal invalid_ai_response (the completeness pre-check
// guarding the positional-zip nil-deref, D5/D11).
func (m *MockClient) speakingNullMomentConfidence() json.RawMessage {
	body := map[string]any{
		"criteria": m.validSpeakingCriteriaBlob(),
		"moments": []any{
			map[string]any{"type": "error", "criterion": "lexicalResource", "timestampMs": 3000, "text": "a note", "confidence": nil},
		},
		"transcript":      "a transcript",
		"overallFeedback": nil,
	}
	raw, _ := json.Marshal(body)
	return raw
}

// speakingMalformedMoment returns four valid bands + a transcript + one structurally-
// bad moment (an invalid type, marked "BADMOMENT") alongside one good moment. The bad
// moment is DROPPED, the grade ships, the credit is charged (D11).
func (m *MockClient) speakingMalformedMoment() json.RawMessage {
	body := map[string]any{
		"criteria": m.validSpeakingCriteriaBlob(),
		"moments": []any{
			// Structurally-bad: an unknown type → DROPPED (never terminal, D11).
			map[string]any{"type": "not_a_real_type", "criterion": "fluencyCoherence", "timestampMs": 1000, "text": "BADMOMENT bad type.", "confidence": "high"},
			// Good moment → survives.
			map[string]any{"type": "praise", "criterion": "grammaticalRange", "timestampMs": 2000, "text": "Nice complex sentence.", "confidence": "high"},
		},
		"transcript":      "a transcript",
		"overallFeedback": nil,
	}
	raw, _ := json.Marshal(body)
	return raw
}

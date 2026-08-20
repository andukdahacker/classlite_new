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
)

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

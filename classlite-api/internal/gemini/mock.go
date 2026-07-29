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
)

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
	case MockMalformed:
		return json.RawMessage(`{ this is : not valid json`), nil
	case MockValidQuestions:
		return m.validQuestions(), nil
	case MockValidDistractors:
		return m.validDistractors(), nil
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

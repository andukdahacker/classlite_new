// Story 6.3b0 — the deterministic AudioTranscoder mock. It is the downstream
// test seam: 6-3b's ai_grade_speaking worker suite injects this double so a real
// ffmpeg is BANNED there (mirrors internal/gemini.MockClient — canned output per
// mode + a concurrency-safe CallCount spy). Bytes in are ignored; the configured
// mode decides the result.
package media

import (
	"context"
	"sync"
)

// MockTranscoder is a deterministic AudioTranscoder for tests. A success double
// returns canned ogg bytes + OutputMIME; a failing double returns a caller-chosen
// error; a SCRIPTED double returns a per-attempt error from `script` (Story 6.3b — the
// transcode-retry ladder). CallCount() records every Transcode invocation (even the
// error path).
type MockTranscoder struct {
	out    []byte
	err    error
	script []error // Story 6.3b: script[i] is the error on attempt i+1 (nil = success).

	mu    sync.Mutex
	calls int
}

// NewMockTranscoder builds a success double: Transcode returns (out, OutputMIME, nil).
func NewMockTranscoder(out []byte) *MockTranscoder {
	return &MockTranscoder{out: out}
}

// NewFailingMockTranscoder builds an error double: Transcode returns (nil, "", err).
// Pass ErrTranscodeFailed to exercise the worker's terminal audio_unavailable path.
func NewFailingMockTranscoder(err error) *MockTranscoder {
	return &MockTranscoder{err: err}
}

// NewScriptedMockTranscoder builds an ATTEMPT-AWARE double (Story 6.3b, D17 — TEST-ONLY,
// no 6-3b0 production re-open): the i-th Transcode call returns script[i-1] when it is
// non-nil, else the canned `out` success. A call past the end of the script succeeds.
// It lets the fail-then-succeed recovery test drive ErrTranscodeUnavailable on attempts
// 1–2 then success on attempt 3 without goroutines.
func NewScriptedMockTranscoder(out []byte, script []error) *MockTranscoder {
	return &MockTranscoder{out: out, script: script}
}

// Transcode implements AudioTranscoder. It ignores the input bytes and returns
// the configured canned success or error, recording the call for the spy.
func (m *MockTranscoder) Transcode(_ context.Context, _ []byte, _ string) ([]byte, string, error) {
	m.mu.Lock()
	attempt := m.calls // 0-indexed BEFORE increment
	m.calls++
	m.mu.Unlock()

	if m.script != nil {
		if attempt < len(m.script) && m.script[attempt] != nil {
			return nil, "", m.script[attempt]
		}
		return m.out, OutputMIME, nil
	}
	if m.err != nil {
		return nil, "", m.err
	}
	return m.out, OutputMIME, nil
}

// CallCount returns how many times Transcode has been invoked. Concurrency-safe
// so worker tests can assert the transcoder is (or is not) reached.
func (m *MockTranscoder) CallCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls
}

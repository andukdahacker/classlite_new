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
// error. CallCount() records every Transcode invocation (even the error path).
type MockTranscoder struct {
	out []byte
	err error

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

// Transcode implements AudioTranscoder. It ignores the input bytes and returns
// the configured canned success or error, recording the call for the spy.
func (m *MockTranscoder) Transcode(_ context.Context, _ []byte, _ string) ([]byte, string, error) {
	m.mu.Lock()
	m.calls++
	m.mu.Unlock()

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

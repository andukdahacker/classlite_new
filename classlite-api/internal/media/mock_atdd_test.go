// Story 6.3b0 — MockTranscoder contract (AC6 · D4). The downstream test seam:
// 6-3b's ai_grade_speaking worker suite injects this double so real ffmpeg is
// BANNED there (mirrors internal/gemini.MockClient exactly — per-mode canned
// output + a CallCount spy).
//
// GREEN (build tag removed on the 6.3b0 green phase — the seams below now exist).
//
// SEAMS (reconciled green):
//   - media.MockTranscoder struct implementing media.AudioTranscoder, with a
//     per-test-constructable mode. Mirror gemini.MockClient's shape:
//   - a success mode returning canned ogg bytes + outMIME == media.OutputMIME
//   - an error mode returning media.ErrTranscodeFailed
//   - CallCount() int  — concurrency-safe (sync.Mutex), counts Transcode calls
//   - constructors (match the gemini.NewMockClient(mode) ergonomics — pick ONE and
//     keep it; the tests below assume these two):
//     media.NewMockTranscoder(out []byte)        → success double (out, OutputMIME, nil)
//     media.NewFailingMockTranscoder(err error)  → error double (nil, "", err)
package media_test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/media"
)

// The mock MUST satisfy the same interface the worker depends on.
var _ media.AudioTranscoder = (*media.MockTranscoder)(nil)

func TestMockTranscoder_SuccessMode_ATDD(t *testing.T) {
	canned := []byte("OggS-canned-opus-bytes")
	m := media.NewMockTranscoder(canned)

	out, outMIME, err := m.Transcode(context.Background(), []byte("input"), "audio/webm")
	if err != nil {
		t.Fatalf("success mock must not error: %v", err)
	}
	if string(out) != string(canned) {
		t.Errorf("out = %q, want the canned bytes %q", out, canned)
	}
	if outMIME != media.OutputMIME {
		t.Errorf("outMIME = %q, want %q", outMIME, media.OutputMIME)
	}
	if m.CallCount() != 1 {
		t.Errorf("CallCount = %d, want 1 (spy)", m.CallCount())
	}
}

func TestMockTranscoder_ErrorMode_ATDD(t *testing.T) {
	m := media.NewFailingMockTranscoder(media.ErrTranscodeFailed)

	out, _, err := m.Transcode(context.Background(), []byte("input"), "audio/webm")
	if !isErr(err, media.ErrTranscodeFailed) {
		t.Fatalf("error mock must return ErrTranscodeFailed (errors.Is-able), got %v", err)
	}
	if out != nil {
		t.Errorf("error mock must return nil bytes, got %d bytes", len(out))
	}
	if m.CallCount() != 1 {
		t.Errorf("CallCount = %d, want 1 (spy counts even on the failure path)", m.CallCount())
	}
}

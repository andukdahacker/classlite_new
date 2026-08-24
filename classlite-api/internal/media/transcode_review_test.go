// Story 6.3b0 — regression coverage for the 2026-08-24 code-review patches
// (Amelia /bmad-code-review). These lock in behavior the ATDD contract did not
// pin: empty-input rejection (P6), the transient ErrTranscodeUnavailable class
// split from ErrTranscodeFailed (P8), and the boot check proving the libopus
// encoder — not merely that the binary runs (P1).
package media_test

import (
	"context"
	"os/exec"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/media"
)

// P6 — an empty payload is a caller/input problem rejected BEFORE any temp file
// is written, classified as ErrUnsupportedAudio (not a decode failure).
func TestFFmpegTranscoder_EmptyInputRejectedPreExec_Review(t *testing.T) {
	tempDir := t.TempDir()
	tr := media.NewFFmpegTranscoder(media.FFmpegConfig{
		FFmpegPath: testFFmpegPath(t),
		TempDir:    tempDir,
	})

	_, _, err := tr.Transcode(context.Background(), []byte{}, "audio/webm")
	if !isErr(err, media.ErrUnsupportedAudio) {
		t.Errorf("empty input must classify as ErrUnsupportedAudio (errors.Is-able), got %v", err)
	}
	// Pre-exec guard ⇒ nothing was ever written to disk.
	assertTempDirClean(t, tempDir)
}

// P8 — ffmpeg failing to start (a bad binary path) is INFRA, not bad input, so
// it maps to the transient ErrTranscodeUnavailable the caller retries — never
// ErrTranscodeFailed (which 6-3b would treat as terminal + refund).
func TestFFmpegTranscoder_StartFailureIsTransient_Review(t *testing.T) {
	tempDir := t.TempDir()
	tr := media.NewFFmpegTranscoder(media.FFmpegConfig{
		FFmpegPath: "/nonexistent/ffmpeg",
		TempDir:    tempDir,
	})

	_, _, err := tr.Transcode(context.Background(), []byte("valid-mime-nonempty-bytes"), "audio/webm")
	if !isErr(err, media.ErrTranscodeUnavailable) {
		t.Errorf("a ffmpeg start failure must classify as ErrTranscodeUnavailable (retryable), got %v", err)
	}
	if isErr(err, media.ErrTranscodeFailed) {
		t.Error("a transient start failure must NOT also be ErrTranscodeFailed — that would refund a retryable fault")
	}
	// Temp files are still scrubbed on the failure path (D2).
	assertTempDirClean(t, tempDir)
}

// P1 — the boot check must prove the libopus ENCODER exists, not just that a
// binary runs. A runnable binary that is not a libopus-capable ffmpeg (here,
// /bin/echo — exits zero, lists no encoders) must fail the check.
func TestCheckFFmpegAvailable_RejectsCodecLessBinary_Review(t *testing.T) {
	echo, err := exec.LookPath("echo")
	if err != nil {
		t.Skipf("no `echo` on PATH to stand in for a codec-less binary: %v", err)
	}
	err = media.CheckFFmpegAvailable(context.Background(), echo)
	if err == nil {
		t.Fatal("a runnable binary lacking the libopus encoder must fail the boot check (fail-fast, not a per-job failure)")
	}
	if !strings.Contains(err.Error(), "libopus") {
		t.Errorf("the error must name the missing encoder so ops can diagnose it, got %v", err)
	}
}

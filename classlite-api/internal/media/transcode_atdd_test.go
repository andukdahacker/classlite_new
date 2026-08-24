// Story 6.3b0 — Audio Transcode Service. ATDD contract for the
// FFmpegTranscoder + the startup availability check (AC1–AC5 · D1/D2/D5).
//
// GREEN (build tag removed on the 6.3b0 green phase — the seams below now exist).
//
// These are INTEGRATION tests against a real bundled ffmpeg. They require ffmpeg
// on PATH (or $CLASSLITE_FFMPEG_PATH). Absent ffmpeg → a LOUD skip (AC7: no silent
// green — CI MUST provide ffmpeg so these actually run).
//
// Fixtures are committed under internal/media/testdata/ (real 1s clips, already
// generated during ATDD authoring — no green-phase chore left):
//   - sample_speech.webm  → opus-in-webm, mono   (Chrome/Android MediaRecorder shape)
//   - sample_speech.m4a    → aac-in-mp4,  mono   (iOS Safari MediaRecorder shape)
//   - corrupt.webm         → 46 bytes of garbage (undecodable — AC4)
//
// SEAMS (dev, green phase — the ONE place to reconcile):
//   - package media  (leaf: NO service/worker/store/DB import — mirrors
//     internal/service/grading; sits at internal/media per story D4)
//   - media.AudioTranscoder interface:
//     Transcode(ctx context.Context, input []byte, srcMIME string) (out []byte, outMIME string, err error)
//   - media.FFmpegTranscoder struct + media.NewFFmpegTranscoder(FFmpegConfig) *FFmpegTranscoder
//   - media.FFmpegConfig struct {
//     FFmpegPath    string          // resolved bundled ffmpeg
//     Timeout       time.Duration   // 0 → media.TranscodeTimeout (D2 ctx-kill)
//     MaxInputBytes int             // 0 → media.MaxTranscodeInputBytes (D2 pre-exec guard)
//     TempDir       string          // "" → os.TempDir(); tests inject to assert scrub
//     Logger        *slog.Logger    // "" → slog.Default(); tests inject to prove EDGE-4
//     }
//   - sentinels (GO-2 typed, errors.Is-able so the 6-3b worker maps → terminal audio_unavailable):
//     media.ErrUnsupportedAudio  (unknown srcMIME OR input over the size cap — pre-exec)
//     media.ErrTranscodeFailed   (ffmpeg decode failure / non-zero exit / ctx timeout)
//   - named constants (CQ-3):
//     media.OutputMIME             = "audio/ogg"
//     media.OpusBitrate            (24000..32000 — voice)
//     media.AudioChannels          (= 1, mono)
//     media.MaxTranscodeInputBytes (= the 25 MB speaking upload cap)
//     media.TranscodeTimeout       (e.g. 30s)
//   - media.CheckFFmpegAvailable(ctx context.Context, ffmpegPath string) error  (AC5 startup fail-fast)
//
// The real ffmpeg invocation the impl must make (PROVEN against these fixtures
// during authoring — opus/mono out, corrupt exits non-zero):
//
//	exec.CommandContext(ctx, cfg.FFmpegPath, "-i", tmpIn, "-c:a", "libopus",
//	    "-b:a", strconv.Itoa(OpusBitrate), "-ac", "1", "-f", "ogg", tmpOut)
//
// ARG SLICE ONLY — never a shell string (D2, no injection surface).
package media_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/media"
)

// FFmpegTranscoder MUST satisfy the exported interface (compile-time proof).
var _ media.AudioTranscoder = (*media.FFmpegTranscoder)(nil)

// isErr wraps errors.Is so the intent (typed, errors.Is-able classification — GO-2)
// reads at each call site.
func isErr(err, target error) bool { return errors.Is(err, target) }

const (
	webmFixture    = "testdata/sample_speech.webm"
	m4aFixture     = "testdata/sample_speech.m4a"
	corruptFixture = "testdata/corrupt.webm"
)

// testFFmpegPath resolves the bundled/dev ffmpeg or LOUD-skips (AC7 — never a
// silent green). CI provides ffmpeg so this path is taken there.
func testFFmpegPath(t *testing.T) string {
	t.Helper()
	if p := os.Getenv("CLASSLITE_FFMPEG_PATH"); p != "" {
		return p
	}
	p, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skipf("LOUD SKIP (AC7): ffmpeg not on PATH and $CLASSLITE_FFMPEG_PATH unset — "+
			"the FFmpegTranscoder integration tests did NOT run; CI MUST provide ffmpeg: %v", err)
	}
	return p
}

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return b
}

// probeOgg shells ffprobe on the produced bytes and returns (codecName, channels).
// Proves format normalization structurally (AC2) — NOT a byte-exact golden.
func probeOgg(t *testing.T, ogg []byte) (codec, channels string) {
	t.Helper()
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skipf("LOUD SKIP (AC7): ffprobe absent — cannot verify opus/mono output: %v", err)
	}
	f := filepath.Join(t.TempDir(), "probe.ogg")
	if err := os.WriteFile(f, ogg, 0o600); err != nil {
		t.Fatalf("write probe file: %v", err)
	}
	out, err := exec.Command(ffprobe, "-v", "error", "-select_streams", "a:0",
		"-show_entries", "stream=codec_name,channels",
		"-of", "default=nk=1:nw=1", f).Output()
	if err != nil {
		t.Fatalf("ffprobe on transcoded output failed — not a valid audio stream: %v", err)
	}
	fields := strings.Fields(string(out))
	if len(fields) < 2 {
		t.Fatalf("ffprobe returned unexpected shape %q", string(out))
	}
	return fields[0], fields[1]
}

func assertTempDirClean(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read temp dir %s: %v", dir, err)
	}
	if len(entries) != 0 {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Errorf("temp-file scrub violated (D2): %d residual file(s) after Transcode: %v", len(entries), names)
	}
}

// -----------------------------------------------------------------------------
// AC1 + AC2 — format normalization: real webm(opus) AND m4a(aac) → valid opus/ogg mono.
// -----------------------------------------------------------------------------

func TestFFmpegTranscoder_NormalizesWebmAndM4a_ATDD(t *testing.T) {
	cases := []struct {
		name    string
		fixture string
		srcMIME string
	}{
		{"webm_opus (Chrome/Android)", webmFixture, "audio/webm"},
		{"m4a_aac (iOS Safari)", m4aFixture, "audio/mp4"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tempDir := t.TempDir()
			tr := media.NewFFmpegTranscoder(media.FFmpegConfig{
				FFmpegPath: testFFmpegPath(t),
				TempDir:    tempDir,
			})
			in := readFixture(t, tc.fixture)

			out, outMIME, err := tr.Transcode(context.Background(), in, tc.srcMIME)
			if err != nil {
				t.Fatalf("Transcode(%s) errored: %v", tc.name, err)
			}
			if outMIME != media.OutputMIME {
				t.Errorf("outMIME = %q, want %q", outMIME, media.OutputMIME)
			}
			if len(out) == 0 {
				t.Fatal("out is empty — expected a non-empty ogg payload (AC1)")
			}
			// Structural proof of normalization (AC2), not a byte golden.
			if codec, ch := probeOgg(t, out); codec != "opus" || ch != "1" {
				t.Errorf("output stream = %s/%sch, want opus/1ch (D1 voice mono Opus)", codec, ch)
			}
			// Voice re-encode must not INFLATE a speech clip (compression direction, AC2).
			if len(out) > len(in) {
				t.Errorf("voice-bitrate re-encode inflated the clip: in=%dB out=%dB (D1)", len(in), len(out))
			}
			assertTempDirClean(t, tempDir)
		})
	}
}

// -----------------------------------------------------------------------------
// AC3 — size guard fires BEFORE ffmpeg is invoked; nothing is written to temp.
// -----------------------------------------------------------------------------

func TestFFmpegTranscoder_OversizeRejectedPreExec_ATDD(t *testing.T) {
	tempDir := t.TempDir()
	tr := media.NewFFmpegTranscoder(media.FFmpegConfig{
		FFmpegPath:    testFFmpegPath(t),
		TempDir:       tempDir,
		MaxInputBytes: 10, // any real clip exceeds this
	})
	in := readFixture(t, webmFixture)

	_, _, err := tr.Transcode(context.Background(), in, "audio/webm")
	if err == nil {
		t.Fatal("expected a size error for oversize input, got nil")
	}
	if !isErr(err, media.ErrUnsupportedAudio) {
		t.Errorf("oversize must classify as ErrUnsupportedAudio (errors.Is-able), got %v", err)
	}
	// Pre-exec guard ⇒ no temp file was ever written.
	assertTempDirClean(t, tempDir)
}

// -----------------------------------------------------------------------------
// AC3 — ctx timeout KILLS ffmpeg (no zombie, no unbounded CPU) and scrubs temp.
// A 1ns timeout guarantees the deadline is blown at/near exec — deterministic.
// -----------------------------------------------------------------------------

func TestFFmpegTranscoder_TimeoutKillsAndScrubs_ATDD(t *testing.T) {
	tempDir := t.TempDir()
	tr := media.NewFFmpegTranscoder(media.FFmpegConfig{
		FFmpegPath: testFFmpegPath(t),
		TempDir:    tempDir,
		Timeout:    1 * time.Nanosecond,
	})
	in := readFixture(t, webmFixture)

	start := time.Now()
	_, _, err := tr.Transcode(context.Background(), in, "audio/webm")
	if err == nil {
		t.Fatal("expected a timeout error, got nil")
	}
	if !isErr(err, media.ErrTranscodeFailed) {
		t.Errorf("timeout must classify as ErrTranscodeFailed, got %v", err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("timeout did not kill promptly (%.1fs) — ctx not wired to CommandContext", elapsed.Seconds())
	}
	assertTempDirClean(t, tempDir)
}

// -----------------------------------------------------------------------------
// AC3 / EDGE-4 — the audio payload NEVER appears in logs.
// -----------------------------------------------------------------------------

func TestFFmpegTranscoder_NeverLogsAudioPayload_ATDD(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	tempDir := t.TempDir()
	tr := media.NewFFmpegTranscoder(media.FFmpegConfig{
		FFmpegPath: testFFmpegPath(t),
		TempDir:    tempDir,
		Logger:     logger,
	})
	in := readFixture(t, webmFixture)

	if _, _, err := tr.Transcode(context.Background(), in, "audio/webm"); err != nil {
		t.Fatalf("Transcode errored: %v", err)
	}
	// A recognizable slice of the raw input must never surface in a log line.
	needle := string(in[:32])
	if strings.Contains(buf.String(), needle) {
		t.Error("EDGE-4 violated: raw audio bytes appeared in a log line")
	}
}

// -----------------------------------------------------------------------------
// AC4 — failure classification: distinct typed errors, never a generic error.
// -----------------------------------------------------------------------------

func TestFFmpegTranscoder_UnknownMIMERejected_ATDD(t *testing.T) {
	tempDir := t.TempDir()
	tr := media.NewFFmpegTranscoder(media.FFmpegConfig{
		FFmpegPath: testFFmpegPath(t),
		TempDir:    tempDir,
	})
	_, _, err := tr.Transcode(context.Background(), []byte("whatever"), "application/pdf")
	if !isErr(err, media.ErrUnsupportedAudio) {
		t.Errorf("unknown srcMIME must be ErrUnsupportedAudio, got %v", err)
	}
	assertTempDirClean(t, tempDir)
}

func TestFFmpegTranscoder_CorruptInputClassified_ATDD(t *testing.T) {
	tempDir := t.TempDir()
	tr := media.NewFFmpegTranscoder(media.FFmpegConfig{
		FFmpegPath: testFFmpegPath(t),
		TempDir:    tempDir,
	})
	in := readFixture(t, corruptFixture) // allow-listed MIME, undecodable bytes

	_, _, err := tr.Transcode(context.Background(), in, "audio/webm")
	if !isErr(err, media.ErrTranscodeFailed) {
		t.Errorf("corrupt/undecodable input must be ErrTranscodeFailed, got %v", err)
	}
	assertTempDirClean(t, tempDir)
}

// -----------------------------------------------------------------------------
// AC5 — startup availability check: present ffmpeg passes, bogus path fails fast.
// -----------------------------------------------------------------------------

func TestCheckFFmpegAvailable_ATDD(t *testing.T) {
	if err := media.CheckFFmpegAvailable(context.Background(), testFFmpegPath(t)); err != nil {
		t.Errorf("a present, runnable ffmpeg must pass the startup check, got %v", err)
	}
	if err := media.CheckFFmpegAvailable(context.Background(), "/nonexistent/ffmpeg"); err == nil {
		t.Error("a missing ffmpeg binary must fail the startup check (fail-fast, not a silent per-job failure)")
	}
}

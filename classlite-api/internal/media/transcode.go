package media

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// OutputMIME is the MIME type of every successful transcode. Opus-in-Ogg is in
// Gemini's inline-audio allow-list (wav/mp3/aiff/aac/ogg/flac); webm/mp4 — what
// the ClassLite recorder actually produces — are NOT, which is why this package
// exists (Story 6.3b0, D1).
const OutputMIME = "audio/ogg"

// OpusBitrate is the target Opus bitrate in bits/sec. 24 kbps mono is the
// voice-transcription sweet spot: it shrinks a 25 MB speaking upload to a few MB
// so the transcoded clip sits comfortably under Gemini's 20 MB inline cap, while
// staying more than adequate for transcription + band grading (D1).
const OpusBitrate = 24000

// AudioChannels forces mono output — speaking recordings are single-voice and a
// second channel only doubles the bitrate for no grading value (D1).
const AudioChannels = 1

// MaxTranscodeInputBytes is the hard pre-exec input ceiling: the 25 MB speaking
// upload cap. Input larger than this is rejected BEFORE ffmpeg is invoked so an
// oversized/hostile payload can never reach the decoder (D2, DoS bound).
const MaxTranscodeInputBytes = 25 * 1024 * 1024

// TranscodeTimeout bounds a single ffmpeg run. The ctx derived from it is wired
// into exec.CommandContext, so exceeding it KILLS the process (no zombie, no
// unbounded CPU) rather than merely returning late (D2, DoS bound).
const TranscodeTimeout = 30 * time.Second

// ErrUnsupportedAudio classifies a caller/input problem detected BEFORE ffmpeg
// runs: an unrecognized source MIME, an empty payload, or input over
// MaxTranscodeInputBytes. It is errors.Is-able so the 6-3b worker maps it to a
// terminal audio_unavailable (refund) without string-matching (GO-2, D5).
var ErrUnsupportedAudio = errors.New("media: unsupported audio input")

// ErrTranscodeFailed classifies a TERMINAL decode failure that a retry will not
// fix: ffmpeg exited with a non-zero code on a corrupt/undecodable clip, the
// ctx deadline was blown (a pathological input hit the time bound), or ffmpeg
// produced empty/over-cap output. errors.Is-able → terminal audio_unavailable +
// refund in 6-3b (GO-2, D5).
var ErrTranscodeFailed = errors.New("media: transcode failed")

// ErrTranscodeUnavailable classifies a TRANSIENT/infra failure that a retry may
// clear — a temp-dir/temp-file write failure, ffmpeg failing to start, ffmpeg
// terminated by a signal we did not send (e.g. an OOM-kill under host memory
// pressure), the parent ctx being cancelled mid-run, or an I/O error reading the
// output. errors.Is-able so 6-3b RETRIES it rather than refunding a still-valid
// recording (code-review 2026-08-24, Ducdo option 1 — split from ErrTranscodeFailed).
var ErrTranscodeUnavailable = errors.New("media: transcode temporarily unavailable")

// supportedInputMIMEs is the source-format allow-list validated pre-exec (D5).
// It covers what the speaking recorder produces (webm on Chrome/Android, mp4 on
// iOS Safari) plus Gemini's native set — a native input is still normalized to
// voice-Opus so the 20 MB inline cap holds regardless of source.
var supportedInputMIMEs = map[string]bool{
	"audio/webm":  true, // Chrome / Android MediaRecorder
	"audio/mp4":   true, // iOS Safari MediaRecorder (.m4a / aac)
	"audio/ogg":   true,
	"audio/wav":   true,
	"audio/x-wav": true,
	"audio/mpeg":  true, // .mp3
	"audio/mp3":   true,
	"audio/aiff":  true,
	"audio/aac":   true,
	"audio/flac":  true,
}

// AudioTranscoder converts an allow-listed, browser-recorded speaking clip into
// a Gemini-ingestible payload. Bytes in → Gemini-ingestible bytes out; it has no
// tenant/RLS/HTTP awareness — the caller enforces SEC-8/RLS before handing bytes
// here (Story 6.3b0, D4).
type AudioTranscoder interface {
	// Transcode converts input (of declared srcMIME) to Opus-in-Ogg mono at a
	// voice bitrate. On success it returns non-empty bytes and outMIME ==
	// OutputMIME. On failure it returns an errors.Is-able ErrUnsupportedAudio
	// (bad MIME / oversize, pre-exec) or ErrTranscodeFailed (decode / timeout).
	Transcode(ctx context.Context, input []byte, srcMIME string) (out []byte, outMIME string, err error)
}

// FFmpegConfig configures an FFmpegTranscoder. Every field has a safe zero-value
// default so tests (and main) can set only what they care about.
type FFmpegConfig struct {
	// FFmpegPath is the resolved ffmpeg binary. "" → "ffmpeg" (PATH lookup).
	FFmpegPath string
	// Timeout bounds a single run. 0 → TranscodeTimeout.
	Timeout time.Duration
	// MaxInputBytes is the pre-exec input ceiling. 0 → MaxTranscodeInputBytes.
	MaxInputBytes int
	// TempDir is where the private per-call work dir is created. "" → os.TempDir().
	TempDir string
	// Logger receives metadata-only diagnostics. "" → slog.Default(). It NEVER
	// receives audio bytes or payload-bearing ffmpeg stderr (EDGE-4).
	Logger *slog.Logger
}

// FFmpegTranscoder is the real AudioTranscoder: it shells out to a bundled
// ffmpeg over private, scrubbed temp files. Construct it with NewFFmpegTranscoder.
type FFmpegTranscoder struct {
	ffmpegPath    string
	timeout       time.Duration
	maxInputBytes int
	tempDir       string
	logger        *slog.Logger
}

// NewFFmpegTranscoder builds an FFmpegTranscoder, applying zero-value defaults.
func NewFFmpegTranscoder(cfg FFmpegConfig) *FFmpegTranscoder {
	path := cfg.FFmpegPath
	if path == "" {
		path = "ffmpeg"
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = TranscodeTimeout
	}
	maxInput := cfg.MaxInputBytes
	if maxInput <= 0 {
		maxInput = MaxTranscodeInputBytes
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &FFmpegTranscoder{
		ffmpegPath:    path,
		timeout:       timeout,
		maxInputBytes: maxInput,
		tempDir:       cfg.TempDir, // "" is fine — os.MkdirTemp("") uses os.TempDir()
		logger:        logger,
	}
}

// Transcode implements AudioTranscoder. Order is load-bearing: the MIME and size
// guards run BEFORE any temp file is written (D2), so a rejected input never
// touches disk or the decoder; on every path past that point the private work
// dir is scrubbed in a defer.
func (t *FFmpegTranscoder) Transcode(ctx context.Context, input []byte, srcMIME string) ([]byte, string, error) {
	// --- pre-exec guards (D2/D5): nothing is written to disk yet ---
	if !supportedInputMIMEs[normalizeMIME(srcMIME)] {
		return nil, "", fmt.Errorf("%w: srcMIME %q not in allow-list", ErrUnsupportedAudio, srcMIME)
	}
	if len(input) == 0 {
		// An empty payload is a caller/input problem, not a decode failure — reject
		// before touching disk or forking ffmpeg (same class as an unknown MIME).
		return nil, "", fmt.Errorf("%w: empty input", ErrUnsupportedAudio)
	}
	if len(input) > t.maxInputBytes {
		return nil, "", fmt.Errorf("%w: input %d bytes over the %d-byte cap", ErrUnsupportedAudio, len(input), t.maxInputBytes)
	}

	// Private per-call work dir; RemoveAll scrubs BOTH temp files on every path
	// (success, error, timeout) — the caller's TempDir is left empty (D2). A
	// mkdir/write failure here is infra (disk full / perms), not bad input →
	// transient class so the caller retries rather than refunds.
	workDir, err := os.MkdirTemp(t.tempDir, "transcode-*")
	if err != nil {
		return nil, "", fmt.Errorf("%w: create work dir: %v", ErrTranscodeUnavailable, err)
	}
	defer os.RemoveAll(workDir)

	inputPath := filepath.Join(workDir, "in")       // webm/mp4 need a seekable file, not stdin (D2)
	outputPath := filepath.Join(workDir, "out.ogg") // fresh dir → no pre-existing file to overwrite
	if err := os.WriteFile(inputPath, input, 0o600); err != nil {
		return nil, "", fmt.Errorf("%w: write temp input: %v", ErrTranscodeUnavailable, err)
	}

	runCtx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()

	// Arg slice — NEVER a shell string (D2, no injection surface). The ctx is
	// wired into CommandContext so a blown deadline KILLS ffmpeg. On UNTRUSTED
	// input we also (a) drop any video stream with -vn — a speaking clip is
	// audio-only, so a crafted container carrying video must never be re-encoded
	// (a CPU-amplification DoS vector), and (b) cap ffmpeg to a single thread so
	// concurrent hostile inputs can't fan out across every core (D2 DoS bounds).
	cmd := exec.CommandContext(runCtx, t.ffmpegPath,
		"-i", inputPath,
		"-vn",           // audio only — never transcode an embedded video stream
		"-threads", "1", // bound CPU fan-out on untrusted input
		"-c:a", "libopus",
		"-b:a", strconv.Itoa(OpusBitrate),
		"-ac", strconv.Itoa(AudioChannels),
		"-f", "ogg",
		outputPath,
	)
	// Discard stdout/stderr — ffmpeg's stderr can echo input-derived detail; we
	// classify by exit code + ctx, never by logging its output (EDGE-4).
	cmd.Stdout = nil
	cmd.Stderr = nil

	runErr := cmd.Run()
	// Check runErr FIRST: if ffmpeg exited zero the output already exists, so a
	// parent-ctx cancellation landing in the post-run window must NOT discard
	// valid work. Only classify failures below.
	if runErr != nil {
		switch {
		case errors.Is(runCtx.Err(), context.DeadlineExceeded):
			// A pathological input hit the time bound — terminal (D2/AC4).
			return nil, "", fmt.Errorf("%w: ffmpeg killed after the %s deadline", ErrTranscodeFailed, t.timeout)
		case runCtx.Err() != nil:
			// Parent ctx cancelled (shutdown / caller gone) — transient, retryable.
			return nil, "", fmt.Errorf("%w: ffmpeg run cancelled: %v", ErrTranscodeUnavailable, runCtx.Err())
		case cmd.ProcessState == nil:
			// ffmpeg never started (binary missing/unexecutable) — infra, retryable.
			return nil, "", fmt.Errorf("%w: ffmpeg failed to start: %v", ErrTranscodeUnavailable, runErr)
		case cmd.ProcessState.ExitCode() == -1:
			// Terminated by a signal we did not send (e.g. OOM-kill) — infra, retryable.
			return nil, "", fmt.Errorf("%w: ffmpeg terminated by signal (likely OOM/host resource pressure)", ErrTranscodeUnavailable)
		default:
			// Non-zero exit code — a genuinely corrupt/undecodable clip (terminal).
			// Log the exit code (metadata only, never stderr bytes) so a codec-less
			// or systematically-failing binary is diagnosable in prod (EDGE-4).
			return nil, "", fmt.Errorf("%w: ffmpeg exited %d (likely corrupt/undecodable input)", ErrTranscodeFailed, cmd.ProcessState.ExitCode())
		}
	}

	// Bound the output read by THIS instance's input cap (not a package constant):
	// a voice-bitrate re-encode can never legitimately exceed the input it came
	// from, so a larger output is refused rather than allocated (D2).
	out, err := readCapped(outputPath, t.maxInputBytes)
	if err != nil {
		if errors.Is(err, errOutputTooLarge) {
			// Suspicious over-cap output — terminal.
			return nil, "", fmt.Errorf("%w: %v", ErrTranscodeFailed, err)
		}
		// I/O error reading the output file — infra, retryable.
		return nil, "", fmt.Errorf("%w: read ffmpeg output: %v", ErrTranscodeUnavailable, err)
	}
	if len(out) == 0 {
		return nil, "", fmt.Errorf("%w: ffmpeg produced an empty output", ErrTranscodeFailed)
	}

	// Metadata only — sizes, never bytes (EDGE-4).
	t.logger.Debug("audio transcoded",
		"src_mime", normalizeMIME(srcMIME),
		"out_mime", OutputMIME,
		"in_bytes", len(input),
		"out_bytes", len(out),
	)
	return out, OutputMIME, nil
}

// requiredEncoder is the ffmpeg audio encoder every transcode depends on. A
// static ffmpeg built without it launches fine but fails EVERY real transcode —
// so the boot check must prove the encoder exists, not just that the binary runs.
const requiredEncoder = "libopus"

// CheckFFmpegAvailable verifies the ffmpeg binary at ffmpegPath is present,
// runnable, AND carries the libopus encoder the transcode path requires. It is
// called at API boot so a missing/unrunnable/codec-less binary fails fast with a
// clear error instead of surfacing three retries deep in a production job
// (Story 6.3b0, AC5/D3). Listing encoders (rather than just `-version`) closes
// the gap where a base-image bump ships an ffmpeg without libopus: -version
// would still pass while every student recording silently failed to grade.
func CheckFFmpegAvailable(ctx context.Context, ffmpegPath string) error {
	if ffmpegPath == "" {
		ffmpegPath = "ffmpeg"
	}
	checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var out bytes.Buffer
	cmd := exec.CommandContext(checkCtx, ffmpegPath, "-hide_banner", "-encoders")
	cmd.Stdout = &out
	cmd.Stderr = nil
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg not available at %q (audio transcode will fail): %w", ffmpegPath, err)
	}
	if !strings.Contains(out.String(), requiredEncoder) {
		return fmt.Errorf("ffmpeg at %q lacks the %s encoder (audio transcode will fail); bundle an ffmpeg built with --enable-%s", ffmpegPath, requiredEncoder, requiredEncoder)
	}
	return nil
}

// normalizeMIME lower-cases and strips any parameters (e.g. the recorder's
// "audio/webm;codecs=opus") so the allow-list check compares the bare type.
func normalizeMIME(mime string) string {
	if i := strings.IndexByte(mime, ';'); i >= 0 {
		mime = mime[:i]
	}
	return strings.ToLower(strings.TrimSpace(mime))
}

// errOutputTooLarge marks the one readCapped failure that is NOT an I/O error:
// ffmpeg produced more bytes than the cap. The caller classifies it as terminal
// (suspicious output), while a genuine I/O read error is transient.
var errOutputTooLarge = errors.New("output exceeds cap")

// readCapped reads at most maxBytes from path and returns errOutputTooLarge if
// the file exceeds it (bounded read — never an unbounded allocation on a hostile
// output).
func readCapped(path string, maxBytes int) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	out, err := io.ReadAll(io.LimitReader(f, int64(maxBytes)+1))
	if err != nil {
		return nil, err
	}
	if len(out) > maxBytes {
		return nil, fmt.Errorf("%w: %d-byte cap", errOutputTooLarge, maxBytes)
	}
	return out, nil
}

# Story 6-3b0-audio-transcode-service: Completion Notes

_Implementation record for [`6-3b0-audio-transcode-service.md`](./6-3b0-audio-transcode-service.md). Status: review._

## Dev Agent Record

### Debug Log

- Red proof confirmed before any code: `go build ./...` green (tagged files excluded), `go test -tags=atdd_red_phase ./internal/media/...` compile-failed on each documented seam (15 undefined symbols, all mapping to story seams — never an existing helper). ffmpeg 8.1.2 + ffprobe present locally.
- **Temp-scrub design:** the ATDD `assertTempDirClean` reads the *injected* `TempDir` and asserts it is empty after `Transcode`. Solution: create a private per-call subdir via `os.MkdirTemp(cfg.TempDir, "transcode-*")` and `defer os.RemoveAll(workDir)` — one call scrubs both temp files on every path (success/error/timeout) and leaves the injected dir empty. Pre-exec guards (MIME/size) return *before* the subdir is created, so the oversize/unknown-MIME tests see an empty dir too.
- **Timeout kill:** `context.WithTimeout(ctx, timeout)` wired into `exec.CommandContext`; a `1ns` injected timeout kills ffmpeg at/near exec and returns `<5s`, classified `ErrTranscodeFailed` via `runCtx.Err() != nil`.
- **EDGE-4:** `cmd.Stdout`/`cmd.Stderr` set to `nil` (discarded) — ffmpeg stderr can echo input-derived detail; classification is by exit code + ctx only. The debug log line emits sizes, never bytes. The `_NeverLogsAudioPayload_` test (first 32 input bytes never in a log line) passes.
- **Docker (approach a):** multi-stage `COPY` of a pinned **static** ffmpeg from `mwader/static-ffmpeg:7.1` into the unchanged `distroless-static` runtime — no libc, keeps the hardened base. In-container verify: `ffmpeg -version` → 7.1 with `--enable-libopus --enable-static`; API boot logs `ffmpeg available` before the DB step; image size 351 MB (ffmpeg static + full codec set — the documented trade-off, flagged for human review).
- All 9 media tests pass with real ffmpeg, zero skips. `go test -tags=atdd_red_phase ./internal/media/...` now compiles + passes (red suite empty).

### Completion Notes

Shipped the pure-infra transcode leaf exactly to spec (D1–D5):

- **`internal/media/transcode.go`** — `AudioTranscoder` interface; `FFmpegTranscoder` (arg-slice `exec.CommandContext`, never a shell string; pre-exec MIME allow-list + size guard; private scrubbed temp dir; ctx-timeout kill; typed-error classification; capped output read; metadata-only logging). `CheckFFmpegAvailable` boot check. Named constants (`OutputMIME`, `OpusBitrate=24000`, `AudioChannels=1`, `MaxTranscodeInputBytes=25 MB`, `TranscodeTimeout=30s` — CQ-3). Sentinels `ErrUnsupportedAudio`/`ErrTranscodeFailed` (`errors.Is`-able — GO-2/D5).
- **`internal/media/mock.go`** — `MockTranscoder` (success/failing constructors + mutex-guarded `CallCount()` spy), the hermetic seam 6-3b injects.
- **Startup wiring** — `config.FFmpegPath` (`CLASSLITE_FFMPEG_PATH`, default `ffmpeg`) + `media.CheckFFmpegAvailable` in `cmd/api/main.go` after `cfg.LogSummary()`, fail-fast `os.Exit(1)`.
- **Dockerfile** — bundled pinned static ffmpeg (human-review flagged, D3). **CI** (`ci-api.yml`) — explicit `apt-get install ffmpeg` + a guard step that fails the build if the transcode integration tests are skipped or the normalization test doesn't pass (AC7, no silent green).
- **Docs** — `manual-setup.md` (ffmpeg runtime dependency + human-review note); `deferred-work.md` (6-3b unblock, per-retry re-transcode = future cache, reuse anchor, version-pin maintenance).

**Deviations from spec:** none. `OpusBitrate` fixed at 24000 (bottom of the 24000–32000 voice band — smallest output, adequate for grading). Bundled-ffmpeg approach (a) chosen over (b) as the story preferred (keeps distroless-static).

**Not verifiable in this environment:** none — the Docker image build, in-container `ffmpeg -version`, and API boot ffmpeg check were all run locally (Docker 29.4.0) and pass. CI ffmpeg provisioning is asserted by the new guard step (will execute on the next `ci-api` run).

### Implementation Plan (summary)

1. Pre-flight: red proof + reuse-exemplar reads (`gemini/mock.go`, `upload_allowlist.go`, `main.go`, `config.go`, Dockerfile).
2. `transcode.go` — types/constants/sentinels/interface (Task 1) + `FFmpegTranscoder` + `CheckFFmpegAvailable` (Tasks 2–3).
3. `mock.go` — `MockTranscoder` (Task 5).
4. Green the ATDD suite; remove build tags; `gofmt`/build/vet/test (Task 6).
5. `config.FFmpegPath` + `main.go` startup check wiring (Task 3).
6. Dockerfile static-ffmpeg bundle + local image build/boot verify (Task 4).
7. `ci-api.yml` ffmpeg install + no-silent-skip guard (Task 7).
8. Docs + this sibling (Task 8).

## File List

### Added
- `classlite-api/internal/media/transcode.go` — AudioTranscoder + FFmpegTranscoder + CheckFFmpegAvailable + constants/sentinels.
- `classlite-api/internal/media/mock.go` — MockTranscoder (downstream test seam).
- `_bmad-output/implementation-artifacts/6-3b0-audio-transcode-service-completion-notes.md` — this file.

### Modified
- `classlite-api/internal/media/doc.go` — package doc updated from red-phase-scaffold prose to the green package overview.
- `classlite-api/internal/media/transcode_atdd_test.go` — removed `//go:build atdd_red_phase` tag; corrected stale red-phase header prose (test bodies unchanged — ATDD contract).
- `classlite-api/internal/media/mock_atdd_test.go` — removed `//go:build atdd_red_phase` tag; corrected stale header prose (test bodies unchanged).
- `classlite-api/internal/config/config.go` — added `FFmpegPath` (`CLASSLITE_FFMPEG_PATH`, default `ffmpeg`) to `Config`, `Load`, `LogSummary`.
- `classlite-api/cmd/api/main.go` — import `internal/media`; boot-time `media.CheckFFmpegAvailable` fail-fast after `cfg.LogSummary()`.
- `classlite-api/Dockerfile` — bundle pinned static ffmpeg (`mwader/static-ffmpeg:7.1`) into distroless-static; set `CLASSLITE_FFMPEG_PATH` (human-review infra change, D3).
- `.github/workflows/ci-api.yml` — install ffmpeg; guard that transcode integration tests are not silently skipped (AC7).
- `docs/manual-setup.md` — ffmpeg runtime-dependency section + human-review note.
- `_bmad-output/implementation-artifacts/deferred-work.md` — 6-3b0 deferral notes (6-3b unblock, per-retry re-transcode, reuse, version-pin).

### Deleted
_None._

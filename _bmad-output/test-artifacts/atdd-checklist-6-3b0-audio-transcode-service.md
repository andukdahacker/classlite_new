---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation', 'step-03-handoff']
lastStep: 'step-03-handoff'
lastSaved: '2026-08-23'
storyId: '6.3b0'
storyKey: '6-3b0-audio-transcode-service'
storyFile: '_bmad-output/implementation-artifacts/6-3b0-audio-transcode-service.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-6-3b0-audio-transcode-service.md'
detectedStack: 'backend'
redPhaseConvention: 'go:build atdd_red_phase (compile-fail red)'
generatedTestFiles:
  - 'classlite-api/internal/media/transcode_atdd_test.go'
  - 'classlite-api/internal/media/mock_atdd_test.go'
  - 'classlite-api/internal/media/doc.go'
generatedFixtures:
  - 'classlite-api/internal/media/testdata/sample_speech.webm'
  - 'classlite-api/internal/media/testdata/sample_speech.m4a'
  - 'classlite-api/internal/media/testdata/corrupt.webm'
inputDocuments:
  - '_bmad-output/implementation-artifacts/6-3b0-audio-transcode-service.md'
  - 'docs/project-context.md'
  - 'classlite-api/internal/service/grading/speaking_grading_atdd_test.go (red-convention exemplar)'
  - 'classlite-api/internal/gemini/mock.go (mock-double exemplar)'
  - 'classlite-api/internal/service/upload_allowlist.go (webm/mp4 allow-list consumed)'
  - 'memory: reference-atdd-red-convention'
---

# ATDD Checklist — Story 6.3b0: Audio Transcode Service

**Stack:** Backend (Go leaf package `internal/media`). No DB / RLS / HTTP surface.
**Red convention:** repo-ratified **compile-fail red** (`//go:build atdd_red_phase`), NOT `t.Skip()`. Verified below.
**Risk:** score 4 — infra (new system binary in the API image) + DoS surface (untrusted audio → ffmpeg). Security bounds are DoD, not optional.

---

## Red-phase proof (run these — they are the gate)

```bash
cd classlite-api
go build ./...                                   # GREEN — tagged files excluded, empty media pkg builds
go test -tags=atdd_red_phase ./internal/media/... # RED   — compile-fails on each undefined seam
```

Current red output is per-seam (`undefined: media.AudioTranscoder`, `media.FFmpegTranscoder`, `media.NewFFmpegTranscoder`, `media.FFmpegConfig`, `media.OutputMIME`, `media.OpusBitrate`, `media.AudioChannels`, `media.MaxTranscodeInputBytes`, `media.TranscodeTimeout`, `media.ErrUnsupportedAudio`, `media.ErrTranscodeFailed`, `media.MockTranscoder`, `media.NewMockTranscoder`, `media.NewFailingMockTranscoder`, `media.CheckFFmpegAvailable`). **Every error maps to a documented seam — none against an existing helper.** That is red-the-right-way.

---

## Generated artifacts

| File | Purpose |
|---|---|
| `internal/media/transcode_atdd_test.go` | FFmpegTranscoder integration + startup check — **AC1–AC5** |
| `internal/media/mock_atdd_test.go` | MockTranscoder contract — **AC6** |
| `internal/media/doc.go` | Bare `package media` clause so red lands per-seam (not "no Go files"). Dev keeps/extends it. |
| `internal/media/testdata/sample_speech.webm` | **Real** 1s opus-in-webm, mono (Chrome/Android shape) — generated + ffprobe-verified during authoring |
| `internal/media/testdata/sample_speech.m4a` | **Real** 1s aac-in-mp4, mono (iOS Safari shape) |
| `internal/media/testdata/corrupt.webm` | 46 bytes of garbage — undecodable (AC4) |

> Fixtures are **already committed and proven**: the exact D2 command `ffmpeg -i <in> -c:a libopus -b:a 24000 -ac 1 -f ogg <out>` was run against both during authoring → opus/mono ogg out (webm 4107→3791 B, m4a 7288→4115 B); corrupt input exits non-zero (183). No fixture chore remains for the dev.

---

## AC → test mapping (traceability)

| AC | Test(s) | Assertion |
|---|---|---|
| **AC1** interface + FFmpegTranscoder impl | `var _ media.AudioTranscoder`; `TestFFmpegTranscoder_NormalizesWebmAndM4a_ATDD` | non-empty ogg, `outMIME=="audio/ogg"` |
| **AC2** format normalization (D1) | `TestFFmpegTranscoder_NormalizesWebmAndM4a_ATDD` | webm **and** m4a → ffprobe reports `opus`/`1ch`; re-encode does not inflate. Structural, not a byte-golden. |
| **AC3** bounds + safety (D2) | `_OversizeRejectedPreExec_`, `_TimeoutKillsAndScrubs_`, `_NeverLogsAudioPayload_` | size guard fires **pre-exec** (temp dir stays empty); 1ns ctx kills promptly + scrubs; raw bytes never in logs (EDGE-4) |
| **AC4** failure classification (D5) | `_UnknownMIMERejected_`, `_CorruptInputClassified_` | unknown MIME → `ErrUnsupportedAudio`; corrupt → `ErrTranscodeFailed`; both `errors.Is`-able |
| **AC5** startup check (D3) | `TestCheckFFmpegAvailable_ATDD` | present ffmpeg passes; bogus path fails fast |
| **AC6** MockTranscoder (D4) | `TestMockTranscoder_SuccessMode_ATDD`, `_ErrorMode_ATDD` | canned ogg + `OutputMIME`; error mode → `ErrTranscodeFailed`; `CallCount()` spy |
| **AC7** Docker + CI | *not unit-assertable — see Infra checklist below* | tests LOUD-skip (never silent-green) if ffmpeg absent; CI must provide it |

---

## Implementation checklist (green phase — the ONE place to reconcile all seams)

Fill these in `internal/media/`; remove the `//go:build atdd_red_phase` tag from each test file as its seams land.

- [ ] **`transcode.go` — types & constants (Task 1, CQ-3/GO-2)**
  - [ ] `type AudioTranscoder interface { Transcode(ctx context.Context, input []byte, srcMIME string) (out []byte, outMIME string, err error) }`
  - [ ] sentinels `ErrUnsupportedAudio`, `ErrTranscodeFailed` (typed, `errors.Is`-able — GO-2)
  - [ ] consts: `OutputMIME = "audio/ogg"`, `OpusBitrate` (24000–32000), `AudioChannels = 1`, `MaxTranscodeInputBytes` (= 25 MB speaking cap), `TranscodeTimeout` (≈30s)
- [ ] **`transcode.go` — `FFmpegTranscoder` (Task 2, D1/D2/D5)**
  - [ ] `FFmpegConfig{ FFmpegPath string; Timeout time.Duration; MaxInputBytes int; TempDir string; Logger *slog.Logger }` with zero-value defaults (`0`→const, `""`→`os.TempDir()`/`slog.Default()`)
  - [ ] `NewFFmpegTranscoder(FFmpegConfig) *FFmpegTranscoder`
  - [ ] **pre-exec** size guard (`len(input) > MaxInputBytes` → `ErrUnsupportedAudio`) and MIME allow-list check (`audio/webm`, `audio/mp4`, + Gemini-native set → `ErrUnsupportedAudio` on unknown) — **before** any temp write
  - [ ] private temp dir under `TempDir`; write input; `defer` scrub of BOTH files on **every** path (success/error/timeout)
  - [ ] `exec.CommandContext(ctx, FFmpegPath, "-i", tmpIn, "-c:a", "libopus", "-b:a", strconv.Itoa(OpusBitrate), "-ac", "1", "-f", "ogg", tmpOut)` — **arg slice, never `sh -c`**
  - [ ] wrap ctx with `Timeout`; non-zero exit / decode failure / `ctx.Err()` → `ErrTranscodeFailed`
  - [ ] read output with a size cap; never log audio bytes or payload-bearing stderr (EDGE-4)
- [ ] **`transcode.go` — `CheckFFmpegAvailable(ctx, ffmpegPath) error` (Task 3, AC5)** — runs `ffmpeg -version`; typed error on missing/unrunnable
- [ ] **`mock.go` — `MockTranscoder` (Task 5, D4)** — `NewMockTranscoder(out []byte)` + `NewFailingMockTranscoder(err error)` + mutex-guarded `CallCount()`. Mirror `internal/gemini/mock.go`.
- [ ] **`cmd/api/main.go` — wire startup check (Task 3, AC5)** — call `media.CheckFFmpegAvailable` after `cfg.Validate()`/`cfg.LogSummary()` (~main.go:51), **before** the server serves; `slog.Error` + `os.Exit(1)` on failure. Resolve ffmpeg path from config/env (`CLASSLITE_FFMPEG_PATH`, sane default).

---

## Infra checklist (AC7 — human-review items, D3)

- [ ] **Dockerfile (`classlite-api/Dockerfile`) — pinned ffmpeg.** Current: `FROM golang:1.25-alpine AS builder` → `FROM gcr.io/distroless/static-debian12`. Pick + **document + flag for human review**:
  - (a) multi-stage `COPY` a **fully static** ffmpeg into distroless-static (smallest, keeps hardened base — binary MUST be genuinely static, no libc), **or**
  - (b) swap runtime base to `gcr.io/distroless/base-debian12` (has libc) / slim-debian and install ffmpeg. Prefer (a); (b) is the safe fallback. **Pin the version.**
  - [ ] Verify: image builds, boots, `ffmpeg -version` runs in-container.
- [ ] **CI (`ci-api`) provides ffmpeg** (apt/apk install or same image) so the `-tags=atdd_red_phase`→green integration tests actually run. The tests LOUD-skip if ffmpeg is absent — **assert they are not silently skipped** in CI.
- [ ] **Docs (Task 8):** `docs/manual-setup.md` (ffmpeg now required in API runtime + CI); `deferred-work.md` (this keystone unblocks 6-3b's worker transcode call; note per-retry re-transcode is a future cache optimization, not v1); create the `…-completion-notes.md` sibling at first dev pickup.

---

## Notes / deltas surfaced during authoring

1. **Path drift:** story Dev Notes call the leaf precedent `internal/grading`; it actually lives at **`internal/service/grading`**. The story's own decision (D4) still places the new package at **`internal/media`** — a top-level leaf, which is fine (no service import → no cycle). No change needed; flagged so the dev doesn't hunt for a non-existent `internal/grading`.
2. **`ffprobe` dependency in tests:** AC2's structural proof uses `ffprobe` (ships with ffmpeg). The helper LOUD-skips if absent — ensure CI's ffmpeg package includes ffprobe (standard).
3. **Timeout determinism:** the timeout test injects `Timeout: 1ns` so the deadline is blown at exec — deterministic, no reliance on a slow transcode. Impl must wire `ctx` into `CommandContext` for this to kill (not just ignore).
4. **AC2 size assertion is directional, not golden** (per story): `len(out) <= len(in)` on the representative fixtures + ffprobe opus/mono. The real "shrinks a 25 MB upload under the 20 MB inline cap" property is a voice-bitrate consequence, asserted structurally, not by a byte count.

## DoD gate commands

```bash
cd classlite-api
go build ./... && go vet ./internal/media/...
go test ./internal/media/...                      # green suite once seams land + tags removed
go test -tags=atdd_red_phase ./internal/media/...  # must be EMPTY of red once fully green
docker build -t classlite-api . && docker run --rm classlite-api ffmpeg -version  # AC7
```

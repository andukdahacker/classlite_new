# Story 6.3b0: Audio Transcode Service (Gemini-ingestible audio — prerequisite keystone for 6-3b)

Status: done

<!-- YAML frontmatter -->
```yaml
epic: 6
story: 6.3b0
key: 6-3b0-audio-transcode-service
size: S   # Ducdo ruling 2026-08-23 (party-mode 6-3b): the transcode capability is SPLIT out of 6-3b into this thin prerequisite keystone so the one risky infra change (ffmpeg + base-image swap) is isolated and human-reviewable, and 6-3b stays thin.
audience: Backend (Go — a leaf media package wrapping a bundled ffmpeg; Docker base-image change; startup capability check)
baseline_commit: c407444
dependencies: []   # pure infra leaf — no DB, no RLS, no service deps; bytes in → Gemini-ingestible bytes out
unblocks: [6-3b]   # 6-3b's ai_grade_speaking worker MUST transcode webm/mp4 → ogg/opus before the Gemini inline call (Gemini rejects webm/mp4); this keystone provides the media.AudioTranscoder it calls
provides: internal/media.AudioTranscoder interface + media.FFmpegTranscoder impl + media.MockTranscoder (downstream test seam); a bundled static ffmpeg in the API image; a startup ffmpeg-availability check
risk_score: 4   # infra/dependency (new system binary in the API container) + DoS surface (untrusted audio → ffmpeg: size/time bounds, temp-file scrub, no shell injection). No RLS/tenant surface (the caller enforces SEC-8 before handing bytes here). Below the WF-8 ≥6 hard-gate line, but the security bounds are DoD-mandatory.
review: pending party-mode (extracted from the 6-3b pre-dev review, Winston/Murat/John/Amelia 2026-08-23). Winston flagged the base-image change as a human-review infra item.
```

## Story

As a **backend engineer**,
I want **a small, reusable server-side capability that converts a browser-recorded audio clip (webm/opus from Chrome/Android, mp4/aac from iOS Safari) into a compact, Gemini-ingestible format**,
so that **the AI speaking-grade worker (6-3b) — and any future audio→AI feature — can send student recordings to Gemini, which accepts only wav/mp3/aiff/aac/ogg/flac and rejects the webm/mp4 our recorder actually produces.**

**Why this exists (verified 2026-08-23):** Gemini's inline-audio understanding accepts **only** `audio/wav`, `audio/mp3`, `audio/aiff`, `audio/aac`, `audio/ogg`, `audio/flac` ([ai.google.dev/gemini-api/docs/audio](https://ai.google.dev/gemini-api/docs/audio)). ClassLite's speaking recorder persists **`audio/webm`** (Chrome/Android) and **`audio/mp4`/`.m4a`** (iOS Safari) — `upload_allowlist.go:38-45` — **neither of which Gemini reads**, on ANY device (the format is a function of the browser's `MediaRecorder`, not the device; desktop Chrome still emits webm). Without a transcode step, every real speaking recording would be rejected by Gemini → retried 3× → refunded: the AI speaking feature would be broken in production for everyone. The Files API does **not** help — it lifts only the 20 MB size limit; the format allow-list is a model-understanding capability identical on both paths. So transcode is unavoidable, and it is extracted here so the infra change lands in one reviewable place.

**Scope:** A leaf `internal/media` package: an `AudioTranscoder` interface, an `FFmpegTranscoder` implementation that shells out to a **bundled static ffmpeg** to convert any allow-listed speaking input → **Opus-in-Ogg, mono, ~24–32 kbps** (`audio/ogg` — voice-optimized: normalizes BOTH format AND size, so the transcoded output is tiny and comfortably under Gemini's 20 MB inline cap for the full 25 MB upload range), a `MockTranscoder` for downstream (6-3b) hermetic tests, the Docker base-image change to carry ffmpeg, and a startup availability check. **Bytes in → Gemini-ingestible bytes out.** No DB, no tenant context, no HTTP surface (the caller — 6-3b's worker — already enforces SEC-8/RLS before handing bytes here).

**Explicitly NOT in this story (→ 6-3b):** the `ai_grade_speaking` worker, the Gemini client's audio-part extension, any enqueue/read/credit logic, and any tenant/RLS handling. This keystone is the pure transcode capability + its infra; 6-3b wires it into the worker.

## Decisions (resolved during the 6-3b party-mode review — treat as spec, not suggestion)

- **D1 — Re-encode to voice-optimized Opus/Ogg, not a lossless re-mux.** A `-c:a copy` re-mux (webm→ogg, mp4→aac) would fix format but NOT size — a 25 MB upload stays ~25 MB → base64 ~33 MB → over Gemini's 20 MB inline cap (Winston's cap-mismatch). Re-encoding to **Opus mono at a voice bitrate** (`OpusBitrate=24000`..`32000`, `AudioChannels=1`) shrinks a 20-minute mock to ~3–5 MB → base64 well under 20 MB, so the inline path covers the full allowed upload-size range and the Files API is genuinely unnecessary for v1. Speech quality at 24–32 kbps Opus is more than adequate for transcription + band grading. Output MIME is **`audio/ogg`** (Gemini-supported). Name the bitrate/channels/sample-rate as constants (CQ-3).
- **D2 — Shell out to a BUNDLED STATIC ffmpeg via `os/exec`, over temp files, never a shell string.** No pure-Go decoder handles webm/opus + mp4/aac reliably (immature). ffmpeg is the boring, proven tool. Invoke with an **arg slice** (`exec.CommandContext(ctx, ffmpegPath, "-i", inPath, ...)`) — NEVER a shell/`sh -c` string (no shell-injection surface; inputs are file paths we control, but keep the discipline). webm/mp4 need **seekable input**, so write the input to a private temp file rather than piping stdin; read the output temp file; **scrub both in a `defer`** regardless of outcome. Bound: reject input over `maxTranscodeInputBytes` (= the 25 MB speaking upload cap) BEFORE invoking ffmpeg; kill ffmpeg via `ctx` timeout (`transcodeTimeout`, e.g. 30s) to cap CPU/DoS; cap the readable output size. Never log audio bytes (EDGE-4).
- **D3 — The base image must change to carry ffmpeg — this is the human-review infra item (Winston).** The API ships on `gcr.io/distroless/static-debian12` (no libc, no shell). Two viable paths, dev picks + documents: **(a)** multi-stage `COPY` a **fully static** ffmpeg build (e.g. a static musl ffmpeg) into the current distroless-static image — smallest, keeps the hardened base, but the binary must be genuinely static (no libc); or **(b)** switch the runtime base to `gcr.io/distroless/base-debian12` (has libc) or a slim debian and install/copy ffmpeg. Prefer (a) if a trustworthy static build is available; (b) is the safe fallback. **Flag the chosen approach for human review** (base-image changes touch the deploy surface, image size, and CVE posture). Pin the ffmpeg version.
- **D4 — Interface + mock seam so 6-3b's worker tests stay hermetic.** Export `media.AudioTranscoder` (interface), `media.FFmpegTranscoder` (real impl, integration-tested here with tiny real fixtures), and `media.MockTranscoder` (a canned-bytes/error double 6-3b injects into its worker tests — real ffmpeg banned in the 6-3b worker suite, mirroring the `gemini.MockClient` pattern). The leaf package has **no `service`/`worker`/DB import**, so both packages depend on it with no cycle (mirrors the `internal/grading` leaf).
- **D5 — Input format allow-list is validated here; unknown/undecodable → a typed error the caller maps to a terminal failure (refund).** Accept the speaking allow-list (`audio/webm`, `audio/mp4`) + the Gemini-native set (pass-through / still normalized). An unrecognized src MIME, an ffmpeg decode failure (corrupt/truncated file), or a timeout → a distinct typed error (`ErrTranscodeFailed` / `ErrUnsupportedAudio`) — the worker in 6-3b maps it to terminal `audio_unavailable` (refund; the teacher gets their credit back and the read path shows "ask student to re-record"). This keystone classifies; 6-3b decides refund.

## Acceptance Criteria

1. **`media.AudioTranscoder` interface + `FFmpegTranscoder` impl.** `Transcode(ctx, input []byte, srcMIME string) (out []byte, outMIME string, err error)` — converts an allow-listed input to **Opus-in-Ogg mono ~24–32 kbps**, returns `outMIME == "audio/ogg"` and non-empty bytes on success. Uses a bundled ffmpeg via `exec.CommandContext` with an **arg slice** (no shell string), over private temp files scrubbed in `defer`.
2. **Format normalization (D1).** A real `audio/webm` (opus) fixture and a real `audio/mp4`/`.m4a` (aac) fixture both transcode to a valid, non-empty `audio/ogg` payload that ffprobe/decoders accept as Opus-in-Ogg. Output is materially smaller than a 25 MB-scale input (voice-bitrate re-encode — assert the compression direction on a representative fixture, not a byte-exact golden).
3. **Bounds + safety (D2).** Input over `maxTranscodeInputBytes` (25 MB) → `ErrUnsupportedAudio`/size error **before** ffmpeg is invoked. An ffmpeg run exceeding `transcodeTimeout` is killed via `ctx` (no zombie process, no unbounded CPU). Temp files are removed on every path (success, error, timeout). No audio bytes, temp paths, or ffmpeg stderr containing payload appear in logs (EDGE-4).
4. **Failure classification (D5).** An unrecognized `srcMIME`, a corrupt/truncated/undecodable input, or a timeout → a **distinct typed error** (`ErrTranscodeFailed`/`ErrUnsupportedAudio`), never a generic `error`, so the 6-3b worker can `errors.Is` it to terminal `audio_unavailable`.
5. **Startup availability check (D3).** On boot, the API verifies the bundled ffmpeg is present and runnable (e.g. `ffmpeg -version` succeeds); a missing/unrunnable binary fails fast with a clear log/error at startup — never a silent per-job failure discovered three retries deep in production.
6. **`media.MockTranscoder` (D4).** A test double implementing `AudioTranscoder` with per-test-constructable success (canned ogg bytes) and error (`ErrTranscodeFailed`) modes + a call spy, exported for 6-3b's worker suite. Real ffmpeg banned in downstream worker tests.
7. **Docker + CI (D3).** The API image carries a pinned ffmpeg (approach (a) static-copy or (b) base-image swap — documented, human-review-flagged). CI can run the `FFmpegTranscoder` integration tests (ffmpeg available in the test environment); the tests skip-with-a-loud-log or fail clearly if ffmpeg is absent (no silent green).

## Tasks / Subtasks

- [x] **Task 1 — leaf package + interface (D4).** New `internal/media/transcode.go` (package `media`, no service/worker/DB imports): `AudioTranscoder` interface, `ErrTranscodeFailed`/`ErrUnsupportedAudio` sentinels, the bitrate/channels/timeout/size constants (CQ-3).
- [x] **Task 2 — `FFmpegTranscoder` (D1/D2/D5).** `exec.CommandContext` arg-slice invocation (`-i <tmpin> -c:a libopus -b:a <bitrate> -ac 1 -f ogg <tmpout>`); private temp dir; `defer` scrub; input size guard pre-exec; `ctx` timeout; typed-error classification on non-zero exit / decode failure; read output with a size cap. Never log payloads.
- [x] **Task 3 — startup check (D3).** Wire an ffmpeg-availability assertion into API boot (`cmd/api/main.go`) — fail fast + clear log if absent. Resolve the ffmpeg path from config/env with a sane default.
- [x] **Task 4 — Docker base image (D3; human-review).** Add pinned ffmpeg to the runtime image via approach (a) static-copy into distroless-static, or (b) base swap to distroless/base or slim-debian. Document the choice + version in the Dockerfile and flag for human review. Verify image builds + boots + `ffmpeg -version` runs in the container.
- [x] **Task 5 — `MockTranscoder` (D4).** `internal/media/mock.go` — success/error modes + call spy, exported for 6-3b.
- [x] **Task 6 — tests.** `FFmpegTranscoder` integration: tiny real `.webm` + `.mp4` fixtures → valid `audio/ogg` out (AC2); oversize → error pre-exec (AC3); corrupt input → `ErrTranscodeFailed` (AC4); timeout kills the process (AC3); temp-file scrub asserted; no-payload-in-logs (AC3). `MockTranscoder` contract test. Fixtures: commit two ~1s clips (one webm/opus, one mp4/aac). CI must have ffmpeg (Task 7).
- [x] **Task 7 — CI.** Ensure `ci-api` provides ffmpeg for the integration tests (apt/apk install in the CI job, or the same image). Assert the transcode tests run (not silently skipped).
- [x] **Task 8 — docs.** `docs/manual-setup.md`: ffmpeg is now required in the API runtime + CI (how it's provided). `deferred-work.md`: this keystone unblocks 6-3b's worker transcode call; note the future reuse (any audio→AI feature) and the per-retry-re-transcode note (6-3b re-invokes `generate` per retry → re-transcodes; a cache is a future optimization, not v1). Create the sibling `…-completion-notes.md` at first dev pickup.

## Dev Notes

**This is a thin, pure-infra leaf.** No RLS, no tenant, no HTTP — the caller (6-3b's worker) has already read the submission under RLS and enforced SEC-8 via `GetObjectOwned` before it hands bytes here. The only genuinely new thing in the whole repo is **a system binary in the API image**, which is exactly why it's isolated into its own keystone with a human-review flag.

**Why re-encode, not re-mux (D1):** the goal is two-in-one — Gemini-ingestible format *and* small enough for the 20 MB inline cap. Opus mono at 24–32 kbps is the voice-transcription sweet spot; it makes the inline path cover the full 25 MB upload range so 6-3b never needs the Files API. Re-mux (`-c:a copy`) would leave big files big.

**Security bounds are DoD, not optional:** untrusted user audio flows into ffmpeg. Arg-slice exec (no shell), a hard input-size cap *before* exec, a `ctx` timeout that actually kills the process, temp-file scrub on every path, and no payload in logs. These are the risk_score=4 mitigations — a review will check them.

**Reuse anchors:**
- Leaf-package precedent (no service/worker cycle): `internal/grading` (`EssayText`, `ValidateCriterionScores`) — `media` sits at the same layer.
- Mock-double precedent: `internal/gemini/mock.go` (`MockClient`, `CallCount()`, per-mode config) — mirror for `MockTranscoder`.
- The speaking upload allow-list + 25 MB cap this consumes: `internal/service/upload_allowlist.go:36-45`, `internal/handler/upload_presign_size_atdd_test.go:119-122`.
- Dockerfile to change: `classlite-api/Dockerfile` (`FROM golang:1.25-alpine AS builder` → `FROM gcr.io/distroless/static-debian12`).

**Project-context guardrails:** CQ-3 (name bitrate/channels/timeout/size constants); CQ-4 (no cryptic names — `internal/media`, not `internal/av`); EDGE-4 (never log the audio payload or full ffmpeg stderr if it echoes bytes); GO-2 (typed errors, not stdlib `errors.New`, so the caller can `errors.Is`). No new Go module dependency (ffmpeg is a system binary, not a Go import) — but the **image change is a Rolldown/Vite-style "flag new infra for human review" item** (project-context Vite rule spirit).

### References
- [ai.google.dev/gemini-api/docs/audio] — the supported-format allow-list (wav/mp3/aiff/aac/ogg/flac; NOT webm/mp4) + the 20 MB inline cap. The reason this story exists.
- [6-3b-ai-speaking-grading-backend.md] — the sole consumer; D2 there calls `media.Transcode` before the Gemini inline call.
- [upload_allowlist.go:36-45] — the webm/mp4 speaking formats this normalizes.
- [docs/project-context.md] — CQ-3/4, EDGE-4, GO-2, WF-2/3, the human-review-new-infra spirit.

## Definition of Done

- [x] `media.AudioTranscoder` + `FFmpegTranscoder` convert real webm AND mp4 fixtures → valid, smaller `audio/ogg` (Opus mono, voice bitrate); output MIME `audio/ogg`. _(webm 4107→3791 B, m4a 7288→4115 B; ffprobe → opus/1ch.)_
- [x] Safety bounds enforced + tested: input-size guard pre-exec, `ctx` timeout kills ffmpeg, temp files scrubbed on every path, arg-slice exec (no shell string), no audio bytes in logs.
- [x] Unknown MIME / corrupt input / timeout → distinct typed error (`errors.Is`-able) for the caller.
- [x] Startup ffmpeg-availability check fails fast + clear when absent. _(Verified in-container: boot logs "ffmpeg available" before the DB step.)_
- [x] `media.MockTranscoder` exported (success/error/spy) for 6-3b.
- [x] API image carries a pinned ffmpeg (approach (a) static-copy of `mwader/static-ffmpeg:7.1` into distroless-static — documented + human-review-flagged); container builds, boots, and runs `ffmpeg -version` (7.1, `--enable-libopus`). `ci-api` provides ffmpeg (apt install) + a guard step asserts the integration tests are not silently skipped.
- [x] Gates: `go build ./...` + `go vet` clean; `go test ./internal/media/...` green (9 tests, 0 skips); `go test -tags=atdd_red_phase ./internal/media/...` compiles+passes (red suite empty); `docker build` succeeds. ci-api green with ffmpeg present (guard runs on next CI).
- [x] Docs: `manual-setup.md` (ffmpeg requirement + human-review note), `deferred-work.md` (6-3b unblock + reuse + per-retry re-transcode note), completion-notes sibling created.

## Out of Scope

- The `ai_grade_speaking` worker, the Gemini client audio-part extension, enqueue/read/credit — **Story 6-3b**.
- Any tenant/RLS/SEC-8 handling — the caller enforces it before invoking transcode.
- Transcode-result caching (a re-run/retry re-transcodes) — future optimization, noted in deferred-work.
- Transcode for non-speaking audio (knowledge-hub mp3, etc.) — the interface is reusable but only the speaking path is wired here.
- Client-side / upload-time transcode (reopening 5.4) — rejected in favor of this server-side keystone (Ducdo 2026-08-23).

## Change Log

| Date | Version | Change | Author |
|---|---|---|---|
| 2026-08-24 | 1.0 | **Code review (Amelia `/bmad-code-review 6-3b0`, 3 parallel adversarial layers) → `done`.** 1 decision + 7 patch findings resolved, 2 deferred, 3 dismissed. Patches: P1 boot check now verifies the libopus ENCODER (`-encoders` grep), not just `-version` — closes the base-image-regression gap in AC5/D3; P2 arg slice adds `-vn` + `-threads 1` (DoS: no video-stream re-encode, bounded CPU fan-out); P3 check `runErr` before `runCtx.Err()` so a valid transcode isn't discarded on a post-run parent-cancel race + accurate deadline-vs-cancel message; P4 output read cap uses per-instance `MaxInputBytes`; P5 CI guard `set -o pipefail`; P6 empty input → `ErrUnsupportedAudio` pre-exec; P7 ffmpeg exit code logged (metadata, EDGE-4-safe); P8 (Ducdo decision opt.1) NEW `ErrTranscodeUnavailable` transient class for infra faults (start-failure / OOM-signal / disk / parent-cancel / output-read I/O) so 6-3b RETRIES rather than refunding valid work. +3 regression tests (empty-reject, transient-on-start-failure, codec-less boot-check). Gates green: `go build`, `go vet`, `go test ./internal/media/... -race -count=1` (12 tests). Deferred: ffmpeg-child memory rlimit (container-limit + 6-3b duration-guard mitigated); CI-ffmpeg pin (already logged). | Amelia |
| 2026-08-23 | 0.1 | Drafted as a prerequisite keystone extracted from the 6-3b pre-dev party-mode review (Winston/Murat/John/Amelia). **Root cause (verified against ai.google.dev/gemini-api/docs/audio):** Gemini inline audio accepts only wav/mp3/aiff/aac/ogg/flac; the ClassLite recorder produces webm (Chrome/Android) + mp4/m4a (iOS Safari) on ALL devices → transcode is unavoidable. **Ducdo ruling 2026-08-23:** split transcode into this keystone (isolate the ffmpeg/base-image infra change); the "drop-mobile" alternative rejected (format is browser- not device-determined — desktop Chrome still emits webm). Decisions: D1 re-encode to voice-Opus/Ogg (fixes format AND the 20 MB size-cap mismatch); D2 bundled static ffmpeg via arg-slice `os/exec` over scrubbed temp files, size+timeout bounds; D3 base-image change = human-review item; D4 interface + MockTranscoder seam (hermetic 6-3b tests); D5 typed-error classification → caller maps to terminal `audio_unavailable`+refund. | Amelia |

## Review Findings

_Adversarial code review 2026-08-24 (Amelia, `/bmad-code-review 6-3b0`) — 3 parallel layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor). All findings verified against real source. 1 decision-needed, 7 patch, 2 defer, 3 dismissed._

- [x] [Review][Patch] Add a transient error class (`ErrTranscodeUnavailable`) for infra faults — OOM-kill (signaled, not the ctx-timeout), disk-full, and `MkdirTemp`/`WriteFile` failures currently collapse into terminal `ErrTranscodeFailed` (→ 6-3b terminal `audio_unavailable`+refund of valid work). Split so 6-3b can retry infra faults instead of refunding. _(Decision resolved 2026-08-24, Ducdo: option 1 — add the class now; widens the AC4 contract deliberately.)_ [classlite-api/internal/media/transcode.go:157-167, 192-194]
- [x] [Review][Patch] Startup check verifies `ffmpeg -version` only, not libopus/ogg encode capability — a codec-less ffmpeg passes boot then fails every job, defeating AC5/D3 fail-fast intent [classlite-api/internal/media/transcode.go:218-231]
- [x] [Review][Patch] ffmpeg arg slice lacks `-vn` (+ `-threads 1`) — an untrusted `audio/webm` carrying a video stream gets its video re-encoded → CPU-amplification DoS on a DoD-mandatory bound (AC3/D2) [classlite-api/internal/media/transcode.go:174-181]
- [x] [Review][Patch] Successful transcode discarded on ctx-cancel race + misleading message — `runCtx.Err()` checked before `runErr`, so a valid transcode whose parent ctx cancels post-run is thrown away and misreported as "killed after 30s" [classlite-api/internal/media/transcode.go:187-194]
- [x] [Review][Patch] Output read cap uses the package constant, not per-instance `t.maxInputBytes` — the "output bounded by input cap" invariant breaks for any non-default `MaxInputBytes` [classlite-api/internal/media/transcode.go:196]
- [x] [Review][Patch] CI AC7 guard pipes `go test` through `tee` — a non-zero test exit (build failure/panic) is swallowed; only `grep` gates the build. Add `set -o pipefail` [.github/workflows/ci-api.yml:83-96]
- [x] [Review][Patch] Zero-byte input not rejected pre-exec — an empty payload passes the guards, writes a temp file, and forks ffmpeg only to fail; reject as `ErrUnsupportedAudio` before touching disk [classlite-api/internal/media/transcode.go:151]
- [x] [Review][Patch] ffmpeg exit code discarded on failure — the codec-less/OOM failure modes above are undiagnosable in prod; log the exit code as metadata (EDGE-4-safe: code, not stderr bytes) [classlite-api/internal/media/transcode.go:192-194]
- [x] [Review][Defer] No memory rlimit on the ffmpeg child (decompression-bomb residual after `-vn`/`-threads 1`) [classlite-api/internal/media/transcode.go:174-181] — deferred: mitigated by container limits + 6-3b enqueue-time duration guard (D12)
- [x] [Review][Defer] CI ffmpeg unpinned (`apt-get install ffmpeg`) vs runtime pinned (`mwader/static-ffmpeg:7.1`) [.github/workflows/ci-api.yml:16-19] — deferred: already logged in deferred-work.md (dev of 6-3b0); re-confirmed, not a new item
| 2026-08-24 | 1.0 | **Dev complete → review.** All 8 tasks + DoD green over the existing ATDD red scaffold. Shipped `internal/media` leaf: `AudioTranscoder`/`FFmpegTranscoder` (arg-slice exec, pre-exec MIME+size guards, scrubbed private temp dir, ctx-timeout kill, `errors.Is`-able `ErrUnsupportedAudio`/`ErrTranscodeFailed`, EDGE-4 no-payload logging) + `MockTranscoder` seam + `CheckFFmpegAvailable` boot check wired in `main.go` via `config.FFmpegPath`. Dockerfile bundles pinned static ffmpeg (`mwader/static-ffmpeg:7.1`) into distroless-static (approach (a), **human-review flagged**); `ci-api` installs ffmpeg + guards against silent skip. 9 media tests green (0 skips); Docker image builds/boots/`ffmpeg -version` verified locally (7.1, libopus). Impl record + File List → `6-3b0-…-completion-notes.md`. **Unblocks 6-3b.** | Amelia |

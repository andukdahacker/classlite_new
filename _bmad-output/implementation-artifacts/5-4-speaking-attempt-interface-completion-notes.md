# Story 5.4: Completion Notes

_Implementation record for [`5-4-speaking-attempt-interface.md`](./5-4-speaking-attempt-interface.md). Status: review._

## Dev Agent Record

### Debug Log

- **`erasableSyntaxOnly` bans TS parameter properties.** The `FakeMediaRecorder` mock used `constructor(public stream, …)` → TS1294. Converted to an explicit field + assignment.
- **`react-hooks/refs` forbids reading a ref during render.** `heldBlob` read `uploadedObjectUrlRef.current` in `SpeakingAttemptShell` render. Split into a `uploadedObjectUrl` STATE (render-time `heldBlob`) + a ref mirror (for the "latest committed" reads inside effects/callbacks).
- **Double `/progress` PUT on submit.** `persistUploadedKey` originally flushed on every persist, so the submit path PUT twice (persist-flush + finalize-flush). Split: the submit path lets `finalizeAttempt` flush once (so exactly ONE `/progress` carries the key — E2E-J7-001); the background/reconnect path flushes explicitly for the discrete save-on-upload-success (AC14).
- **`getContent` must read the LIVE cache, not `draft.content`.** The render-lagged `draft.content` closure would miss a key written synchronously right before `flush()`. `getContent` reads `queryClient.getQueryData(attemptKeys.draft(id))` so the single submit-path PUT carries the just-set key.
- **Stale eslint-disable.** `RecordingPreview` had an inline disable for `jsx-a11y/media-has-caption`, a rule not in the project config → "Definition for rule not found" error. Removed (the rule isn't active).
- **Existing 4.4a presign test encoded the OLD 100 MB speaking cap.** `TestPresign_PerFeatureExtensionCaps` used `feature:"speaking"` as a stand-in for 100 MB audio; the 25 MB cap (D3) correctly broke those cases. Re-pointed the 100 MB no-regression cases to `knowledge` and added the speaking 25 MB boundary cases (this IS the intended spec change, not a regression).

### Completion Notes

**All 11 tasks + all ACs + DoD.** Frontend speaking-attempt leaf on the shared 5.2d spine + the 1.2e/4.4a presign→PUT→confirm upload spine, plus an additive backend delta (no `api.yaml`/codegen/migration).

**Task 5 landed first** (the content-agnostic hook promotion) gated on the full writing + attempts suites green (157 tests) + `tsc` clean, before any recorder code — keeping the refactor regression surface out of the feature review.

**Backend delta (Task 1, RED-first, additive Go):**
- `size_caps.go`: `speakingAudioMaxBytes = 25 MiB`; `MaxUploadBytes` now branches on `feature=="speaking"` BEFORE the ext lookup (the ONLY disambiguation of the `.webm`/`.m4a` extensions shared with 100 MB listening). `.m4a` added to `uploadSizeCaps` (listening default) so a stray `.m4a` under another feature is still bounded.
- `upload_allowlist.go`: `.m4a → audio/mp4` (D1; deliberately NOT `.mp4`). Noted the global widening.
- `upload_handler.go` confirm non-knowledge branch: the speaking layer-4 re-check — HeadObject over-cap → best-effort delete + 413; head-error → fail-closed 502 (no phantom delete); delete-fail → `orphaned_object` telemetry. Only for `feature=="speaking"` (imports/avatars keep 1.2e behavior — no regression).
- `submission_service.go` `SaveProgress`: the **AUTHORITATIVE** over-cap gate (D12) on the mandatory `/progress` path. Extracts the incoming `audioKey`, enforces SEC-8 (key prefix == caller's center → else `KeyPrefixMismatchError`/403), requires `feature=="speaking"` (a client can't stash a knowledge key to borrow the laxer cap), HeadObjects → over-cap `FileTooLargeError`/413. Runs OUTSIDE the DB tx (no pooled conn held across the network call). HeadObject failure fails OPEN (the real attack — a lied `sizeBytes` — yields a genuinely over-cap object that HeadObjects fine, so a transient storage error must not cost an honest student their work on the mandatory path). Storage wired via a nil-safe `WithStorage` builder → only `main.go` + the gate test change; the other 3 constructor call sites are untouched (nil storage skips the gate).

**Frontend:** the content model + codec selector + asymmetric reconcile (Task 2); the greenfield `useMediaRecorder` incl. mid-recording interruption + max-duration auto-stop (Task 3); the speaking upload chain + auto-retry 1+3 + in-memory fallback + `beforeunload` (Task 4); the isolated recorder leaf + prep/preview/permission/interruption panels (Task 6); the shell (submit contract, Blob-aware flush-on-flip, offline-gated reconnect, multi-tab, timer) (Task 7); the page + full-bleed sibling route + `attemptRouteForSkill` un-stub (Task 8).

**Key semantics divergence from writing (the source of the party-mode BLOCKERs):** writing's value is always-local text; speaking's is a SERVER-MINTED KEY. So the offline reconcile is ASYMMETRIC (D5): a stale/empty local mirror NEVER blanks a real server key; local wins ONLY when it holds a differing non-empty key (recovering a key whose `/progress` PUT failed after a successful R2 PUT).

**Deferred (see `deferred-work.md`):** FU-5-4-A (`exercise.prepSeconds` field — client `SPEAKING_PREP_SECONDS=60` ships now), FU-5-4-B (IndexedDB-durable un-uploaded Blob — session-only in-memory ships now, `beforeunload`-guarded), speaking superseded-take orphans folded into FU-4-4-6 (the R2 reaper must reconcile speaking keys against `submissions.content.audioKey`, not `files`). 5.5 student-playback handoff note added.

**Deviations / honest notes:**
- No eager upload-on-record-completion (online): uploads happen at submit-intent (`ensureLatestTakeUploaded`) + on reconnect (offline recovery). Simpler + race-free + AC-compliant (AC12 "on submit-intent"); the held take is `beforeunload`-guarded meanwhile.
- No live-text store (unlike writing): the recorder's high-frequency state (rAF meter + elapsed) lives inside the isolated leaf; the shell receives only the settled take via a stable callback, so `getContent` reads the low-frequency draft cache.
- Pre-existing eslint debt (NOT introduced by 5.4, confirmed by stashing this story's work): 5 `no-unused-vars` errors in `e2e/bulk-student-import.spec.ts` + 2 `react-hooks/incompatible-library` warnings in `features/exercises/AIGenerateDialog.tsx`. `eslint .` exits 1 on the repo at HEAD independent of this story; the 5.4 diff itself is lint-clean.

### Implementation Plan (as executed)

1. Task 0 — pre-flight recon (3 parallel Explore agents: spine / writing template / upload+backend change sites).
2. Task 5 — promote `useOnlineStatus`/`useAttemptBroadcast`/`useWritingReadOnly`→`useAttemptReadOnly` into `attempts/` (git mv + barrel + rewire writing); gate: writing+attempts suites green + tsc.
3. Task 1 — backend RED→GREEN: size_caps + allowlist unit → presign → confirm re-check → `/progress` gate; full `go test ./...` green (no regression).
4. Task 2 — `speakingContent.ts` (RED→GREEN, 15 unit tests).
5. Task 3 — `useMediaRecorder` (RED→GREEN, 13 tests) + controllable media mock + vitest-setup safety-net globals.
6. Task 4 — `uploadSpeakingAudio` + `useSpeakingUpload` + `useBeforeUnloadGuard` (RED→GREEN, incl. the 4-key count oracle + abort-mid-retry).
7. Task 6/7/8 — UI components → shell → page → route → un-stub; `tsc` + `eslint` clean.
8. Task 10 — i18n `speaking.*` en+vi (parity 1620) + integration tests (leaf 10, shell 10, page 10) + assignments un-stub tests.
9. Task 9 — epic-05 amendments + deferred-work FUs + 5.5 handoff.

## File List

### Added — frontend
- `classlite-web/src/features/speaking-attempt/index.ts`
- `classlite-web/src/features/speaking-attempt/SpeakingAttemptPage.tsx`
- `classlite-web/src/features/speaking-attempt/lib/speakingContent.ts`
- `classlite-web/src/features/speaking-attempt/hooks/useMediaRecorder.ts`
- `classlite-web/src/features/speaking-attempt/hooks/useSpeakingUpload.ts`
- `classlite-web/src/features/speaking-attempt/hooks/useBeforeUnloadGuard.ts`
- `classlite-web/src/features/speaking-attempt/api/uploadSpeakingAudio.ts`
- `classlite-web/src/features/speaking-attempt/api/useSpeakingDraft.ts`
- `classlite-web/src/features/speaking-attempt/components/{CueCardPrompt,RecordingButton,PrepCountdown,RecordingPreview,MicPermissionPanel,RecordingInterruptedPanel,SpeakingRecorderLeaf,SpeakingSubmitDialog,SubmittedElsewhereOverlay,SpeakingAttemptShell}.tsx`
- `classlite-web/src/features/speaking-attempt/test/mockMediaRecorder.ts`
- Tests: `lib/__tests__/speakingContent.test.ts`, `hooks/__tests__/{useMediaRecorder,useSpeakingUpload}.test.tsx`, `api/__tests__/uploadSpeakingAudio.test.ts`, `components/__tests__/{SpeakingRecorderLeaf,SpeakingAttemptShell}.test.tsx`, `__tests__/SpeakingAttemptPage.test.tsx`

### Added — backend tests
- `classlite-api/internal/service/size_caps_speaking_test.go`
- `classlite-api/internal/handler/upload_confirm_speaking_atdd_test.go`
- `classlite-api/internal/test/submission_progress_speaking_cap_test.go`

### Moved (git mv, Task 5) — into `classlite-web/src/features/attempts/hooks/`
- `useOnlineStatus.ts`, `useAttemptBroadcast.ts` (from `writing-attempt/hooks/`)
- `useWritingReadOnly.ts` → `useAttemptReadOnly.ts` (renamed export + interfaces; self-import → sibling `../lib/attemptReadOnly`)
- + their `__tests__/` counterparts

### Modified — backend (additive Go)
- `classlite-api/internal/service/size_caps.go` — speaking cap + `.m4a` + feature-branch
- `classlite-api/internal/service/upload_allowlist.go` — `.m4a → audio/mp4`
- `classlite-api/internal/handler/upload_handler.go` — speaking confirm re-check + `log/slog`
- `classlite-api/internal/service/submission_service.go` — `WithStorage` + the `/progress` over-cap gate
- `classlite-api/cmd/api/main.go` — `.WithStorage(uploadStorage)` on the submission service
- `classlite-api/internal/handler/upload_presign_size_atdd_test.go` — 25 MB speaking cases + 100 MB re-point
- `classlite-api/internal/test/submission_lifecycle_service_test.go` — mock storage wired into `subEnv`

### Modified — frontend
- `classlite-web/src/features/attempts/index.ts` — export the 3 promoted hooks
- `classlite-web/src/features/writing-attempt/components/WritingAttemptShell.tsx` — import promoted hooks from the barrel
- `classlite-web/src/features/assignments/lib/assignmentRow.ts` — un-stub `speaking → /speak`
- `classlite-web/src/routes.tsx` — the `/assignments/:assignmentId/speak` full-bleed sibling route
- `classlite-web/src/locales/{en,vi}.json` — `speaking.*` (60 keys)
- `classlite-web/src/test/vitest-setup.ts` — media-capture safety-net globals
- `classlite-web/src/features/assignments/{__tests__/AssignmentsListPage.test.tsx,lib/__tests__/assignmentRow.test.ts}` — speaking un-stub assertions

### Modified — docs
- `_bmad-output/planning-artifacts/epics/epic-05.md` — `.webm`→codec-following (×2); strike `Content-Length-Range`; honest offline copy
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-5-4-A/B + FU-4-4-6 fold + 5.5 handoff
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transitions

## Code-review follow-up pass (2026-08-11) — File List delta

_Implements the 6 behavioral items from the `/bmad-code-review 5-4` Group-4 findings (2 were resolved decisions). Backend untouched._

### Modified — frontend (source)
- `classlite-web/src/features/speaking-attempt/components/SpeakingRecorderLeaf.tsx` — stop recorder on read-only flip mid-take; gate Stop/prep/preview on `disabled`
- `classlite-web/src/features/speaking-attempt/components/RecordingPreview.tsx` — `disabled` prop gates "Record again"
- `classlite-web/src/features/speaking-attempt/components/SpeakingAttemptShell.tsx` — `useBlocker` nav guard + confirm dialog; failed-upload banner + `retryUpload`; `submitWithoutAudio` escape; `inert` background under the foreign overlay; `strandedTake` derived (was effect-set `strandedOffline`)
- `classlite-web/src/features/speaking-attempt/components/SpeakingSubmitDialog.tsx` — `onSubmitWithoutAudio` button (desktop + mobile)
- `classlite-web/src/features/speaking-attempt/components/SubmittedElsewhereOverlay.tsx` — announce via imperative DOM write (eslint-clean); CTA sizing (prior pass)
- `classlite-web/src/features/speaking-attempt/SpeakingAttemptPage.tsx` — reconcile gate via derived `seededId` (was effect-set `reconciled`)
- `classlite-web/src/locales/{en,vi}.json` — +6 keys (`speaking.upload.retryAction`, `speaking.submit.withoutAudio`, `speaking.nav.{leaveTitle,leaveBody,leaveConfirm,leaveStay}`)

### Modified — frontend (tests)
- `.../components/__tests__/SpeakingRecorderLeaf.test.tsx` — AC2 oracle reworked (falsifiable) + read-only-flip-stops-recorder tests
- `.../components/__tests__/SpeakingAttemptShell.test.tsx` — data-router harness; +5 tests (mid-recording flip, inert, failed-banner+retry, submit-without-audio, useBlocker)
- `.../__tests__/SpeakingAttemptPage.test.tsx` — data-router harness (page renders the shell → `useBlocker`)

## A5 Real-Device Release Gate (manual, CI CANNOT retire — Murat)

The `MediaRecorder` pipeline is NOT covered by Playwright WebKit (Playwright WebKit ≠ the iOS Safari media pipeline). CI green ≠ risk retired. Before release, manually verify on **real iPhone Safari** AND **real Android Chrome**:

1. Record → preview → re-record → upload → submit end-to-end; the submitted audio is playable.
2. Codec: iPhone records `.m4a`/`audio/mp4`, Android records `.webm`; both upload with the matching presign contentType.
3. Mic-denial UX: deny permission → the browser-specific panel + the generic fallback line appear (not a crash).
4. **Incoming-call interruption** → the recorder stops cleanly, drops the partial, returns to record-ready with the interrupted panel, NO orphan "● Recording" state (AC11 — the mobile-PRIMARY case).
5. Survives ~30s of tab-backgrounding mid-take without corrupting the recorder state.
6. Submitted audio is playable cross-device / cross-browser (record on iPhone → play on desktop Chrome, and vice versa).

Playwright happy-path smoke is TICKETED, not a correctness gate — do NOT claim "100% E2E coverage" for the recorder.

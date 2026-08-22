# Story 6-3a: Completion Notes

_Implementation record for [`6-3a-speaking-grading-manual.md`](./6-3a-speaking-grading-manual.md). Status: review._

## Dev Agent Record

### Debug Log

- **Grade-response shape (D1 reuse vs speaking keys).** The shipped teacher `gradeResponse` re-marshaled writing-typed structs; a speaking grade's `criterion_scores` JSONB holds speaking keys + timestamp comments, which the writing wire would zero-out (and drop `fluencyCoherence`/`pronunciation`). Resolved by making `gradeResponse.criterionScores`/`comments` **raw JSONB passthrough** (skill-agnostic) — byte-identical for writing (full BE suite green, zero regression), correct for speaking. `GradeView` gained `ScoresRaw`/`CommentsRaw`.
- **Handler decode order (D2).** `decodeClassJSONBody` strict-decodes BEFORE any DB read, so a speaking body would 422 as an unknown field before the skill resolves. Refactored `Grade`/`Revise` to: read raw → `ResolveSubmissionSkill` (RLS-scoped) → strict-decode into the skill struct → dispatch. A decode failure that cleanly matches the OTHER skill → `409 SUBMISSION_SKILL_MISMATCH`; a genuinely malformed body keeps its original 422 (preserves the shipped writing unknown-field contract — verified the two-try classifier against the ATDD).
- **`TeacherGradingView` required fields.** Added `audioUrl`/`audioStatus` as **required** (the BE always emits them, GO-5). Broke the shipped `WritingGradingPage.test` fixture (predated the fields) → added `audioUrl:null, audioStatus:'none'` to it. `tsc -b` clean after.
- **RouteRoleGate reads the singleton queryClient (test seam).** The speaking page ATDD seeded only a local `createTestQueryClient()`, but `useRole()` reads the module-singleton cache — the role gate blocked the dispatch tests. Reconciled the seam by also seeding the singleton (mirrors the shipped `WritingGradingPage.test`) + clearing it in `afterEach`. Assertions unchanged.
- **Global fetch stub vs MSW (test seam).** The page ATDD's `beforeEach` stubbed global `fetch` to a decodable ArrayBuffer (for the waveform decode), which also intercepted `apiFetch`'s grading read → JSON parse failure. Reconciled by delegating `/api/` requests to the real (MSW-patched) fetch inside the stub; the R2 audio still gets the ArrayBuffer. The test's own `server.use(GRADING_PATH)` shows MSW is the intended grading-read boundary.
- **ESLint.** The player's decode effect tripped `react-hooks/set-state-in-effect` (moved the `decoding` reset into the async fn) and `no-restricted-syntax` raw-hex (canvas bar colors now read `--cl-ink-soft`/`--cl-line` via `getComputedStyle`, `currentColor` fallback for jsdom).
- **`-race` flake (not ours).** `internal/service` `TestResetPassword_AC04` deadlocked once under `-race` (deterministic `TenantAID` + parallel DB tests); passed on retry. Untouched by this story — pre-existing flakiness.

### Completion Notes

Manual Speaking grading, full-stack, GREEN. Reuses the 6.1 grade spine (`grades` table, `submission_immutable_after_release` trigger, `current_grades` view, `OverallBand`, outbox, 23505/P0001 translation) **unchanged — no migration (D1)**. Net-new: the from-scratch Web-Audio waveform player (no npm dep) + the teacher audio presign (SEC-8) injected into `GradingService`.

- **BE:** `grading` package speaking twin (`SpeakingCriterionScores` + `ValidateSpeakingCriterionScores` + `OverallBandFromFour` extracted core + `TimestampedComment` + `NormalizeTimestampComments` lenient demote-not-drop + `SpeakingDurationMsFromContent`); `GradeSpeaking`/`ReviseSpeakingGrade`/`assertSpeakingExercise`/`insertSpeakingGradeRow` in `service`; handler decode-raw→resolve-skill→strict-decode→dispatch + `409 SUBMISSION_SKILL_MISMATCH`; `GradingService.WithStorage` + `GetSubmissionForGrading` mints `audioUrl` OUTSIDE the tx (PERF-1) + `audioStatus` hasAudio|none (no HeadObject, D6); `GetTeacherSubmissionAudioURL` refresh route (teacher-of-class authz, zero-mint on gated failure). `main.go:580` rewired `.WithStorage(uploadStorage)` + the new route registered.
- **FE:** `AudioWaveformPlayer` (`computePeaks` pure fn + canvas render + play/pause/seek + 0.5/1/1.5/2× speed + Pin-here button/`P` at `currentTime` speed-independent + keyboard ±5s/±30s/Space/`P` + `aria-live` readout + 404→re-record-vs-transient→retry classification with one re-sign); `GradingRoute` fetch-before-dispatch (lazy Writing/Speaking chunks); `SpeakingGradingPage` (discriminated speaking draft, twinned `speakingOverallBandMath` over `SPEAKING_CRITERION_KEYS`, 2×2 bands, timeline-shaped rail sorted-by-timestamp + general zone, queue prev/next, release/revise); `useGradeSpeaking`/`useReviseSpeakingGrade`/`useTeacherSubmissionAudioUrl`; `en`+`vi` `speakingGrading.*` + `criterion.fluencyCoherence`.
- **WF-8 red-first GREEN:** GradeSpeaking cross-tenant read+write isolation (R1=9), teacher-audio same-tenant-wrong-teacher 403 + zero-mint on BOTH surfaces (R9-novel), SEC-7 skill-mismatch (writing body on speaking → 409, zero persist), writing-path regression guard, immutability reuse + revise new-version, `NormalizeTimestampComments` lenient/degenerate, off-grid 422. FE: MSW three-state, `computePeaks` pure, `AudioContext`/`getContext`/`getBoundingClientRect` stubs, pin-at-2× speed-independent, keyboard, i18n parity, axe, desktop-only, student-path negative.

**Deviations from spec:** (1) grade response is raw-JSONB passthrough (see Debug Log — the `Grade` TS type stays writing-shaped, speaking page casts the runtime grade, documented). (2) Two ATDD harness reconciliations (singleton-role seed + `/api/` fetch delegation) — plumbing only, no assertion change.

**Deferrals** (see `deferred-work.md` §6-3a): the 6-3b/6-3c seam hand-off, the **R3=9 → 6-3b worker WF-8 hard gate**, the UX-DR23 AI-prefill-timing open question, the additive `transcriptRef` (6-3c), the mobile-listen-not-grade seam, and waveform zoom.

### Implementation Plan (as executed)

1. `api.yaml` — `SpeakingCriterionScores` / `TimestampedComment` / `SpeakingGradeInput` / `ReviseSpeakingGradeInput`; grade + revise `requestBody` → `oneOf`; `TeacherGradingView` + `audioUrl`/`audioStatus`; teacher audio-refresh path; `409 SUBMISSION_SKILL_MISMATCH`.
2. `codegen.sh` — only `client.ts` regenerated (openapi-zod-client disabled, D10).
3. `grading` package speaking twin + `OverallBandFromFour` extraction → green the pure-fn ATDD.
4. `service`/handler skill branch + storage injection + audio presign + refresh route + `main.go` wiring → green the DB + handler + authz ATDD (created `story_6_3a_helpers.go` seams).
5. FE `computePeaks` → `AudioWaveformPlayer` → `speakingOverallBand`/`speakingGradingDraft` → hooks → `SpeakingGradingPage`/`GradingRoute` → `routes.tsx` dispatch → `en`/`vi` keys → green all FE ATDD.
6. Gates: `go build`/`vet` clean, BE grading packages green (incl. `-race`); `tsc -b` clean, ESLint clean, **full web suite 2719 passed (0 regressions)**.
7. Docs: epic-06 amendment, `deferred-work.md` §6-3a, this sibling.

## File List

### Added

- `classlite-api/internal/service/grading/speaking.go` — speaking criterion twin, `TimestampedComment`, `NormalizeTimestampComments`, `SpeakingDurationMsFromContent`, skill constants.
- `classlite-api/internal/test/story_6_3a_helpers.go` — `NewGradingHandlerTestServer` + `SeedSpeaking/WritingSubmissionOnPool` seams.
- `classlite-api/internal/handler/speaking_grade_handler_atdd_test.go` — handler decode-order/SEC-7 ATDD (red tag removed).
- `classlite-api/internal/service/grading/speaking_grading_atdd_test.go` — grading pure-fn ATDD (red tag removed).
- `classlite-api/internal/test/speaking_grading_atdd_test.go` — GradeSpeaking DB/RLS ATDD (red tag removed).
- `classlite-api/internal/test/speaking_audio_authz_atdd_test.go` — teacher audio presign authz ATDD (red tag removed).
- `classlite-web/src/components/domain/computePeaks.ts` + `AudioWaveformPlayer.tsx` (+ their `__tests__`).
- `classlite-web/src/features/grading/GradingRoute.tsx`, `SpeakingGradingPage.tsx`.
- `classlite-web/src/features/grading/lib/speakingOverallBand.ts`, `speakingGradingDraft.ts` (+ their `__tests__`).
- `classlite-web/src/features/grading/api/useGradeSpeaking.ts`, `useReviseSpeakingGrade.ts`, `useTeacherSubmissionAudioUrl.ts`.
- `classlite-web/src/features/grading/__tests__/SpeakingGradingPage.test.tsx`, `story-6-3a-i18n.test.ts`.

### Modified

- `classlite-api/api.yaml` — speaking schemas, `oneOf` grade bodies, `TeacherGradingView` audio fields, refresh path, 409 code.
- `classlite-api/internal/service/grading/scorer.go` — extracted `OverallBandFromFour([4]float64)`; `OverallBand` delegates.
- `classlite-api/internal/service/grading_service.go` — `WithStorage`, `GradeSpeaking`/`ReviseSpeakingGrade`, `assertSpeakingExercise`, `insertSpeakingGradeRow`, `ResolveSubmissionSkill`, `GetTeacherSubmissionAudioURL`, `GetSubmissionForGrading` audio mint, `GradeView` raw fields.
- `classlite-api/internal/handler/grading_handler.go` — skill-branch decode, speaking bodies/converter, raw-passthrough grade response, `GetTeacherAudio`, audio-view fields.
- `classlite-api/cmd/api/main.go` — `.WithStorage(uploadStorage)` + audio-refresh route.
- `classlite-web/src/lib/api/client.ts` — regenerated (codegen).
- `classlite-web/src/features/grading/index.ts` — barrel exports (dispatcher, speaking page, hooks, band lib).
- `classlite-web/src/routes.tsx` — grading detail route → `GradingRoute` dispatcher.
- `classlite-web/src/locales/en.json`, `vi.json` — `speakingGrading.*` (20 keys) + `criterion.fluencyCoherence`.
- `classlite-web/src/features/grading/__tests__/WritingGradingPage.test.tsx` — fixture gains `audioUrl:null`/`audioStatus:'none'` (contract change).

### Deleted

None.

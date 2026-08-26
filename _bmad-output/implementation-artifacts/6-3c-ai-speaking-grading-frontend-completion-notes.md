# Story 6-3c: Completion Notes

_Implementation record for [`6-3c-ai-speaking-grading-frontend.md`](./6-3c-ai-speaking-grading-frontend.md). Status: review._

## Dev Agent Record

### Debug Log

- **localStorage leak across page tests.** `SpeakingGradingPage.ai.test.tsx` initially failed 4/7 because the run→enqueue test persists an in-flight jobId under `classlite:ai-grade-job:{sid}`, which the hook seeds on the next mount → phase `generating` → the rehydrate path (`phase==='idle'`) never resolves the class-shared suggestion. Fixed by `localStorage.clear()` in `beforeEach` (mirrors the hook test).
- **`ApiError` constructor arg order.** Panel test built `new ApiError('msg', 409, code, req)`; the real signature is `(status, code, message, requestId)`. Corrected.
- **`<article>` directly under `<ol>`.** The interleaved rail placed `AiMomentCard` (an `<article>`) as a direct `<ol>` child (invalid list content / axe `list`). Wrapped each moment entry in an `<li>`.

### Completion Notes

Thin FE layer over three shipped surfaces (6-3a s24 view, 6-3b AI backend, 6-2b machinery). All 8 tasks + all DoD items GREEN. The two staged red-phase ATDD files (`useAiGradeSpeakingJob.test.tsx`, `story-6-3c-i18n.test.ts`) both turned green on Tasks 1 + 6.

**Deviations from the task wording (all deliberate, sanctioned by the story):**

1. **The PAGE mounts `useAiGradeSpeakingJob`; the panel is presentational (receives `aiJob`).** Task 4 said "mount the hook in the panel," but the **interleaved timeline** (SD5/O1 — AI moments render inline in the page-owned `NotesRail`, not a separate panel) forces the live poll result to be available at the page level. So the page owns the hook + review orchestration (accepted/dismissed/editing sets, moment interleave, draft merge, two-signal rehydrate) and the panel renders the run control + confirm dialog + states + band strip + transcript + toasts from props. A 6-2b-style separate-panel layout would have kept the hook in the panel. This is the honest architecture for the interleave and cleanly satisfies the page-level ACs (rehydrate AC12, non-triggering-no-poll AC13, live interleave AC6).
2. **`AiAvatar` + `ConfidenceBadge` extracted to `AiSuggestionChrome.tsx`** (the story sanctioned "extract to a shared spot if cleaner"). `ConfidenceBadge` takes a `keyPrefix` defaulting to `grading.ai.confidence`, so every shipped Writing call site is byte-identical (verified: 31/31 writing AI tests green); Speaking passes `speakingGrading.ai.confidence`.
3. **The 4 speaking criterion keys + `isValidBand` are inlined in `AISpeakingGradeSuggestion.tsx`** rather than imported from `speakingOverallBand.ts` — FW-7 (a `domain/` component must not import a feature lib) + the shipped writing `AIGradeSuggestion` precedent (which inlines for the same reason). The inlined union is structurally identical to `SPEAKING_CRITERION_KEYS`, so the page's proposals are assignable without a cast. (Task 3 literally said "use `SPEAKING_CRITERION_KEYS` from `speakingOverallBand.ts`"; inlining honors the stronger FW-7 constraint + precedent — pragmatic interpretation.)
4. **Generic terminal failures (`stuck_timeout`/`max_retries_exhausted`/`generation_failed`) show an inline "grade manually" message, no toast.** The story defines refund toasts only for `audio_unavailable` (SD8) + `invalid_ai_response` (AC17); there is no `speakingGrading.ai.toast.failed` key. Avoids a wrong-copy / undefined-key toast. Logged in `deferred-work.md`.

**Merge integrity (AC9 — the mandatory leak-guard):** an accepted AI moment becomes a `SpeakingDraftComment{source:'ai'}` with **only** `{type,criterion,timestampMs,text}` — `confidence` is dropped at the AiMomentCard accept callback (never enters the draft), and `source` is stripped by the shipped `buildSpeakingGradeInput()`. Proven end-to-end in `SpeakingGradingPage.ai.test.tsx` (the grade-write body carries no `source`/`confidence`/`rationale`) and locked on the student surface by `resultSpeaking-ai-negative.test.tsx`.

**Gates:** `tsc -b` clean (exit 0, includes test files); ESLint clean on all changed files; **full web suite 2818 passed / 208 files (0 regressions; +94 new tests)**. No `codegen.sh` (contract fixed by 6-3b — zero generated-file edits).

### Implementation Plan (as executed)

1. Recon: read the two staged red tests + the ATDD checklist, then every reuse anchor (`useAiGradeJob`, `AiGradePanel`, `AIGradeSuggestion`, `WritingGradingPage` accept wiring, `SpeakingGradingPage`, `speakingGradingDraft`, `speakingOverallBand`, `AudioWaveformPlayer`, `CommentCard`, `useGradingSubmission`, generated speaking types, locale structure).
2. Task 1 — `useAiGradeSpeakingJob` twin → red hook test green (17).
3. Task 2 — `WaveformPin.source` additive widening + `markerColor` branch → 6-3a waveform test unchanged (14).
4. Task 3 — `AiSuggestionChrome` extraction (writing refactored, 31 green) + `AISpeakingGradeSuggestion` (`AiSpeakingBandStrip` + `AiMomentCard`).
5. Task 4 — `AiSpeakingGradePanel` (presentational) + export `AiGradeConfirmDialog`.
6. Task 6 — 40 `speakingGrading.ai.*` keys in en + vi → i18n red test green (45).
7. Task 5 — page wiring: hook mount, two-signal rehydrate, review sets, band/moment proposals, accept handlers (band→scores, moment→draft w/ confidence dropped), merged pins w/ source, `NotesRail` interleave.
8. Task 7 — 4 green-alongside suites (domain 10, panel 14, page 7, student-negative 1).
9. Task 8 — this file + `deferred-work.md`.

## File List

### Added

- `classlite-web/src/features/grading/hooks/useAiGradeSpeakingJob.ts`
- `classlite-web/src/components/domain/AiSuggestionChrome.tsx`
- `classlite-web/src/components/domain/AISpeakingGradeSuggestion.tsx`
- `classlite-web/src/features/grading/components/AiSpeakingGradePanel.tsx`
- `classlite-web/src/components/domain/__tests__/AISpeakingGradeSuggestion.test.tsx`
- `classlite-web/src/features/grading/components/__tests__/AiSpeakingGradePanel.test.tsx`
- `classlite-web/src/features/grading/__tests__/SpeakingGradingPage.ai.test.tsx`
- `classlite-web/src/features/submission-review/__tests__/resultSpeaking-ai-negative.test.tsx`
- `classlite-web/src/features/grading/hooks/__tests__/useAiGradeSpeakingJob.test.tsx` (staged red-phase ATDD → green on Task 1)
- `classlite-web/src/features/grading/__tests__/story-6-3c-i18n.test.ts` (staged red-phase ATDD → green on Task 6)

### Modified

- `classlite-web/src/components/domain/AudioWaveformPlayer.tsx` — `WaveformPin.source?` widening + `markerColor()` branch + `data-source` on markers (additive; teacher-pin render byte-unchanged when `source` absent).
- `classlite-web/src/components/domain/AIGradeSuggestion.tsx` — local `AiAvatar`/`ConfidenceBadge` extracted to `AiSuggestionChrome` (behavior identical; default `keyPrefix`).
- `classlite-web/src/features/grading/components/AiGradePanel.tsx` — `export` the skill-agnostic `AiGradeConfirmDialog` for reuse (SD4).
- `classlite-web/src/features/grading/SpeakingGradingPage.tsx` — mount `AiSpeakingGradePanel`; session-edited `draftTouched` gate; AI review orchestration; `NotesRail` interleave of AI moment cards; merged `pins` (teacher ∪ AI, sourced); accept handlers.
- `classlite-web/src/locales/en.json` — 40 `speakingGrading.ai.*` keys.
- `classlite-web/src/locales/vi.json` — 40 `speakingGrading.ai.*` keys (interpolation-token parity preserved).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 6-3c ready-for-dev → in-progress → review.
- `_bmad-output/implementation-artifacts/deferred-work.md` — O2/O3 + minor deferrals.
- `_bmad-output/implementation-artifacts/6-3c-ai-speaking-grading-frontend.md` — task/DoD checkboxes, Status, Change Log.

### Deleted

- (none)

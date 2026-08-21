# Story 6-2b: Completion Notes

_Implementation record for [`6-2b-ai-assisted-writing-grading-frontend.md`](./6-2b-ai-assisted-writing-grading-frontend.md). Status: review._

## Dev Agent Record

### Debug Log

- **Pre-existing baseline break fixed.** `tsc -b` (the `build` gate — `tsconfig.app.json` includes `src`, so test files ARE type-checked; a bare `tsc --noEmit` against the solution-style root config compiles an empty program and misleads with 0 errors) failed at baseline: `WritingGradingPage.test.tsx` `gradingView()` omitted the `aiSuggestion` field 6.2a made **required** on `TeacherGradingView`. Added `aiSuggestion: null` to the fixture — in-scope since 6.2b is the FE consumer of that field.
- **`jobKeys` reuse under TS-7.** The 4.3b `jobKeys` lived at `features/exercises/api/jobKeys.ts` but was NOT on the exercises barrel; a deep cross-feature import violates TS-7. Exported `jobKeys` from `@/features/exercises` and imported it there — the two ai-job consumers now share the one `['jobs', jobId]` poll cache slot (FD1).
- **`react-hooks/set-state-in-effect` lint error.** The first cut fired the AC12 ready-overlay + collapse from a phase-transition `useEffect` (`setReadyOverlay`/`setCollapsed`). ESLint (React 19 rule) rejects synchronous setState in an effect. Refactored to the React-sanctioned "adjust state while rendering" pattern (a guarded `setPrevPhase` + conditional setState during render); the genuinely side-effecting refund toasts stay in a setState-free effect.
- **Fake-timer reveal in the first-run test.** `vi.advanceTimersByTime` fired the simulated-reveal `setTimeout` but the React state flush needed wrapping in `act(...)` — otherwise the revealed grade never committed before the assertion.
- **axe `landmark-unique`.** The panel `<section aria-label="AI suggestions">` wrapping the `AIGradeSuggestion` `<section aria-label="AI suggestions">` produced two same-named landmarks. Made the `AIGradeSuggestion` root a non-landmark `<div>` (the parent panel provides the labelled region + heading), dropping the now-redundant inner header.

### Completion Notes

Thin FE layer over the shipped 6.2a backend + 6.1 s23 view + 4.3b hook template, exactly as scoped — no backend, no `api.yaml`/`codegen.sh`, no generated-type edits.

Shipped:
- **`useAiGradeJob`** (`features/grading/hooks/`): verbatim clone of `useAiGenerationJob` diffing only the empty-body enqueue endpoint, the `asWritingGradeResult` narrowing (`'criteria' in result`), 200≡202 idempotent handling, and the elapsed `slowLevel` (0/1/2 at 30s/60s) for AC11. Reuses `jobKeys` for the poll.
- **`DraftComment.source`** (`gradingDraft.ts`): client-only `'ai'|'teacher'` marker; `commitComposer`/`draftFromGrade` set `'teacher'`; `buildGradeInput()` continues to emit only the wire `AnchoredComment` fields (no `source`/`confidence`/`rationale`) — proven by the full-page strip test.
- **`AIGradeSuggestion`** (`components/domain/`, + stories + tests): band-strip proposals + rail AI cards composing `CommentCard` chrome, gradient AI avatar, teacher-only confidence/rationale, per-item Accept/Edit/Dismiss, "Accept all praise", analysed-meta line, disclaimer.
- **`AiGradePanel`** (`features/grading/components/`): owns the job + review UI; the "Run AI grading" control + `AiGradeConfirmDialog` (−1 credit + re-run warning, FD4, no auto-enqueue), generating skeleton + slow messaging, stuck/failed inline retry, invalid-scores empty-form message, refund toasts, the non-blocking ready overlay, and the two-signal rehydrate (poll for the triggerer, `view.aiSuggestion` for reopen/non-triggering — never the creator-private poll for a non-creator).
- **Workspace wiring** (`WritingGradingPage.tsx`): accept handlers merge into the durable draft (bands → `draft.scores`, comments → `DraftComment{source:'ai'}` with reopen dedup, AC9); `draftDirty` gates the overlay.
- **First-run card** (`FirstAIGradeCard.tsx`): upgraded to the SIMULATED (O1/FD8) run — CTA → animated ~18s analysing → fixture reveal, `prefers-reduced-motion` collapses to instant, no modal, no `useAiGradeJob`, no credit.
- **i18n**: 41 `grading.ai.*` + 4 `dashboard.aiSample.*` keys in en + vi; `STORY_6_2B` closed-literal + prefix-ratchet + interpolation parity test; the VN progress string pinned to `"AI đang phân tích bài viết…"`.

Open-question defaults taken (all non-blocking): **O2** — disclaimer em-dash contract copy (`"Suggestion — teacher always decides the final band."`). **O3** — overall-band typography reuses the 6.1 Geist Mono `text-2xl` treatment (FD6.3), not the Geist Mono 28px catalog value.

Deviations / notes:
- **Pre-existing lint debt (NOT introduced here):** `eslint .` reports 5 errors in `e2e/bulk-student-import.spec.ts` (unused `_page`/`_role` params) + 2 RHF `watch` warnings in `AIGenerateDialog.tsx` — both files untouched by this story. All 6.2b files lint clean.
- Per-comment "accepted/dismissed" review state is session-only (ephemeral UI); correctness across remount is guaranteed by the workspace's accept-time dedup against the persisted draft, so a reopened suggestion can never double-merge.

### Implementation Plan (as executed)

1. Recon of all reuse anchors (hook template, grading page/draft/anchors, domain chrome, generated types, student path, i18n).
2. Baseline capture (`tsc -b` → 1 pre-existing error) + T5 foundations (`gradingKeys.aiGradeMutation`, `jobKeys` barrel export).
3. T1 hook + test (13) → green.
4. T2 draft `source` + constructor/fixture updates.
5. T3 `AIGradeSuggestion` + test (10) + stories.
6. T7 i18n keys (en + vi) + first-run keys.
7. T4 `AiGradePanel` + workspace wiring.
8. T6 first-run simulated upgrade + test rewrite (8).
9. T8 panel integration test (17) + full-page merge/strip (AC8) + student-negative + `STORY_6_2B` parity.
10. Full regression: `tsc -b` 0 · vitest 2650 passed · i18n parity OK · lint clean (own files).

## File List

### Added
- `classlite-web/src/features/grading/hooks/useAiGradeJob.ts`
- `classlite-web/src/features/grading/hooks/__tests__/useAiGradeJob.test.tsx`
- `classlite-web/src/features/grading/components/AiGradePanel.tsx`
- `classlite-web/src/features/grading/components/__tests__/AiGradePanel.test.tsx`
- `classlite-web/src/components/domain/AIGradeSuggestion.tsx`
- `classlite-web/src/components/domain/AIGradeSuggestion.stories.tsx`
- `classlite-web/src/components/domain/__tests__/AIGradeSuggestion.test.tsx`
- `classlite-web/src/features/grading/__tests__/story-6-2b-i18n.test.ts`
- `classlite-web/src/features/submission-review/__tests__/aiChromeAbsent.test.tsx`
- `_bmad-output/implementation-artifacts/6-2b-ai-assisted-writing-grading-frontend-completion-notes.md` (this file)

### Modified
- `classlite-web/src/features/grading/WritingGradingPage.tsx` — mount `AiGradePanel`; accept-into-draft handlers (+dedup); `draftDirty`; `draftFromGrade`/`commitComposer` set `source:'teacher'`.
- `classlite-web/src/features/grading/lib/gradingDraft.ts` — `DraftComment.source` (client-only).
- `classlite-web/src/features/grading/api/gradingKeys.ts` — `aiGradeMutation(submissionId)`.
- `classlite-web/src/features/exercises/index.ts` — export `jobKeys` (TS-7 barrel reuse).
- `classlite-web/src/features/dashboard/FirstAIGradeCard.tsx` — simulated first-run flow (FD8).
- `classlite-web/src/features/dashboard/FirstAIGradeCard.stories.tsx` — CTA-driven variants.
- `classlite-web/src/locales/en.json` + `vi.json` — `grading.ai.*` + first-run keys.
- `classlite-web/src/features/grading/__tests__/WritingGradingPage.test.tsx` — `aiSuggestion:null` fixture fix; AI merge + wire-strip test.
- `classlite-web/src/features/grading/lib/__tests__/gradingDraft.test.ts` — `source` on fixtures.
- `classlite-web/src/features/dashboard/__tests__/FirstAIGradeCard.test.tsx` — rewritten for the 3-phase flow.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 6-2b → in-progress → review.
- `_bmad-output/implementation-artifacts/deferred-work.md` — 6.2b hand-off closed.

### Deleted
- None.

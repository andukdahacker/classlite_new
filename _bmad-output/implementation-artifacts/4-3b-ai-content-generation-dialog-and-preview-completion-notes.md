# Story 4-3b: Completion Notes

_Implementation record for [`4-3b-ai-content-generation-dialog-and-preview.md`](./4-3b-ai-content-generation-dialog-and-preview.md). Status: review._

## Dev Agent Record

### Debug Log

- **Pre-dev contract audit (blocking-decision resolved).** 4.3a's frozen enqueue handler (`internal/handler/ai_generation_handler.go`) strictly decodes params (`DisallowUnknownFields`), so the section form's AC1 chips (type/band/count/mix) **cannot** be sent as structured fields — they would 422. Ducdo chose the **pragmatic (compose-into-prompt)** option: section chips compose client-side into the single `topic` free-text string; questions/distractors send only their consumable `count`. Non-consumable AC1 chips (questions topic/type, distractors difficulty) dropped → FU-4-3-B.
- **Id-less content model.** 4.2's `ExerciseContent` sections/groups/questions have **no id fields** (array-index ordering). The contract's required `sectionId`/`questionId` are validated non-empty by the enqueue handler but the worker **ignores their value** (insertion is 4.3b's client-side act). We send index-based handles and target the same index on Accept. → FU-4-3-B.
- **No credit-balance read endpoint.** 4.3a minted `ai_credit_ledger` but exposed no GET balance endpoint (that's 6.5). The credit counter is display-only per the story; wired through a single `useAiCredits` seam (total from plan constant, `used` placeholder) for 6.5 to replace. → FU-4-3-B.
- **Baseline re-set.** Frontmatter `baseline_commit` was `636556e` (set at story creation, before 4-3a merged). Re-set to `e28849` (current HEAD, the true pre-4-3b commit) so the eventual code-review diff excludes 4-3a. Deviates from the dev-story "preserve existing baseline" rule for correctness; flagged to Ducdo.

### Completion Notes

**Shipped (all 7 ACs):**

- **T1 — `useAiGenerationJob`** (+ `jobKeys` factory): enqueue mutation → `POST /api/exercises/{id}/ai-generate` (202 jobId), then a `useQuery` poll of `GET /api/jobs/{jobId}` with **client-driven progressive backoff 2→4→8s** (computed from the poll count; ×3 slower while `document.hidden`; `refetchIntervalInBackground:true`). `staleTime:0` (the one justified FW-3 deviation). Stops on terminal (`refetchInterval:false` + `refetchOnWindowFocus/Reconnect:false`), on `cancel()`, and on unmount (it's a `useQuery`, so **no `setInterval` to leak** — FW-4). Derived `phase: idle|generating|preview|stuck|failed`; `errorKind` splits `invalid_ai_response` from `generation_failed` (AC5). **5-min stuck is a dedicated `setTimeout`** keyed to the job (auto-cleared) — precise at the threshold, unlike an elapsed-from-last-poll derivation which lands up to 8s late (that was the initial red-test failure). `elapsedMs` was dropped (unused; reading a ref in render tripped `react-hooks/refs`). 8 hook tests.
- **T2 — `AIGenerateDialog`** (feature root, story path) + `AiGenerationPreview` + `AiChipGroup` + `useAiCredits` + `lib/aiGeneration.ts`: Base-UI `Dialog` (native focus-trap + return-focus), RHF + `zodResolver` per-mode forms, chips as accessible `aria-pressed` button groups. Est-cost + display-only credit counter (ICU `{{used}}/{{total}}`). State panels: generating (spinner + `aria-live`), preview (Accept/Edit/Dismiss/Regenerate), stuck (Cancel and retry), failed (two **distinct** messages — invalid→adjust-the-prompt, generic→retry-or-manual-link). Section chips compose into the `topic` seed; questions/distractors are count-only. 13 dialog tests (incl. axe on the config form, i18n parity + interpolation parity).
- **T3 — wiring + merge**: 6th "Generate section" AI card on `SectionTypePicker`; "Generate questions" trigger on group-hosting sections; per-question "Generate distractors" on MCQ questions. `lib/fragmentMerge.ts` (`mergeGeneratedFragment`) appends sections / appends groups to the target section / lifts distractor options onto the target question — all pure/immutable. `ExerciseEditorPage` hosts the dialog, threads the target coordinates, and on Accept merges + persists **via 4.2's `useExerciseAutosave`** (no new write path). 4 merge unit tests + 2 editor-integration tests (Accept → exactly one PATCH carrying the merge; Dismiss → zero PATCH).
- **T4 — i18n + tests**: `exercises.ai.*` added to en.json + vi.json (parity + interpolation parity green, 1322 keys). Suite: `tsc -b` clean, `eslint` 0 errors (2 accepted `react-hooks/incompatible-library` warnings on RHF `watch()` — same pattern as `ProfileTab.tsx`), **full FE suite 2034/2034 green**, `npm run build` clean.

**Decisions / deviations (all logged FU-4-3-B):**

1. **Compose-into-topic (Ducdo, ratified 2026-07-28):** section chips → `topic` seed because 4.3a strictly decodes params. Questions/distractors AC1 non-consumable chips dropped.
2. **Credit counter is display-only** — no balance endpoint exists (6.5); `useAiCredits` is the seam.
3. **Index-based `sectionId`/`questionId`** — the id-less content model; the worker ignores the value.
4. **Baseline re-set** `636556e`→`e28849` (creation-baseline predated 4-3a) so the review diff excludes 4-3a. Deviates from the dev-story "preserve baseline" rule for correctness — **flagged to Ducdo**.

**Not run in this pass:** the Playwright `e2e/route-bundle-boundaries.spec.ts` (needs a live browser/app). The constraint holds by construction and is confirmed in the build output — the dialog ships inside the existing `ExerciseEditorPage` chunk (no new route).

### Implementation Plan (summary)

1. T1 — `useAiGenerationJob` hook + `jobKeys` factory (enqueue + progressive-backoff poll).
2. T2 — `AIGenerateDialog` (3 modes, RHF+zod, chips→topic compose) + `AiGenerationPreview`.
3. T3 — wire the 3 affordances (AI section card, generate-questions, generate-distractors) + fragment-merge → 4.2 autosave.
4. T4 — `exercises.ai.*` en/vi + component tests.
5. T5 — deferred-work FU-4-3-B + this record.

## File List

_All under `classlite-web/` unless noted._

### Added

- `src/features/exercises/AIGenerateDialog.tsx` — s17 dialog: 3-mode RHF forms, state panels, barrel-exported
- `src/features/exercises/components/ai/AiGenerationPreview.tsx` — result-fragment summary + Accept/Edit/Dismiss/Regenerate
- `src/features/exercises/components/ai/AiChipGroup.tsx` — accessible `aria-pressed` chip group (single + multi)
- `src/features/exercises/hooks/useAiGenerationJob.ts` — enqueue + progressive-backoff poll + derived phase
- `src/features/exercises/hooks/useAiCredits.ts` — display-only credit-counter seam (6.5 swaps this)
- `src/features/exercises/api/jobKeys.ts` — TS-3 `['jobs', jobId]` key factory
- `src/features/exercises/lib/aiGeneration.ts` — modes, chip options, `composeSectionTopicSeed`, `summarizeFragment`
- `src/features/exercises/lib/fragmentMerge.ts` — pure `mergeGeneratedFragment` (section/questions/distractors)
- `src/features/exercises/hooks/__tests__/useAiGenerationJob.test.tsx` — 8 tests
- `src/features/exercises/lib/__tests__/fragmentMerge.test.ts` — 4 tests
- `src/features/exercises/__tests__/AIGenerateDialog.test.tsx` — 13 tests (incl. axe + i18n parity)
- `src/features/exercises/__tests__/AIGenerateDialog.editor.test.tsx` — 2 editor-integration tests (accept→1 PATCH / dismiss→0)
- `_bmad-output/implementation-artifacts/4-3b-…-completion-notes.md` — this record

### Modified

- `src/features/exercises/ExerciseEditorPage.tsx` — hosts the dialog; open-state + insert-target; merge-on-accept via autosave
- `src/features/exercises/components/editor/SectionTypePicker.tsx` — 6th "Generate section" AI card (opt-in prop)
- `src/features/exercises/components/editor/ExerciseSectionCard.tsx` — "Generate questions" trigger + distractors passthrough
- `src/features/exercises/components/editor/QuestionGroupCard.tsx` — per-question "Generate distractors" trigger (MCQ only)
- `src/features/exercises/index.ts` — barrel-export `AIGenerateDialog` + types (TS-7)
- `src/locales/en.json`, `src/locales/vi.json` — `exercises.ai.*` block (en/vi parity)
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-4-3-B (5 items)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 4-3b → in-progress → review
- `_bmad-output/implementation-artifacts/4-3b-…-preview.md` — baseline_commit, Status, Tasks checkboxes, Change Log

### Deleted

_(none)_

## Party-Mode Review Appendix

_(n/a until post-implementation review)_

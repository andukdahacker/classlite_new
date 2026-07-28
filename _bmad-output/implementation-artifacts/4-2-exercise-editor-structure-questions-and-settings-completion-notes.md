# Story 4.2: Completion Notes

_Implementation record for [`4-2-exercise-editor-structure-questions-and-settings.md`](./4-2-exercise-editor-structure-questions-and-settings.md). Status: review._

## Dev Agent Record

### Debug Log

- **Pre-flight (mandatory) — verified 4.1's co-developed inheritance before writing any code.** Confirmed 4.1 shipped: the COMPLETE v1 `ExerciseContent` struct **including top-level `Settings`** (`exercise_content.go`), the `updated_at` optimistic-concurrency precondition on `PATCH` (428 missing / 409 stale / 413 oversize), the scope gates (teacher 404 / student 403), `editorStore.ts` (built unwired), dnd-kit deps, and the `/exercises` route + gate + hooks. The only backend gap was semantic validation (T1) — exactly as the story predicted.
- **Corrected a stale `baseline_commit`.** The story frontmatter carried `752bbd5` (story 3-5), captured at story-CREATION before 4.1 merged. Reset to HEAD `c970fee` (4-1 done) so the review diff scopes to 4.2 alone, not all of 4.1.
- **Go source rejected raw zero-width / BOM runes mid-file** ("illegal byte order mark") in `isZeroWidth`. Switched to `​/‌/‍/﻿` escapes.
- **Handler test package boundary.** The 4.1 handler tests use `package handler_test` (external); my content-validation test initially used `package handler` → the shared helpers (`setupExerciseHandlerTest`, `createExercise`, `populatedContent`) were undefined. Fixed to `handler_test`.
- **Frontend test timing.** Fake timers deadlock RTL `findBy` (its poll interval never advances), hanging the suite. Switched the whole editor suite to real timers + a real ~1.6s `settleAutosave` wait.
- **409 conflict banner is transient** (it clears once the reload resolves within the debounce+reload window), so the test asserts the DURABLE outcome — a refetch happened (getCount ≥ 2) and local state re-seeded to the fresh server title — instead of racing the flashing banner.
- **KeyBadge raw hex** tripped the `no-restricted-syntax` token lint; switched to `--cl-tint-green` / `--cl-green` tokens (the `WriteDocSurface` precedent).

### Completion Notes

- **Backend (T1–T4):** `ValidateExerciseContent` (`exercise_content_validate.go`) enforces every AC7 invariant — section/group type ∈ set, Writing/Speaking no groups, ≥1 question/group, MCQ ≥2 options + no-dup + blank-option + correct∈options, Matching non-empty-bank + correct∈bank, T/F/NG correct∈triad, Gap-fill/Short-answer correct non-blank after trim **+ zero-width/BOM normalization** (Murat — a `len>0` check is not validity), and per-collection caps (named constants) → typed `model.ValidationError` (422), never a panic. Wired into `exercise_service.go` `Update` **before the tx** (fail-fast, DB-free). api.yaml `content` fleshed out into named `ExerciseContent`/`ExerciseSection`/`QuestionGroup`/`ExerciseQuestion`/`ExerciseSettings` schemas (+ `ExerciseSectionType`/`QuestionGroupType` enums) → `codegen.sh` regenerated `client.ts`. Tests: 16 validation rows + collection caps + no-panic + multi-error collection (store); a **shared golden fixture** (`exercise-content.golden.json`) the Go golden test marshal-compares AND the FE imports (two-sided drift gate); semantic-422 / settings-round-trip / content-deep-equals through the real handler+middleware.
- **Frontend (T5–T11):** two-panel `ExerciseEditorPage` (own Rolldown chunk, verified `ExerciseEditorPage-*.js` 45.76 kB in `dist/`) with the trilogy (skeleton / error+retry / 404). `useExerciseАutosave` — non-optimistic debounced (1500ms) document PATCH carrying the tracked `updated_at` precondition (advances on each success), validity-gated (blank title → `unsaved`, no save), 409 → reload fresh state, out-of-order `saveSeq` guard. **Saves fire from edit handlers, never a document-watching effect** — so the FW-4 loop class is structurally impossible and a zero-edit load fires zero PATCHes (tested). `EditorAutoSaveIndicator` renders the five states, announcing transitions only (not the tick). Metadata sidebar (no RHF, FW-8), 5 section cards (type-appropriate content field; Listening = audio-URL + validity + `<audio>` preview + honest helper; Writing/Speaking prompt-only), 5 question editors per their interaction contracts (Matching = two-column shared-bank ↔ per-item select; correct = green "✓ KEY"), settings panel, reorder via dnd-kit (pointer + KeyboardSensor) **and** move-up/down buttons at all three levels. 4.1's "Edit" row action repointed to `navigate('/exercises/:id/edit')`; post-create redirects into the editor (`onCreated`). 100 `exercises.editor.*` keys added to en + vi (parity 1271/1271, incl. distinct `savedJustNow`/`vừa xong`). 15 editor component tests (MSW, never mock Query) + 11 pure-logic tests.
- **Deviations / decisions:** (1) validation lives in a dedicated `exercise_content_validate.go` (CQ-4 file-naming) rather than inline in `exercise_content.go` as the story literally said — co-located package, no behavioral difference. (2) The autosave uses a purpose-built `apiFetch` PATCH inside the hook (not `useUpdateExercise`) so it can `setQueryData` the detail on success instead of invalidating — avoids a refetch storm at the 1.5s autosave cadence (honors CR-4-1-11: the full `content` incl. settings is always serialized). (3) `vocabulary` section type is rejected by validation (AC7 5-set faithful; see FU-4-2-A). (4) Option-level MCQ reorder uses move-buttons only (AC5 requires reorder at section/group/question levels — options are below that; add/remove/mark-correct are the contract).
- **Verification:** backend `go test ./...` 11 pkgs / 0 fail, `go vet` + `gofmt` clean; frontend `tsc -b` clean, `eslint` clean, exercises suite 43/43, i18n-parity 1271/1271, `npm run build` clean with the editor isolated in its own chunk.

### Implementation Plan (as executed)

1. Pre-flight artifact verification of 4.1's inheritance; corrected `baseline_commit`; marked in-progress.
2. **Backend-first (WF-1/WF-3):** T1 `ValidateExerciseContent` (red test → green) → T2 wire into `Update` → T3 api.yaml content sub-schema + `codegen.sh` → T4 golden + handler tests.
3. **Frontend bottom-up:** editorStore extension + `useExerciseAutosave` + indicator (T6) → lib factories + pure `editorDocument` ops → `SortableList` primitive → metadata sidebar (T7) → settings panel (T10) → 5 question editors + `QuestionGroupCard` (T9) → `SectionTypePicker` + `ExerciseSectionCard` (T8) → `ExerciseEditorPage` assembly + route + 4.1 repoint (T5).
4. i18n (100 keys en/vi) + FE test suite (T11).
5. Close-out (T12): FU-4-2-A → deferred-work.md; this record; status → review.

## File List

### Added

**Backend (classlite-api)**
- `internal/store/exercise_content_validate.go` — `ValidateExerciseContent` + caps constants + type sets + zero-width-blank helper.
- `internal/store/exercise_content_validate_test.go` — 16 per-type violation rows + caps + no-panic + multi-error units.
- `internal/store/exercise_content_golden_test.go` — golden-contract test against the shared FE fixture.
- `internal/handler/exercise_handler_content_validation_test.go` — semantic-422 / settings-round-trip / content-deep-equals through the real handler.

**Frontend (classlite-web)**
- `src/features/exercises/ExerciseEditorPage.tsx` — the two-panel editor page + route component.
- `src/features/exercises/hooks/useExerciseAutosave.ts` — the document autosave engine.
- `src/features/exercises/lib/editorTypes.ts` — working-document types (aliased from generated content).
- `src/features/exercises/lib/editorDocument.ts` — pure immutable section ops + `moveItem`.
- `src/features/exercises/lib/sectionTypes.ts`, `lib/questionTypes.ts` — factories, label keys, matching-bank helpers.
- `src/features/exercises/components/editor/EditorAutoSaveIndicator.tsx`, `EditorMetadataSidebar.tsx`, `ExerciseSettingsPanel.tsx`, `SectionTypePicker.tsx`, `ExerciseSectionCard.tsx`, `QuestionGroupCard.tsx`, `SortableList.tsx`.
- `src/features/exercises/components/editor/questions/` — `props.ts`, `KeyBadge.tsx`, `VariantChips.tsx`, `TfngQuestionEditor.tsx`, `McqQuestionEditor.tsx`, `MatchingHeadingsEditor.tsx`, `GapFillQuestionEditor.tsx`, `ShortAnswerQuestionEditor.tsx`.
- `src/features/exercises/__tests__/ExerciseEditorPage.test.tsx` — 15 component tests.
- `src/features/exercises/lib/__tests__/editorDocument.test.ts` — 11 pure-logic tests.
- `src/features/exercises/__tests__/fixtures/exercise-content.golden.json` — shared golden content fixture (Go golden + FE MSW).

### Modified

- `classlite-api/api.yaml` — `content` opaque `object` → typed `ExerciseContent` sub-schema (+ enums); `UpdateExerciseRequest.content` `allOf`-ref.
- `classlite-api/internal/service/exercise_service.go` — `Update` calls `store.ValidateExerciseContent` before the tx (422).
- `classlite-web/src/lib/api/client.ts` — regenerated (openapi-typescript) with the typed content schema.
- `classlite-web/src/stores/editorStore.ts` — added the `unsaved` status + `markUnsaved` action (5-state contract).
- `classlite-web/src/routes.tsx` — added the `:id/edit` child under the `/exercises` gate (own chunk).
- `classlite-web/src/features/exercises/index.ts` — barrel-export `ExerciseEditorPage`.
- `classlite-web/src/features/exercises/ExerciseLibraryPage.tsx` — Edit row action → `navigate('/exercises/:id/edit')`; post-create `onCreated` → editor redirect.
- `classlite-web/src/features/exercises/components/ExerciseFormDialog.tsx` — optional `onCreated` callback (redirect into the editor on create).
- `classlite-web/src/locales/en.json`, `vi.json` — +100 `exercises.editor.*` keys each (parity).

### Deleted

_None._

---

## Follow-up dev pass — code-review action items (2026-07-28, Amelia)

Implements the `### Review Findings` action items from the 2-chunk `/bmad-code-review 4-2` pass: the **Decision-B validator split** (FU-4-2-B) + the frontend patches. Red→green→refactor; both suites verified.

### Debug Log

- **Decision B grounding.** Before slicing structural vs completeness, checked the FE seed factories (`questionTypes.ts`, `sectionTypes.ts`): a fresh T/F/NG question seeds `correctAnswer:'true'` (valid triad → TFNG∈triad stays STRUCTURAL, drafts unaffected); fresh MCQ seeds `['','']`, fresh section seeds `questionGroups:[]`, gap/short seed blank answers (all COMPLETENESS). So every fresh-seed draft is structurally valid → autosave stops 422-ing. This is what makes the split safe.
- **P-FE10 dismissed as a verified false positive.** Blind-hunter (diff-only) assumed `useRole` reads the session from the provider's `QueryClient`. It actually reads the SINGLETON via `useSyncExternalStore`/`getSessionCacheSnapshot` (`src/hooks/useRole.ts`) — exactly where `seedSession` writes. The `student` gate test genuinely denies on role. No change.
- **eslint `react-hooks/set-state-in-effect`.** The 409-reload-retry effect initially reset `reloadFailed` synchronously in the effect body; moved the reset into the async success branch to satisfy the rule.

### Completion Notes

**Backend — Decision B (FU-4-2-B):** re-sliced `exercise_content_validate.go` into `ValidateExerciseContentStructural` (the AUTOSAVE gate, wired into `ExerciseService.Update` pre-tx) and `ValidateExerciseContentComplete` (the FINALIZE gate, to be wired at the Epic-5 finalize surface — not called on autosave). One `walkContent` pass buckets each violation by tier. Structural = valid section/group types, prompt-only-forbids-groups, no foreign options/variants, all caps, settings non-negative/not-absurd, TFNG answer blank-or-∈triad. Completeness = ≥1 group/section, ≥1 q/group, non-blank answer key, ≥2 MCQ options, non-empty/blank-free/dedup'd matching bank, present TFNG answer, enabled-timer-needs-minutes. Golden test now asserts the fixture passes `…Complete`. Tests re-sliced: `…Structural_Violations` (422 on autosave), `…Complete_Violations` (each passes structural / fails complete), and a handler-level `TestExercise_Update_IncompleteDraftPersists_200` proving a freshly-added-section/group draft persists 200 through real middleware (the Critical fix).

**Frontend patches (9 applied; P-FE10 dismissed):**
- **useExerciseAutosave** — `lastAttemptedRef` so Retry/flush replays a failed save (P-FE1); serialized saves via `inFlightRef` promise chain so a new save reads the advanced precondition, killing self-409 (P-FE4); unmount beacon of the pending edit so a navigate-away in the debounce window isn't lost (P-FE2).
- **questionTypes.renameMatchingHeading** + `MatchingHeadingsEditor` — a heading rename now carries the item's selected answer over instead of blanking it via `withMatchingBank` (P-FE3, data-loss).
- **ExerciseEditorPage** — suppress autosave during the 409 window (`conflictRef`, no second self-409, P-FE7); reload-retry (`reloadNonce`/`reloadFailed` + banner retry button) so a failed reload isn't a wedge (P-FE6).
- **EditorMetadataSidebar** — reseed the free-text tags field when `tags` changes by reference (409 reload), tracked via `emittedRef` so own typing never reseeds (P-FE5).
- **McqQuestionEditor** — match the correct option by first index so duplicate text can't show two KEY badges (P-FE9).
- **AC9 focus return (P-FE8)** — group / question / matching-item delete now return focus to the always-present add-affordance (was section-level only).
- i18n: added `exercises.editor.conflictReloadFailed` (en + vi).

**Verification:** backend `gofmt`/`vet` clean, `go test ./...` 11 pkg / 0 fail. Frontend `tsc -b` clean, `eslint` clean, full vitest **2007/2007** pass (+4 new: retry-replay + 3 renameMatchingHeading), `npm run build` clean with `ExerciseEditorPage` isolated at 47.06 kB.

### Remaining / carry-forward

- **FU-4-2-B → Story 5.1 (Epic 5) BLOCKING AC:** wire `ValidateExerciseContentComplete` at the finalize/assign gate + surface the T9/T11 client validation mirror ("N errors to fix") on the finalize surface. Logged in `deferred-work.md`.
- 8 low deferred items (both chunks) remain in the story's `### Review Findings` + `deferred-work.md`.

## File List — follow-up pass

### Added
- `classlite-web/src/features/exercises/lib/__tests__/questionTypes.test.ts` — `renameMatchingHeading` unit tests (P-FE3 lock).

### Modified
- `classlite-api/internal/store/exercise_content_validate.go` — split into `…Structural` / `…Complete` tiers (FU-4-2-B).
- `classlite-api/internal/store/exercise_content_validate_test.go` — re-sliced into structural / completeness tables.
- `classlite-api/internal/store/exercise_content_golden_test.go` — fixture asserted against `…Complete`.
- `classlite-api/internal/service/exercise_service.go` — Update calls `…Structural`.
- `classlite-api/internal/handler/exercise_handler_content_validation_test.go` — `…StructurallyInvalidContent_422` + `…IncompleteDraftPersists_200`.
- `classlite-web/src/features/exercises/hooks/useExerciseAutosave.ts` — retry-replay, serialization, unmount beacon (P-FE1/2/4).
- `classlite-web/src/features/exercises/ExerciseEditorPage.tsx` — 409-window suppression + reload-retry (P-FE6/7).
- `classlite-web/src/features/exercises/lib/questionTypes.ts` — `renameMatchingHeading` (P-FE3).
- `classlite-web/src/features/exercises/components/editor/questions/MatchingHeadingsEditor.tsx` — rename helper + item-delete focus (P-FE3/8).
- `classlite-web/src/features/exercises/components/editor/questions/McqQuestionEditor.tsx` — first-index correct match (P-FE9).
- `classlite-web/src/features/exercises/components/editor/EditorMetadataSidebar.tsx` — tags reseed on external change (P-FE5).
- `classlite-web/src/features/exercises/components/editor/QuestionGroupCard.tsx` — question-delete focus (P-FE8).
- `classlite-web/src/features/exercises/components/editor/ExerciseSectionCard.tsx` — group-delete focus (P-FE8).
- `classlite-web/src/features/exercises/__tests__/ExerciseEditorPage.test.tsx` — retry-replay test (P-FE1 lock).
- `classlite-web/src/locales/en.json`, `vi.json` — `conflictReloadFailed`.
- `classlite-web/src/lib/api/client.ts` — regenerated (api.yaml `ExerciseQuestion.type` doc).

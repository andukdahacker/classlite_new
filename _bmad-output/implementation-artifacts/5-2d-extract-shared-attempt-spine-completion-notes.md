# Story 5.2d: Completion Notes

_Implementation record for [`5-2d-extract-shared-attempt-spine.md`](./5-2d-extract-shared-attempt-spine.md). Status: review._

## Dev Agent Record

### Debug Log

- **`react-hooks/refs` eslint error** in the generic `useAttemptDraft`: seeding `snapshotRef` from a second `emptyRef.current` read a ref during render. Fixed by initializing `snapshotRef = useRef<T>(emptyContent())` (the codebase `useRef(factory())` convention, matching the pre-extraction original) + a synced `emptyContentRef` for the `setContent` unseeded-slot fallback. No behavior change.
- **`schemaVersion` literal widening** in the generic storage test: object literals inferred `schemaVersion: number`, failing `DraftMerge<Doc, …>`. Fixed by binding typed `const local: Doc = …` so the literal is contextually typed as `1`.
- **LSP diagnostics were unreliable throughout** the mid-move window (spurious "Cannot find module `@/lib/api-fetch`", stale `useQuizAttemptStore` references, phantom `useStartAttempt.ts`/`useAttemptBundle.ts` that don't exist on disk). `tsc --noEmit -p tsconfig.app.json` (exit 0) is authoritative and clean; every diagnostic cleared once the graph settled.

### Completion Notes

Refactor-only, behavior-preserving. The skill-agnostic attempt spine moved out of `src/features/quiz-attempt/` into a new shared `src/features/attempts/` module (barrel, TS-7) and was **genuinely generalized** at the content-shaped seams (Winston STRONG 2 — the storage layer is NOT verbatim-movable). No `api.yaml`/codegen/backend/new-dependency change; no observable quiz behavior change.

- **AC1/AC2 — move.** `finalizeAttempt`, `useAttemptAutosave`, `useSubmitAttempt`, `useAttemptBootstrap`, `useAttemptDraft`+`seedAttemptDraft`, `attemptKeys`, `useAttemptTimer`, `useAttemptDraftPersistence`, `attemptTimer`, `attemptReadOnly`, `attemptDraftStorage`, `SaveStatusIndicator`, `SubmissionConfirmation`, `TimerChip`, `AttemptExpiredOverlay` → `src/features/attempts/**` (via `git mv`, history preserved) + barrel `attempts/index.ts`. Their tests moved alongside (Murat F1a). Quiz-shaped pieces stayed: `attemptContent.ts`, the answer-input components, `ExerciseAttemptShell`, `AttemptPage`.
- **AC3 — store split.** `quizAttemptStore` split into shared `attemptStore` (save-status slice; `offline` added forward-ready for 5.3, quiz never emits it; `reset`/`initialState`, TEST-FE-3) + a slimmed quiz-owned `quizAttemptStore` (`currentQuestionIndex`/`splitRatio`). `SaveStatusIndicator` renders the `offline` branch with `attempt.save.offline` (en+vi), tested even though no current caller emits it. `AttemptPage` now resets BOTH stores on fresh attempt.
- **AC4 — content-generic seams (proven, not merely compiled).**
  - `useAttemptAutosave<T>` — generic over `getContent: () => T`; the whole value is JSON-stringified into the opaque `SubmissionContent` bag (nothing reads a `T` field). saveSeq guard / serialized chain / beacon-on-unmount / edit-generation dirty-clear all preserved.
  - `attemptDraftStorage` — `readStoredDraft<T>(id, normalize)` / `writeStoredDraft<T>` / `clearStoredDraft` generic; `reconcileDrafts<T,C>(local, server, merge)` delegates to an injected merge and returns the **merge-defined conflict signal** `C` — no `answers`/`flagged`/`isAnswered`/`hadConflict`/`recoveredLocalOnly` baked into the generic layer.
  - `useAttemptDraftPersistence<T>` / `reconcileStoredDraftIntoCache<T,C>` — generic; take an injected `ReconcileConfig<T,C>` (`normalize` + `merge` + `noConflict`). The 5.2b CRITICAL #2 seed-before-write ordering guard + the once-guarded reconcile-into-cache are preserved content-agnostic.
  - Quiz wires its concrete shape at the call site: new `quiz-attempt/lib/quizDraftReconcile.ts` (`reconcileQuizDrafts` server-wins/recover-local-only/flag-union + `quizReconcileConfig`) and `quiz-attempt/api/useQuizDraft.ts` (`setAnswer`/`toggleFlag` over the generic `setContent`).
  - **Proven by the synthetic string-shaped harness** `attempts/__tests__/genericContract.test.tsx`: no-data-loss (full-replace body-verified), saveSeq out-of-order, edit-during-in-flight, injected-merge conflict path, injected-normalizer on read, and the `offline` indicator branch.
- **AC5 — both 5.2b CRITICAL fixes survive, characterization-tested.** `finalizeAttempt` terminal-409-on-flush fallthrough (CRITICAL #1) — its moved `finalizeAttempt.test.ts` is unchanged. Persistence seed-before-write ordering (CRITICAL #2) — its moved test now proves it content-agnostic with the synthetic shape.

**Allowed-diff gate honored (AC5, Murat F1):** the quiz suite changed ONLY by import-path, store-symbol rename (`useQuizAttemptStore`→`useAttemptStore`), and — in the moved `attemptAutosave.test.tsx` — a local structurally-quiz-shaped content type replacing the cross-feature `attemptContent` import (TS-7; `useAttemptAutosave<T>` is generic). No `arrange`/`act`/`expect` VALUE changed. The quiz-reconcile semantics (server-wins/recover/flag-union) moved verbatim (values identical) into the quiz-owned `quizDraftReconcile.test.ts`, accessed via `.conflict.*`.

**Deviations from spec:** none material. The story listed `useAttemptDraft` as a straight move; to avoid a TS-7 boundary violation (attempts importing quiz `attemptContent`) it was generalized to a `<T>` slice (`content`/`setContent`) with the quiz `setAnswer`/`toggleFlag` extracted into the quiz-owned `useQuizDraft` wrapper — the only structurally-honest way to move it. `seedAttemptDraft` (unused in prod, tested only) moved generically.

**Gates:** `tsc --noEmit -p tsconfig.app.json` exit 0; `eslint` exit 0; `i18n-parity` OK **1525 keys** (+`attempt.save.offline` en+vi); full `vitest` **160 files / 2247 tests, 0 failures** (was 156/2234 — moved spine tests renamed in place; +4 new files: `attemptStore`, `quizDraftReconcile`, `useQuizDraft`, `genericContract`). Nothing committed (working tree).

### Implementation Plan (summary)

1. Pre-flight: read the 5.2b spine + every import site + test; classify content-agnostic (move) vs quiz-shaped (stay). Only external importer is `routes.tsx` → lazy `AttemptPage` (stays) → no route change.
2. `git mv` the 15 source files + 8 tests into `src/features/attempts/**`.
3. Store split: new `attemptStore.ts` (+`offline`) / slim `quizAttemptStore.ts`; split the store test, add `attemptStore.test.ts`.
4. Generalize the four seams (`useAttemptAutosave`, `attemptDraftStorage`, `useAttemptDraftPersistence`, `useAttemptDraft`); add quiz-owned `quizDraftReconcile.ts` + `useQuizDraft.ts`.
5. Barrel `attempts/index.ts`; rewire `ExerciseAttemptShell` + `AttemptPage` to the barrel; slim quiz barrel.
6. Update moved tests (generic sigs + store rename); add `genericContract.test.tsx`, `quizDraftReconcile.test.ts`, `useQuizDraft.test.tsx`; add `attempt.save.offline` en+vi.
7. Gates: tsc → eslint → i18n-parity → full vitest.

## File List

### Added
- `classlite-web/src/features/attempts/index.ts` — shared spine barrel (TS-7).
- `classlite-web/src/features/attempts/__tests__/genericContract.test.tsx` — synthetic string-shaped generalization proof (AC4/AC5).
- `classlite-web/src/stores/attemptStore.ts` — shared save-status slice (+`offline`).
- `classlite-web/src/stores/__tests__/attemptStore.test.ts` — save-status/offline/reset (TEST-FE-3).
- `classlite-web/src/features/quiz-attempt/lib/quizDraftReconcile.ts` — quiz reconcile merge + config.
- `classlite-web/src/features/quiz-attempt/lib/__tests__/quizDraftReconcile.test.ts` — quiz reconcile semantics.
- `classlite-web/src/features/quiz-attempt/api/useQuizDraft.ts` — quiz `setAnswer`/`toggleFlag` adapter.
- `classlite-web/src/features/quiz-attempt/api/__tests__/useQuizDraft.test.tsx` — quiz draft adapter tests.

### Moved (git mv `quiz-attempt/…` → `attempts/…`)
- `api/finalizeAttempt.ts`, `api/useSubmitAttempt.ts`, `api/useAttemptBootstrap.ts`, `api/attemptKeys.ts` — clean moves (relative/absolute imports resolve in place).
- `api/useAttemptAutosave.ts` — generalized `<T>` + repointed to `attemptStore`.
- `api/useAttemptDraft.ts` — generalized `<T>` slice (`content`/`setContent`) + generic `seedAttemptDraft`.
- `hooks/useAttemptTimer.ts` — clean move.
- `hooks/useAttemptDraftPersistence.ts` — generalized `<T>` + injected `ReconcileConfig`.
- `lib/attemptTimer.ts`, `lib/attemptReadOnly.ts` — clean moves.
- `lib/attemptDraftStorage.ts` — generalized read/write/clear + injected-merge `reconcileDrafts`.
- `components/SaveStatusIndicator.tsx` — repointed to `attemptStore` + `offline` branch.
- `components/SubmissionConfirmation.tsx`, `components/TimerChip.tsx`, `components/AttemptExpiredOverlay.tsx` — clean moves.
- Tests moved alongside: `api/__tests__/finalizeAttempt.test.ts` (unchanged), `api/__tests__/attemptAutosave.test.tsx` (local content type + store rename), `api/__tests__/useAttemptDraft.test.tsx` (generic), `hooks/__tests__/useAttemptTimer.test.tsx` (unchanged), `hooks/__tests__/useAttemptDraftPersistence.test.tsx` (generic + injected config), `lib/__tests__/attemptTimer.test.ts` (unchanged), `lib/__tests__/attemptReadOnly.test.ts` (unchanged), `lib/__tests__/attemptDraftStorage.test.ts` (generic; reconcile cases split out to quiz).

### Modified
- `classlite-web/src/stores/quizAttemptStore.ts` — slimmed to `currentQuestionIndex`/`splitRatio` (save-status extracted).
- `classlite-web/src/stores/__tests__/quizAttemptStore.test.ts` — dropped save-status assertions.
- `classlite-web/src/features/quiz-attempt/components/ExerciseAttemptShell.tsx` — barrel imports; `useQuizDraft`.
- `classlite-web/src/features/quiz-attempt/AttemptPage.tsx` — barrel imports; reset both stores; `quizReconcileConfig`; `result.conflict.*`.
- `classlite-web/src/features/quiz-attempt/index.ts` — slimmed to quiz-only surface.
- `classlite-web/src/features/quiz-attempt/__tests__/AttemptPage.test.tsx` — reset `attemptStore` too (TEST-FE-3).
- `classlite-web/src/features/quiz-attempt/__tests__/attemptKeyboardFlow.test.tsx` — reset `attemptStore` too (TEST-FE-3).
- `classlite-web/src/locales/en.json`, `classlite-web/src/locales/vi.json` — `attempt.save.offline`.

### Deleted
- None (all removals are `git mv` renames).

# Story 5.2d: Extract the Shared Attempt Spine

Status: done

---
epic: 5
story: 5.2d
baseline_commit: 4b3984ff2bae1c5d9fb5cbde304bfa1f4f9364c2
size: M
audience: Frontend
depends_on: [5.2b]
risk_score: 6   # Refactor-only, but the code being moved IS the shipped risk-7 graded-exam finalizer/autosave/no-loss spine. A silent regression breaks BOTH quiz (live in prod via 5-2c) and every future consumer (5.3 writing, 5.4 speaking). Behavior-preserving is the whole contract; the shipped quiz suite + new generic-contract tests are the gate. No user-facing change, no api.yaml/codegen/backend.
---

<!-- Split out of 5.3 at party-mode pre-dev review (Ducdo 2026-08-05, John #3 + Murat F1): the skill-agnostic attempt spine extraction is a refactor of shipped code and should land as its own thin story BEFORE 5.3/5.4, so "what shipped" stays legible and 5.3/5.4 build on a stable, generic module in parallel. This story ONLY moves + generalizes; it ships NO new user-facing behavior. -->

## Story

As the **engineering team**,
I want the **skill-agnostic attempt primitives (finalizer, autosave, server-clock timer, localStorage draft mirror, read-only derivation, two-call bootstrap, save-status store, submission-confirmation) extracted out of `src/features/quiz-attempt/` into a shared, content-generic `src/features/attempts/` module**,
so that **Writing (5.3) and Speaking (5.4) build on one battle-tested spine instead of importing from a feature named "quiz" or duplicating the risk-7 finalizer into copies that drift**.

**Scope:** Frontend refactor only. **No user-facing behavior change, no `api.yaml`/codegen/backend, no new dependency.** Behavior-preserving for the quiz attempt (live in prod) + generalization of the content-shaped seams so a non-quiz content type can consume them. The writing/speaking features themselves are NOT built here.

## Acceptance Criteria

1. **Behavior-preserving move.** Given the skill-agnostic primitives in `src/features/quiz-attempt/`, When 5.2d lands, Then they live in a new `src/features/attempts/` module and `quiz-attempt/` imports them, with **no change to observable quiz behavior**. The content-shape-specific pieces stay in `quiz-attempt/`: `lib/attemptContent.ts` (quiz shape + `isAnswered` predicates + counts), `ChoiceOption`/`GapInput`/`MatchingBoard`/`QuestionNavigatorRail`/`AttemptAudioPlayer`/`SubmitConfirmDialog`, `ExerciseAttemptShell`, `AttemptPage`.
2. **Moved into `src/features/attempts/`:** `finalizeAttempt.ts`, `useAttemptAutosave.ts`, `useSubmitAttempt.ts`, `useAttemptBootstrap.ts`, `useAttemptDraft.ts` + `seedAttemptDraft`, `attemptKeys.ts`, `useAttemptTimer.ts`, `useAttemptDraftPersistence.ts`, `attemptTimer.ts`, `attemptReadOnly.ts`, `attemptDraftStorage.ts`, `SaveStatusIndicator.tsx`, `SubmissionConfirmation.tsx`, `TimerChip.tsx`, `AttemptExpiredOverlay.tsx`, with a barrel `src/features/attempts/index.ts` (TS-7). `src/hooks/useCountdown.ts` is already shared (no move).
3. **Store split.** `src/stores/quizAttemptStore.ts` splits into a shared `src/stores/attemptStore.ts` (the save-status slice: `saveStatus: 'idle'|'saving'|'saved'|'unsaved'|'error'|'offline'` — `offline` added forward-ready for 5.3 though quiz never emits it — plus `reset()`, `initialState`, TEST-FE-3) and a quiz-owned UI store keeping `currentQuestionIndex`/`splitRatio`. `SaveStatusIndicator` renders the `offline` branch (with `attempt.save.offline` en+vi, tested) even though no current caller emits it.
4. **Content-generic seams (the reason this is more than a move).** The moved primitives are generalized so a non-quiz content type `T` can consume them, and this is **proven by a synthetic non-quiz (string-shaped) harness**, not merely compiled:
   - `useAttemptAutosave` is generic over `getContent: () => T` (full-replace body, `saveSeq` out-of-order guard, serialized in-flight chain, beacon-on-unmount, edit-generation dirty-clear all preserved).
   - `attemptDraftStorage` read/write/clear/key is generic; the **normalizer and the reconcile merge are injected** (quiz supplies its per-answer/flag union + `isAnswered`; the harness supplies a whole-value replace). `reconcileDrafts` no longer hard-references `answers`/`flagged`/`isAnswered`; it returns a merge-defined conflict signal, not quiz-flavored `hadConflict`/`recoveredLocalOnly` booleans baked into the generic layer.
   - `useAttemptDraftPersistence` keeps the **seed-before-write-through ordering guard** (5.2b CRITICAL #2) and the once-guarded reconcile-into-cache, content-agnostic.
5. **Both 5.2b CRITICAL fixes survive the move, characterization-tested.** `finalizeAttempt` terminal-409-on-flush falls through to submit (CRITICAL #1); the persistence seed-before-write ordering (CRITICAL #2) holds. Their moved tests assert this unchanged.

## Tasks / Subtasks

- [x] **Task 0 — Pre-flight.** Read the reuse map in 5.2b Dev Notes + the actual `quiz-attempt/` tree. Confirm which files are content-agnostic (move) vs quiz-shaped (stay). Inventory every import site + every test that imports a moved symbol or `quizAttemptStore`. _(Only external importer: `routes.tsx` lazy-imports `AttemptPage`, which stays → no route change.)_
- [x] **Task 1 — Move the spine (AC1,2).** Relocated the AC2 files to `src/features/attempts/` via `git mv`; **moved their tests with them** into `src/features/attempts/**/__tests__` (Murat F1a). Added the barrel. Updated `quiz-attempt/` imports to the barrel.
- [x] **Task 2 — Store split (AC3).** Extracted `src/stores/attemptStore.ts` (save-status + `offline`, `reset`, `initialState`); left quiz UI state (`currentQuestionIndex`/`splitRatio`) in `quizAttemptStore`; updated `SaveStatusIndicator` + all callers + tests to the new symbol; `SaveStatusIndicator` renders the `offline` branch.
- [x] **Task 3 — Generalize the seams (AC4).** Added the `<T>` `getContent` param; injected the normalizer + reconcile merge into `attemptDraftStorage`/`useAttemptDraftPersistence` (merge-defined conflict signal `C`, no quiz flags in the generic layer). Quiz wires its concrete merge/normalizer via `quizDraftReconcile.ts` + `useQuizDraft.ts` — **quiz behavior unchanged**.
- [x] **Task 4 — Prove the generic contract (AC4,5; RED-first).** `attempts/__tests__/genericContract.test.tsx` drives `useAttemptAutosave` with `getContent:()=>({schemaVersion:1, value:string})` + the injected whole-value merge: full-replace body-verified no-data-loss; `saveSeq` out-of-order; edit-during-in-flight dirty-clear; injected-merge conflict path; injected-normalizer on read; the `offline` status branch renders.
- [x] **Task 5 — Gates (AC1,5).** Allowed-diff honored (import path + store-symbol rename + `<T>` type-param + a local content type replacing the cross-feature import in the moved autosave test; no `arrange`/`act`/`expect` VALUE changed). `tsc --noEmit -p tsconfig.app.json` exit 0; `eslint` exit 0; `i18n-parity` OK **1525 keys**; full `vitest` **160 files / 2247 tests, 0 failures**.

## Dev Notes

**Refactor-only, behavior-preserving.** The moved code is the shipped 5.2b spine — verified content-agnostic during the 5.3 party-mode review (Winston, Murat). The one honesty correction from that review (Winston STRONG 2): the storage layer is **not** "verbatim-movable" — `readStoredDraft`→`normalizeAttemptContent`, `reconcileDrafts`→`answers`/`flagged`/`isAnswered`, and the quiz-flavored `ReconcileResult` flags must be genuinely generalized (Task 3), which is why AC4/Task 4 exist and why "quiz suite green" alone is an insufficient gate.

### Canonical paths (source of the move)
- `src/features/quiz-attempt/api/{finalizeAttempt,useAttemptAutosave,useSubmitAttempt,useAttemptBootstrap,useAttemptDraft,attemptKeys}.ts`
- `src/features/quiz-attempt/hooks/{useAttemptTimer,useAttemptDraftPersistence}.ts`
- `src/features/quiz-attempt/lib/{attemptTimer,attemptReadOnly,attemptDraftStorage}.ts`
- `src/features/quiz-attempt/components/{SaveStatusIndicator,SubmissionConfirmation,TimerChip,AttemptExpiredOverlay}.tsx`
- `src/stores/quizAttemptStore.ts` (split), `src/hooks/useCountdown.ts` (already shared)
- Tests to move alongside: `api/__tests__/attemptAutosave.test.tsx`, `api/__tests__/finalizeAttempt.test.ts`, `lib/__tests__/attemptDraftStorage.test.ts`, `hooks/__tests__/useAttemptDraftPersistence.test.tsx` (+ timer/readonly tests).

### Testing standards (WF-8; TEST-FE-1..6)
MSW-only seam; real timers + settle for the autosave/timer tests. The quiz suite is the behavior-preservation gate under the AC5 allowed-diff rule; the AC4 generic-contract harness is the generalization gate. Never mock `useQuery`.

### References
- [Source: 5-2b-quiz-attempt-interface-...md] — the spine + its 2 CRITICAL code-review fixes (terminal-409-flush fallthrough; seed-before-write ordering) that must survive the move.
- [Source: classlite-web/src/features/quiz-attempt/] — the module being extracted.
- [Source: docs/project-context.md] — TS-3/4/7, FW-1/5, TEST-FE-1..6, CQ-1.
- [Source: docs/bmad-story-conventions.md] — Dev Agent Record + File List → sibling completion-notes; story <600 lines.

## Definition of Done

- [x] Spine moved to `src/features/attempts/` + barrel; quiz-attempt imports it; quiz UI store split from the shared save-status store (`offline` added).
- [x] Content-generic seams: `getContent<T>` autosave; injected normalizer + reconcile merge; merge-defined conflict signal (no quiz flags in the generic layer).
- [x] Both 5.2b CRITICAL fixes survive, characterization-tested; the generic-contract string harness green (no-loss / saveSeq / edit-in-flight / injected-merge / normalizer / offline branch).
- [x] Quiz suite green under the AC5 allowed-diff rule (import-path + store-symbol + `<T>` only); full `vitest`, `tsc`, `eslint`, `i18n-parity` green.
- [x] **No user-facing behavior change, no `api.yaml`/codegen/backend/new dependency.** Sibling completion-notes holds Dev Agent Record + File List; story <600 lines.

## Out of Scope

- **Writing (5.3), Speaking (5.4)** — they consume this module; not built here.
- **The `offline` autosave/reconnect BEHAVIOR** — 5.2d only adds the shared `offline` status value + indicator branch forward-ready; the `useOnlineStatus` hook, offline pause, and reconnect reconcile are 5.3.
- **Any new user-facing feature, api.yaml/schema/codegen/backend change, or new dependency.**

## Review Findings

_Code review 2026-08-05 (Amelia, `/bmad-code-review 5-2d`; Blind Hunter + Edge Case Hunter + Acceptance Auditor, all 3 layers ran). **0 decision-needed, 2 patch, 0 defer, 6 dismissed.** Edge Case Hunter returned `[]` (clean, all paths walked); Acceptance Auditor confirmed all 5 ACs satisfied. The Blind Hunter's 3 Critical/High findings (store/barrel/adapters "absent → doesn't compile"; reconcile semantics "deleted"; harness "doesn't exist") were **capture artifacts** — `git diff HEAD` omits untracked files, so the blind layer never saw `attemptStore.ts`, `attempts/index.ts`, `quizDraftReconcile.ts`, `useQuizDraft.ts`, `genericContract.test.tsx`; the two disk-access layers read them and confirmed imports resolve, exports present, quiz semantics preserved verbatim. Two Blind Mediums dismissed on verification: the `<T>`→`SubmissionContent` double-cast is a pre-existing wire-boundary cast into an opaque JSONB bag (a `T` constraint wouldn't remove it); `seedAttemptDraft`'s normalize→caller-owned change carries no regression — it was already production-unused in 5.2b (test-only export both before & after) and the real seed path (`reconcileStoredDraftIntoCache`→`config.normalize`→`normalizeAttemptContent`) still normalizes._

- [x] [Review][Patch] **attemptStore test-reset discipline (TEST-FE-3).** The new shared `attemptStore` is a global singleton introduced by this story, but the autosave/generic tests that drive it don't reset it, and the two moved full-flow quiz suites reset it via `setState({ saveStatus: 'idle' })` instead of `getState().reset()`. Suite is green now; latent isolation footgun for 5.3/5.4 attempt tests. [classlite-web/src/features/attempts/api/__tests__/attemptAutosave.test.tsx; classlite-web/src/features/quiz-attempt/__tests__/AttemptPage.test.tsx; classlite-web/src/features/quiz-attempt/__tests__/attemptKeyboardFlow.test.tsx]
- [x] [Review][Patch] **Stale deferred-work.md AC22 pointer.** The reconcile server-wins / `!isAnswered`-skip / flag-`Set`-union logic moved out of `attemptDraftStorage.ts` into `quiz-attempt/lib/quizDraftReconcile.ts` (`reconcileQuizDrafts`); the AC22 trade-off note still cites the now-deleted `classlite-web/src/features/quiz-attempt/lib/attemptDraftStorage.ts:89,99`. Move invalidated the pointer. [_bmad-output/implementation-artifacts/deferred-work.md:750]

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-08-05 | **Implemented → review** (Amelia `/bmad-dev-story 5-2d`). All 6 tasks + 5 ACs + DoD. Refactor-only, behavior-preserving: 15 source files + 8 tests `git mv`'d into `src/features/attempts/**` + barrel (TS-7); store split into shared `attemptStore` (+`offline`) / slim `quizAttemptStore`; the 4 content-shaped seams (`useAttemptAutosave`, `attemptDraftStorage`, `useAttemptDraftPersistence`, `useAttemptDraft`) genuinely generalized `<T>` with injected normalizer/merge + merge-defined conflict signal (Winston STRONG 2); quiz wires its concrete shape via new `quizDraftReconcile.ts` + `useQuizDraft.ts`. Proven by the synthetic string harness `genericContract.test.tsx` (no-loss / saveSeq / edit-in-flight / injected-merge / normalizer / offline branch). Both 5.2b CRITICALs survive (terminal-409 fallthrough test unchanged; seed-before-write ordering preserved). **No api.yaml/codegen/backend/new-dependency; no observable quiz behavior change.** Gates: tsc exit 0, eslint exit 0, i18n-parity 1525 keys (+`attempt.save.offline` en+vi), full vitest **160 files / 2247 tests, 0 regressions** (was 156/2234; +4 new test files). Dev Agent Record + File List → sibling `5-2d-…-completion-notes.md`. Nothing committed (working tree). Recommend `/bmad-code-review 5-2d` with a DIFFERENT LLM. Sequence: 5-2d (this) → 5-3 → 5-4. | Amelia |
| 2026-08-05 | **Created via party-mode split of 5.3 (Amelia; Ducdo-ratified).** John #3 + Murat F1 argued the shared-spine extraction is a refactor of shipped risk-7 code that should land as its own thin story BEFORE 5.3/5.4 (legible "what shipped"; stable generic module; unblocks 5.4 in parallel). Scope = move + generalize the content-shaped seams (Winston STRONG 2: storage layer is NOT verbatim-movable) + prove the generic contract with a synthetic string harness (Murat F1b) + restated allowed-diff gate (Murat F1a). risk 6 (refactor of the shipped finalizer/no-loss spine). Sequence: 5-2d (this) → 5-3 → 5-4. `backlog → ready-for-dev`. Next: `/bmad-dev-story 5-2d`. | Amelia |

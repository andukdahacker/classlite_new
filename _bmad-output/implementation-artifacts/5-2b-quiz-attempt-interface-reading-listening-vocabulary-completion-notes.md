# Story 5-2b: Completion Notes

_Implementation record for [`5-2b-quiz-attempt-interface-reading-listening-vocabulary.md`](./5-2b-quiz-attempt-interface-reading-listening-vocabulary.md). Status: review._

## Dev Agent Record

### Debug Log

- **Draft-slice re-render (Task 3).** `useQuery` with a `queryFn` returning empty content clobbered `setQueryData` edits back to empty (the in-flight queryFn resolved after the write); switching to `initialData`+`staleTime:Infinity` still didn't re-render the mounted observer. Final fix: read the slice via `useSyncExternalStore` on the query cache (the `useRole` pattern). Guarded the empty fallback to return a STABLE ref (an empty-object-per-call fallback caused a `useSyncExternalStore` infinite loop).
- **saveSeq test (WF-8 #5).** Initial assertion (`puts == [1,2]` growing content) was wrong for a synchronous harness — both serialized PUTs read the latest draft at run time. Re-anchored the test on the real guard property: exactly ONE `saved` transition (a superseded save never reports "saved").
- **react-resizable-panels in jsdom.** The split-pane constructs a `ResizeObserver` (and reads `matchMedia`) — neither exists in jsdom, crashing on mount with `TypeError: n is not a constructor`. Added both polyfills to `src/test/vitest-setup.ts`.
- **axe on skeleton.** `aria-label` on a role-less `<div>` → `aria-prohibited-attr`; added `role="status"`.
- **base-ui radios + `toBeDisabled`.** base-ui `Radio.Root` uses `aria-disabled`, not the native attribute; the read-only test asserts the native gap input + flag button disabled instead.
- **ESLint react-hooks/refs + set-state-in-effect.** The strict React 19 rule set forbids ref *writes/reads during render* and synchronous `setState` in an effect body. Refactored `useCountdown`, `useAttemptAutosave`, `useAttemptTimer` to sync latest-value refs inside a no-dep `useEffect` (the codebase `useAutoSave` convention); dropped the immediate `setDerivedRemaining` (the `useState` initializer already seeds it).
- **Beacon vs `no-restricted-globals`.** Raw `fetch({keepalive})` is lint-forbidden; switched the unmount beacon to fire-and-forget `apiFetch` (mirrors `useExerciseAutosave.beaconPending`) — no keepalive, matching the existing convention.

### Completion Notes

Frontend-only (no `api.yaml`/`client.ts`/codegen/backend change — Task 0 verified all schemas + the `EXERCISE_LOCKED`-once-submitted guarantee at `exercise_service.go:670`).

**Shipped:**
- **Answer model (D1):** `attemptContent.ts` owns the `{schemaVersion:1, answers:Record<Handle,string>, flagged:Handle[]}` shape, the answered predicate (non-empty/non-whitespace, per-question), count derivations, and immutable transforms.
- **Finalizer integrity (AC18/19):** serialized `finalizeAttempt` (flush→submit, single-fire latch, terminal-409 idempotency, no lossy submit on flush failure); `useAttemptAutosave` (30s dirty-flush, saveSeq out-of-order guard, serialized chain, beacon-on-unmount). All 3 BLOCKER race tests green (no-data-loss body-verified, saveSeq, 0:00 convergence).
- **Monotonic timer (AC11/11a):** `attemptTimer.ts` pure `computeRemainingSeconds` + injectable `createServerClock` (never `Date.now()`); `useCountdown` promoted to `src/hooks/` with the injectable MODE B; `useAttemptTimer` (untimed short-circuit, single-fire expiry, AC19 resume-finalize on expired load, visibility reconcile).
- **State (D9):** answers/flagged draft in the Query cache (`useAttemptDraft` via `useSyncExternalStore`); `quizAttemptStore` (Zustand, UI-only, `reset()`).
- **localStorage mirror (AC22):** write-through + reconcile (server-wins-on-conflict, local-only recovery, conflict/recovery toasts).
- **Inputs (AC4/5/6):** `ChoiceOption` (TFNG/MCQ radio), `GapInput` (text), `MatchingBoard` (native per-row select = default/keyboard path; `@dnd-kit` pointer drag enhancement).
- **Shell (AC2/3/7/8/9/12/16/20/21):** desktop draggable split-pane (`react-resizable-panels`) + mobile switchable-segment tree + bottom-sheet navigator; `TimerChip`, `SaveStatusIndicator`, `AttemptAudioPlayer`, `QuestionNavigatorRail`, `AttemptExpiredOverlay`.
- **Submit/read-only/confirmation (AC13/15/23):** `SubmitConfirmDialog` (clickable count jumps), `attemptReadOnly.ts` (derivation + 409/413 map), inline read-only banner, `SubmissionConfirmation` end-state.
- **Route (AC1):** `/assignments/:assignmentId/attempt` full-bleed outside `AppLayout`, role-gated `['student']`, lazy deep-import chunk. Two-call bootstrap (`useAttemptBootstrap`) as one query (no fetch-in-effect).
- **i18n:** 65 `attempt.*` keys × en + vi (parity green, VN-length-designed).

**Deferrals (per spec, unchanged):** server-side auto-finalize sweep (FU-5-1-A, signed-off accepted risk — the visible "submits only while this tab is open" note renders on timed attempts); multi-tab `BroadcastChannel` (5.3); listening single-play enforcement (AC9, flagged to product); Writing/Speaking/graded Result (5.3/5.4/5.5).

**Release note:** release-bound to 5-2c (D13) — does not ship to prod independently.

### Implementation Plan (as executed)

Task 0 (pre-flight, recon agent) → 1 (content model, RED) → 2 (API layer + finalizer + BLOCKER race tests) → 3 (draft slice + store) → 4 (localStorage mirror) → 5 (timer promote + wiring) → 6 (inputs) → 8-core (read-only lib) → 7 (presentational components + shell) → 8 (submit/confirmation) → 9 (route + page + bootstrap) → 10 (i18n + page integration + keyboard/touch + gates).

## File List

### Added
- `classlite-web/src/features/quiz-attempt/**` (40 files: `lib/{attemptContent,attemptTimer,attemptReadOnly,attemptDraftStorage}.ts`, `api/{attemptKeys,useStartAttempt,useAttemptBundle,useAttemptAutosave,useSubmitAttempt,finalizeAttempt,useAttemptDraft,useAttemptBootstrap}.ts`, `hooks/{useAttemptTimer,useAttemptDraftPersistence}.ts`, `components/{ExerciseAttemptShell,QuestionNavigatorRail,ChoiceOption,GapInput,MatchingBoard,AttemptAudioPlayer,SaveStatusIndicator,TimerChip,SubmitConfirmDialog,AttemptExpiredOverlay,SubmissionConfirmation,questionField}.tsx/ts`, `AttemptPage.tsx`, `index.ts`, + `__tests__/`)
- `classlite-web/src/hooks/useCountdown.ts` (promoted from onboarding) + `src/hooks/__tests__/useCountdown.test.tsx` (moved)
- `classlite-web/src/stores/quizAttemptStore.ts` + `src/stores/__tests__/quizAttemptStore.test.ts`

### Modified
- `classlite-web/src/routes.tsx` — the `/assignments/:assignmentId/attempt` full-bleed route
- `classlite-web/src/features/onboarding/{CenterSetupPage,ClassSpawnPage,SoloFirstClassPage,index}.ts(x)` — `useCountdown` import → `@/hooks/useCountdown`
- `classlite-web/src/locales/en.json` + `vi.json` — 65 `attempt.*` keys each
- `classlite-web/src/test/vitest-setup.ts` — `ResizeObserver` + `matchMedia` jsdom polyfills
- `classlite-web/package.json` + `package-lock.json` — `+react-resizable-panels ^4.12.2` (D3; flag for human review, Rolldown-verify)

### Deleted
- `classlite-web/src/features/onboarding/hooks/useCountdown.ts` — promoted to `src/hooks/`

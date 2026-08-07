# Story 5.3: Completion Notes

_Implementation record for [`5-3-writing-attempt-interface.md`](./5-3-writing-attempt-interface.md). Status: review._

## Dev Agent Record

### Debug Log

- **Baseline re-based.** Frontmatter `baseline_commit` pointed at `4b3984ff` (5-2b), but 5-2c + 5-2d merged after the story was created — a review diff from that base would fold two other stories into 5.3. Updated to HEAD `cc85a92` (5-2d done) so the code-review diff is 5.3-only.
- **`en.json` uses flat dotted keys + i18next plural suffixes.** The `count` interpolation variable triggers i18next pluralization (the shells key `wordCount_one/_other` for exactly this). The `WordCountMeter`'s "count / min" is not a plural phrase, so it passes `{ n: count, min }` (non-`count` var) to avoid the plural machinery.
- **Uncontrolled leaf seeding vs. reconcile ordering.** The editor leaf is uncontrolled (`defaultValue` seeded once), so it can't pick up a reconcile that lands after mount. The page runs `reconcileStoredDraftIntoCache` synchronously in an effect and gates the shell on the derived `initialText` (one extra skeleton frame) so the leaf seeds from the recovered text, never a pre-reconcile blank.
- **Word-count isolation vs. shell chrome.** BLOCKER 2 forbids a per-keystroke shell/timer re-render, but the count is shown in the shell's footer/strip. Resolved with a `LiveTextStore` (external store): the leaf writes it on keystroke, `WordCountMeter` subscribes via `useSyncExternalStore` and re-renders alone. `WriteDocSurface`/`MobileWritingSurface` grew additive slot props (`wordCountSlot`/`timeSlot`/`dueCountdown`/`saveSlot`/`stickyBarSlot`) so the isolated meters render inside the shells without the shells holding the live value.
- **Lint fixes (react-hooks purity/refs).** (1) `useAttemptBroadcast` sender-id moved out of render into the channel mount effect (impure `crypto`/`random` during render). (2) `useWritingReadOnly` dropped the synchronous `setState`-in-effect — the 1s tick reads `deriveRef.current`, so a prop change is adopted on the next tick. (3) `WritingAttemptShell` live-store switched from a lazy ref-read-during-render to a `useState` initializer.
- **flush-on-unmount test race.** The beacon only fires if the leaf committed (dirty armed) before unmount; the test now waits for the cache draft to reflect the typed text before unmounting.

### Completion Notes

- **Frontend-only.** No `api.yaml`/`client.ts`/codegen/backend/new-dependency change. Consumes the shipped backend (5.1 + 5.2a) and the shared `src/features/attempts/` spine (5.2d).
- **All 5 party-mode BLOCKERs folded + verified:**
  - **Offline never-lose-work (D4, local-newer-wins):** `reconcileWritingDrafts` keeps the local (newer) draft; server-wins only on a detected foreign signal (`makeWritingMerge(true)`). Live reconnect handler does an explicit resume-flush (`autosave.flush()`), not a naive un-gate. Integration: ZERO PUT while offline (absent-verified), exactly one PUT on reconnect carrying the full reconciled text.
  - **Isolated uncontrolled editor leaf (D5):** `WritingEditorLeaf` + `LiveTextStore`; keystroke re-renders only the meter; cache/mirror written on debounce; textarea value never bound to the cache draft.
  - **Untimed hard-deadline read-only tick (BLOCKER 3):** `useWritingReadOnly` ticks `deriveReadOnly` off the due-date clock; unit-verified flip when `serverNow()` crosses `hardDeadlineAt`, and integration-verified (clock-driven flip → disabled textarea + Submit absent + ZERO PUT, no write-409).
  - **All no-loss reds absent-PUT-verified** (Murat F4/F5/F7): offline, read-only, and multi-tab reds assert the PUT does NOT happen (no `503=offline`, no `vi.mock('useOnlineStatus')`).
- **Shared spine re-proven on the writing wiring:** serialized flush→submit + single-fire latch; terminal-409-flush fall-through (timed resume-finalize → confirmation); seed-before-write ordering (mirror never clobbered pre-reconcile); monotonic `serverNow()`; read-only 409 map + focus-move; L/E/E trilogy; confirmation end-state.
- **`minWordsFor` interim heuristic.** On top of the ratified `WRITING_MIN_WORDS` map (D3), `minWordsFor` infers Task-1/Task-2 from the exercise title (documented interim signal) and falls back to 250. FU-5-3-A migrates to a real `exercise.minWords` field. Both are unit-tested so the swap is one line.
- **Deferrals (already tracked in `deferred-work.md`):** FU-5-3-A (`exercise.minWords`); the `[Doc reconciliation]` item to amend the rich-text→plain-text wording in PRD FR-29 + UX §8.4 + Epic 6.1 (John #1) — left as the tracked follow-up rather than expanding this frontend story into three planning docs.
- **Playwright happy-path smoke** — not authored here (not a correctness gate per Task 8); the MSW-seam integration covers the happy path end-to-end.

### Implementation Plan (summary)

1. Task 0 pre-flight — verified 5.2d spine merged (HEAD), exports, GET `/attempt` shape, no codegen.
2. Task 1 — `writingContent.ts` (shape/normalize, IME-safe `countWords` edge table, `WRITING_MIN_WORDS`/`minWordsFor`, whole-value reconcile) — RED-first, 27 unit tests.
3. Task 2 — `WriteDocSurface` additive props; `LiveTextStore`; `WritingEditorLeaf` (uncontrolled, IME-safe, ≥16px); `WordCountMeter`; `WritingPromptBlock`.
4. Task 3 — `useOnlineStatus`, `useAttemptBroadcast` (private-mode + echo guards).
5. Tasks 4/5/6 — `useWritingDraft`, `useWritingReadOnly` (BLOCKER-3 tick), `TimeOnTaskMeter`, `DueDateCountdown`, `WritingSubmitDialog` (dialog + mobile sheet), `SubmittedElsewhereOverlay`, mobile de-frame, `WritingAttemptShell`.
6. Task 7 — `WritingAttemptPage` (bootstrap + L/E/E + reconcile gate), `/write` route, `attemptRouteForSkill` un-stub, barrel.
7. Task 8 — `writing.*` i18n (en+vi), shell + page integration suites (BLOCKER reds), gates.

### Gate results

- `tsc --noEmit -p tsconfig.app.json` — exit 0.
- `eslint` (changed files) — clean.
- `npm run i18n-parity` — OK, 1557 keys present in both en + vi.
- `vitest` (writing-attempt + assignments) — 127/127 pass. Full-suite regression: **2326/2326 pass across 171 files (0 regressions).**

## File List

### Added

- `classlite-web/src/features/writing-attempt/lib/writingContent.ts` — content shape, normalize, `countWords`, `WRITING_MIN_WORDS`/`minWordsFor`, reconcile merge (D4).
- `classlite-web/src/features/writing-attempt/lib/liveTextStore.ts` — the isolated live-text external store (D5).
- `classlite-web/src/features/writing-attempt/api/useWritingDraft.ts` — writing adapter over the shared draft slice.
- `classlite-web/src/features/writing-attempt/hooks/useOnlineStatus.ts` — connectivity via `navigator.onLine` + events.
- `classlite-web/src/features/writing-attempt/hooks/useAttemptBroadcast.ts` — per-submission BroadcastChannel (private-mode + echo guards).
- `classlite-web/src/features/writing-attempt/hooks/useWritingReadOnly.ts` — read-only clock that ticks off the due-date (BLOCKER 3).
- `classlite-web/src/features/writing-attempt/components/WritingEditorLeaf.tsx` — isolated uncontrolled textarea leaf.
- `classlite-web/src/features/writing-attempt/components/WordCountMeter.tsx` — live count/min + delta (isolated subscriber).
- `classlite-web/src/features/writing-attempt/components/WritingPromptBlock.tsx` — `lang="en"` prompt blockquote.
- `classlite-web/src/features/writing-attempt/components/TimeOnTaskMeter.tsx` — count-up time-on-task (aria-live off).
- `classlite-web/src/features/writing-attempt/components/DueDateCountdown.tsx` — calm due-date countdown + crossing announce.
- `classlite-web/src/features/writing-attempt/components/WritingSubmitDialog.tsx` — desktop dialog + mobile slide-up sheet.
- `classlite-web/src/features/writing-attempt/components/SubmittedElsewhereOverlay.tsx` — blocking multi-tab overlay.
- `classlite-web/src/features/writing-attempt/components/WritingAttemptShell.tsx` — the composed shell (Tasks 4/5/6).
- `classlite-web/src/features/writing-attempt/WritingAttemptPage.tsx` — route entry (bootstrap + L/E/E + reconcile).
- `classlite-web/src/features/writing-attempt/index.ts` — barrel.
- Tests: `lib/__tests__/writingContent.test.ts`, `lib/__tests__/liveTextStore.test.ts`, `hooks/__tests__/useOnlineStatus.test.tsx`, `hooks/__tests__/useAttemptBroadcast.test.tsx`, `hooks/__tests__/useWritingReadOnly.test.tsx`, `components/__tests__/WritingEditorLeaf.test.tsx`, `components/__tests__/WordCountMeter.test.tsx`, `components/__tests__/WritingPromptBlock.test.tsx`, `components/__tests__/timerMeters.test.tsx`, `components/__tests__/WritingAttemptShell.test.tsx`, `__tests__/WritingAttemptPage.test.tsx`.

### Modified

- `classlite-web/src/components/domain/WriteDocSurface.tsx` — additive `showToolbar`/`saveSlot`/`dueCountdown`/`wordCountSlot`/`timeSlot` props + restored separator (back-compat for grading/storybook).
- `classlite-web/src/components/domain/MobileWritingSurface.tsx` — de-framed to viewport-fluid; additive `showToolbar`/`saveSlot`/`dueSlot`/`stickyBarSlot`; sticky word STRIP + ≥44px back button; `wordCount` made optional (legacy pill fallback).
- `classlite-web/src/features/assignments/lib/assignmentRow.ts` — `attemptRouteForSkill` writing → `/assignments/${id}/write`.
- `classlite-web/src/routes.tsx` — added the `/assignments/:assignmentId/write` sibling full-bleed student-gated route (lazy deep-import).
- `classlite-web/src/locales/en.json` + `vi.json` — `writing.*` keyset.
- `classlite-web/src/features/assignments/lib/__tests__/assignmentRow.test.ts` + `__tests__/AssignmentsListPage.test.tsx` — updated the writing-route expectations (writing now routes, not "Available soon").
- `_bmad-output/implementation-artifacts/5-3-writing-attempt-interface.md` — `baseline_commit` re-based to HEAD; Tasks/Status/Change Log.

### Deleted

- None.

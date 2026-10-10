# Story 10-4-error-states: Completion Notes

_Implementation record for [`10-4-error-states.md`](./10-4-error-states.md). Status: review._

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Amelia / bmad-dev-story)

### Debug Log

- **Task 0 (baseline-green):** Full vitest on `9087e33` surfaced **2 pre-existing failures** in `DashboardRoute.test.tsx` (teacher-branch). Root cause: Story 10-5 made `RealTeacherDashboard` fire a teacher-scoped `GET /api/classes` (day-one trigger) + the 10-5 code-review patch renders `DashboardErrorAlert` on `classesQuery.isError`; 10-5 patched the sibling `TeacherDashboard.test.tsx` but missed `DashboardRoute.test.tsx` (teacher tests mocked only `/api/dashboard`). **Fixed** (pre-existing-gate, 10-3 precedent) by adding `teacherScopedClassesHandlers` to the two teacher `server.use(...)` calls. Baseline then green.
- **AC2 oracle token change:** re-platforming `DashboardErrorAlert` onto `ErrorState` changed its surface from the neutral `--cl-border`/`--cl-surface` idiom to the canonical red idiom. This is intended (D1 — one canonical idiom; AC1 names the neutral surface the outlier). Characterization tests assert `role="alert"` + copy + retry semantics, not DOM/token snapshots, so the 8 call sites + 295 dashboard/analytics tests stayed green.
- **ClassFormDialog AC6 test harness:** the capacity Upgrade `<Link>` needs a Router — the focused `renderDialogWith` helper had to wrap in `MemoryRouter`. The name-conflict + 422 messages correctly appear in BOTH the inline field AND the top banner, so the test asserts `findAllByText(...).length >= 1` (not a single match). `useBillingSummary` unwraps `.data`, so the billing mock returns `{ data, meta }`.
- **AC5 reframe safety:** the quiz `timeExpired` characterization test triggers via a 409 TIME_EXPIRED racing write with `hardDeadlineAt: null`, so `readOnlyBannerCopy` leaves its copy unchanged (the reframe only fires on a set + passed hard deadline). No existing banner test regressed.

### Completion Notes

**Shipped (all 14 tasks):** canonical `ErrorState` (dumb red-idiom leaf) + full re-platform of the inline `ErrorAlert`s; 8 `ErrorStatePlaceholder` story imports swapped + fixture deleted; s63 penalty clamp + test; s64 deadline-framed copy + extension hint via a shared `readOnlyBannerCopy` spine helper (writing/speaking/quiz shells); s65 `FormValidationBanner` + `InlineFieldError` + client name-conflict + owner-gated capacity cap + 422→setError; s66 clone-only `ReadOnlyStrip` locked view + mid-session 409 `EXERCISE_LOCKED` flip; s67 current-role line; storage "View storage" CTA; `InboxRow` ≥44px; `STORY_10_4_KEYS` ratchet (12 net-new keys, both locales).

**Deviations / scope refinements (pragmatic-interpretation convention, flagged for review):**
- **OnboardingDonePage `ErrorAlert` EXCLUDED from the AC2 re-platform.** It is not the inline red retry-banner idiom — it's an amber, focus-on-mount, `aria-live="assertive"`, disabled-aware, `persistent` orientation `<section>` (`mx-auto mt-16 max-w-lg`). Re-platforming onto the dumb `ErrorState` would regress its focus/assertive/disabled behaviors, which AC2 forbids. Per D1 (inline-only; fullscreen orientation screens stay) it is left in place. The recon table listed it by `function ErrorAlert` name-match without accounting for its divergent shape.
- **s65 capacity Upgrade + s66/storage CTAs are owner-gated.** `GET /api/billing` and `/settings` are owner-only; a member can't act on either, and their copy already says "ask your owner". Teacher capacity-over-cap defers to the 9.2-armed server 409 (FU-10-4-CAPACITY-TEACHER).
- **One extra net-new key beyond the AC enumeration:** `classes.form.errors.capacityUpgradeCta` ("Upgrade plan") — the AC named only `capacityOverPlan`, but the inline Upgrade link needs a label; a dedicated classes-namespaced key is cleaner than reaching into billing's i18n namespace.

**Deferred (per D4 / story Out of Scope):** FU-10-4-WAIVER, FU-10-4-EXTENSION, FU-10-4-TIMELINE (incl. the s66 audit-trail card + lockedBy per-assignment detail), FU-10-4-S67-DIRECTORY, FU-10-4-CAPACITY-TEACHER.

### Implementation Plan (summary, as executed)

0. Baseline-green (+ pre-existing-gate fix) → 1. `ErrorState` + stories + test → 2. `DashboardErrorAlert` oracle re-platform (8 call sites) → 3. fan-out re-platform (ClassesPage/Assignments/Exercises/Staff/Roster/KnowledgeHub + Inbox/Archive wrappers + Rooms/TermCalendar load+save) → 4. placeholder swap (8 stories) + delete fixture → 5. s63 clamp + test → 6. s64 `readOnlyBannerCopy` + 3 shells + keys → 7. s65 `InlineFieldError`/`FormValidationBanner` + ClassFormDialog wiring → 8. s66 `ReadOnlyStrip` + locked gate + autosave 409 → 9. s67 current-role → 10. storage CTA → 11. InboxRow 44px → 12. `STORY_10_4_KEYS` ratchet → 13. final gates.

### Gates

- `tsc -b` = 0 · ESLint = 0 errors (5 pre-existing React-Compiler warnings in untouched `questions/` files; no `--max-warnings`) · full `vitest` **4024 passed / 309 files, 0 regressions** (baseline 3965 + ~59 new) · `npm run i18n-parity` OK (2727 keys) · `storybook:test:ci` — _see Change Log_.
- `codegen.sh` NOT run (no `api.yaml`/`.sql`/migration; WF-7 all imports in `classlite-web/`).

## File List

### Added

- `classlite-web/src/components/domain/ErrorState.tsx` — canonical inline error leaf (AC1)
- `classlite-web/src/components/domain/ErrorState.stories.tsx` — catalog (`no-three-state`)
- `classlite-web/src/components/domain/__tests__/ErrorState.test.tsx`
- `classlite-web/src/components/domain/InlineFieldError.tsx` — per-field red idiom (AC6)
- `classlite-web/src/components/domain/__tests__/InlineFieldError.test.tsx`
- `classlite-web/src/components/domain/FormValidationBanner.tsx` — top-of-form summary (AC6)
- `classlite-web/src/components/domain/__tests__/FormValidationBanner.test.tsx`
- `classlite-web/src/components/domain/ReadOnlyStrip.tsx` — locked-state strip (AC7)
- `classlite-web/src/components/domain/__tests__/ReadOnlyStrip.test.tsx`
- `classlite-web/src/components/domain/__tests__/InboxRow.test.tsx` — 44px structural (AC10)
- `classlite-web/src/features/submission-review/__tests__/LatePenaltyBreakdown.test.tsx` — s63 (AC4)
- `classlite-web/src/lib/test/story10_4Keys.ts` — i18n ratchet (AC11)

### Modified

- `components/domain/DashboardStates.tsx` → wait, `features/dashboard/components/DashboardStates.tsx` — `DashboardErrorAlert` delegates to `ErrorState` (resolved-string props) (AC2 oracle)
- `features/dashboard/{StudentDashboard,RealTeacherDashboard,OwnerDashboard}.tsx` — resolve keys at call site (AC2)
- `features/analytics/components/{AnalyticsHomeContainer,MyPerformanceContainer,StudentPerformanceDetail}.tsx` — same (AC2; +`useTranslation` in AnalyticsHomeContainer)
- `features/classes/ClassesPage.tsx` — `ErrorState` swap + pass `existingNames` (AC2/AC6)
- `features/classes/components/ClassFormDialog.tsx` + `__tests__/ClassFormDialog.test.tsx` — s65 wiring (AC6)
- `features/inbox/components/InboxStates.tsx`, `features/archive/components/ArchiveStates.tsx` — `*ErrorAlert` wrappers delegate to `ErrorState` (AC2)
- `features/assignments/AssignmentsListPage.tsx`, `features/exercises/ExerciseLibraryPage.tsx`, `features/people/StaffListPage.tsx`, `features/people/components/StudentRosterView.tsx`, `features/knowledge-hub/KnowledgeHubPage.tsx` — local `ErrorAlert` → `ErrorState` (AC2)
- `features/settings/RoomsTab.tsx`, `features/settings/TermCalendarTab.tsx` — `ErrorAlert` + `SaveErrorAlert` → `ErrorState` (AC2)
- `features/submission-review/components/LatePenaltyBreakdown.tsx` — clamp (AC4)
- `features/attempts/lib/attemptReadOnly.ts` (+`__tests__/attemptReadOnly.test.ts`), `features/attempts/index.ts` — `readOnlyBannerCopy` + export (AC5)
- `features/writing-attempt/components/WritingAttemptShell.tsx` (+test), `features/speaking-attempt/components/SpeakingAttemptShell.tsx`, `features/quiz-attempt/components/ExerciseAttemptShell.tsx` — deadline banner copy (AC5)
- `features/billing/index.ts` — export `planDisplayName` (AC6)
- `features/exercises/ExerciseEditorPage.tsx` (+test), `features/exercises/hooks/useExerciseAutosave.ts` — locked gate + Clone + 409 flip (AC7)
- `components/shared/PermissionDenied.tsx` (+test) — current-role line (AC8)
- `features/knowledge-hub/components/UploadDialog.tsx` (+`__tests__/UploadDialog.test.tsx`) — View storage CTA (AC9)
- `components/domain/InboxRow.tsx` — ≥44px targets (AC10)
- `components/domain/{MobileWritingSurface,WriteDocSurface,AnchoredQuestionCard,PageHead,InboxListShell,WritingGradingSurface,SpeakingGradingSurface,AnalyticsHomeShell}.stories.tsx` — placeholder→ErrorState (AC3)
- `src/locales/en.json`, `src/locales/vi.json` — 12 net-new keys (AC11)
- `src/lib/test/__tests__/i18n-parity-coverage.test.ts` — Story 10.4 ratchet block (AC11)
- `features/dashboard/__tests__/DashboardRoute.test.tsx` — pre-existing-gate fix (Task 0)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status → in-progress → review

### Deleted

- `classlite-web/src/test/fixtures/error-state-placeholder.tsx` — subsumed by `ErrorState` (AC3)

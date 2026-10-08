# Story 10.3: Completion Notes

_Implementation record for [`10-3-empty-states.md`](./10-3-empty-states.md). Status: review._

## Dev Agent Record

### Debug Log

- **Baseline-green gate (AC7/Task 0):** full web vitest suite on `41b9fd9` recorded GREEN — **299 files / 3899 tests** — before touching any source. Working tree had only the two story `.md` files + `sprint-status.yaml` staged, so the baseline is the clean commit for all `classlite-web/src`.
- **Pre-existing `i18n-parity` CI failure (NOT a 10.3 regression):** `npm run i18n-parity` was already RED at `41b9fd9` on 4 orphan keys `sidebar.{owner,admin,teacher,student}.profile` (the Story 9-4 profile-nav surface added them to a `sidebar.` covered namespace but never claimed them in any `STORY_*_KEYS` array). Confirmed by stashing all my changes and re-running against HEAD. Fixed opportunistically by claiming the 4 keys in `STORY_1D_3_KEYS` (where all other `sidebar.*` chrome keys live) with a note — the DoD requires the parity gate green. **Flagged for Ducdo.**
- **Pre-existing ESLint failure (NOT a 10.3 regression):** `npm run lint` is RED at `41b9fd9` with **6 problems (1 error, 5 warnings)** — the error is `billing/BillingDashboardPage.tsx:69` (setState-synchronously-in-effect) and the warnings are RHF `watch()` `react-hooks/incompatible-library` (incl. `QuestionsConsolePage.tsx:144`, the `BatchActionBar`, untouched by me). My changes add **zero** new lint problems (6 → 6, identical count; all my new files lint clean). **Flagged for Ducdo.**
- **LSP generated-types flood is stale-cache, not real:** throughout dev the editor LSP reported `components['schemas']['Notification' | 'AnalyticsHome' | 'MistakePattern' | …]` "does not exist" errors. These are the known gitignored-codegen stale-cache issue — `npx tsc -b` (the real gate) is exit 0 clean.

### Completion Notes

**Shape of the work.** Story 10.3 is a CONSOLIDATION: build the canonical `EmptyState` (deferred from 1d-5 AC3) + its `GhostedChartFrame` companion, re-platform the 9 in-scope empty surfaces (s54–s62, minus the split-out s53) onto it, and swap+delete the `EmptyStatePlaceholder` fixture. The end user sees no change on the already-complete surfaces (AC3) — the payoff is engineering: one component, placeholder deleted, idiom drift killed.

- **AC1 — `EmptyState`** (`components/domain/EmptyState.tsx`): flat interface (no DU), optional `icon`/`headline`, trailing `headlineAccent` italic brand span (single-source — never recomposed at call sites), `tone='simple'|'guided'`. Guided suppresses the chip (when no icon) and headline (when omitted) so s57/s61/s62 keep their warn-banner/page-head instead of a stamped headline. `live` default off → plain container; `live` → `role="status"`. Never calls `t()` / never reads role. 10 unit tests + axe-zero.
- **AC2 — `GhostedChartFrame`** (`components/domain/GhostedChartFrame.tsx`): net-new minimal chart silhouette (dashed border + `—` placeholders), whole subtree `aria-hidden`, static fill (no pulse). 3 tests incl. the aria-hidden-boundary assertion.
- **AC3 oracle (Task 3):** s56 inbox + s60 archive re-platformed — byte-equivalent copy, `inbox-empty`/`archive-empty` test-ids + `role="status"` (via `live`) preserved. Proven the abstraction (86 inbox+archive tests green).
- **AC4 (Task 4):** s54 classes (brand accent hoisted; `classes.empty.headline` value split "No classes"+accent "yet", rendered copy unchanged), s55 roster (action-less, enrolment=7.3), s58 questions (Q&A-vs-Inbox explainer + Open-Inbox CTA → `/inbox`), s59 knowledge-hub (Upload CTA). Local `EmptyHero`/`EmptyState`/`TrueEmptyHero` deleted (CQ-1); `EmptyFolder`/`InboxFilterEmpty` kept distinct. 279 tests green.
- **AC3 rebuild (Task 5):** s61 analytics (guided + GhostedChartFrame; role branch PRESERVED — owner/admin CTA, teacher hint; predicate allowlist intact), s57 my-performance (guided, no headline; GhostedChartFrame + the `my-performance-ghosted-banner` kept at the call site), s62 student-welcome (guided hero; `useStudentWelcome` gating untouched in the parent). Content pinned PRE-refactor (new `StudentWelcome.test.tsx`) so a flattened checklist cannot pass green. Net-new empty-path axe added for analytics + my-performance.
- **AC5 (Task 6):** all 8 `EmptyStatePlaceholder` story imports swapped to `EmptyState` (`body`→`description`; no icon forced since `icon` is optional); `empty-state-placeholder.tsx` DELETED; `error-state-placeholder.tsx` left for Story 10.4.
- **AC6 (Task 7):** `STORY_10_3_KEYS` (3 net-new: `classes.empty.headlineAccent`, `questions.empty.teacher.explainer` ★, `questions.empty.teacher.openInbox`) in `lib/test/story10_3Keys.ts`, wired into the master ratchet with parity + interpolation + prefix checks. Both locales authored.
- **AC7:** baseline-green recorded; StudentWelcome content pinned pre-refactor; empty-path axe on analytics/my-perf; inbox-lens absence assertion added (student render → teacher/ownerAdmin empty copy absent from DOM).

**★ REVIEWER-MANDATORY (VN-fluent):** `questions.empty.teacher.explainer` — the parity ratchet checks existence + token-shape, never translation correctness. VI value: _"Câu hỏi của học viên trên bài tập sẽ hiện ở đây. Các thông báo cần xử lý ngay — chấm bài, ghi danh và thanh toán — nằm trong Hộp thư của bạn."_

**Deviations / honest notes:**
- s61 owner CTA is a deliberate product departure from the mock (the mock shows no s61 CTA) — kept per the story's AC3 note, not "preserved".
- s62 visual changes from a tinted `Card` to the guided `EmptyState` layout (rebuild tier — copy/behavior/test-ids preserved, not a pixel re-skin; assertions are semantic, never DOM snapshots).
- Two pre-existing broken CI gates (i18n-parity orphan, ESLint billing error) — see Debug Log.

### Implementation Plan (as executed)

1. Baseline-green gate + pin `StudentWelcome` content on the OLD component (Task 0).
2. Build `EmptyState` + `GhostedChartFrame` + stories (`// storybook-rule: no-three-state`) + unit/axe tests (Tasks 1–2).
3. Re-platform the two oracles — inbox + archive (Task 3).
4. Upgrade the four partials — classes / roster / questions / knowledge-hub (Task 4).
5. Rebuild the three risky surfaces — analytics / my-performance / student-welcome, each with its own green run; add empty-path axe (Task 5).
6. Swap the 8 placeholder story imports; delete the placeholder fixture (Task 6).
7. Author net-new keys + `STORY_10_3_KEYS` ratchet wiring + inbox-lens absence assertion (Task 7).
8. Final gates (Task 8).

## File List

### Added
- `classlite-web/src/components/domain/EmptyState.tsx` — canonical empty-state leaf (AC1)
- `classlite-web/src/components/domain/EmptyState.stories.tsx` — inventory catalog (AC1)
- `classlite-web/src/components/domain/GhostedChartFrame.tsx` — ghosted chart frame (AC2)
- `classlite-web/src/components/domain/GhostedChartFrame.stories.tsx` — (AC2)
- `classlite-web/src/components/domain/__tests__/EmptyState.test.tsx` — contract + axe tests
- `classlite-web/src/components/domain/__tests__/GhostedChartFrame.test.tsx` — aria-hidden boundary + axe
- `classlite-web/src/features/dashboard/components/__tests__/StudentWelcome.test.tsx` — AC7 content-pin
- `classlite-web/src/lib/test/story10_3Keys.ts` — exhaustive net-new key ratchet (AC6)

### Modified
- `classlite-web/src/features/inbox/components/InboxStates.tsx` — `InboxEmpty` → `EmptyState` (AC3 oracle)
- `classlite-web/src/features/archive/components/ArchiveStates.tsx` — `ArchiveEmpty` → `EmptyState` (AC3 oracle)
- `classlite-web/src/features/classes/ClassesPage.tsx` — `EmptyHero` → `EmptyState`; delete local (AC4)
- `classlite-web/src/features/people/components/StudentRosterView.tsx` — local `EmptyState` → shared (AC4)
- `classlite-web/src/features/questions/QuestionsConsolePage.tsx` — inline empty → `EmptyState` + explainer + Open-Inbox CTA (AC4)
- `classlite-web/src/features/knowledge-hub/KnowledgeHubPage.tsx` — `TrueEmptyHero` → `EmptyState`; delete local (AC4)
- `classlite-web/src/features/analytics/components/AnalyticsHome.tsx` — s61 rebuild: guided `EmptyState` + `GhostedChartFrame`, role branch preserved (AC3)
- `classlite-web/src/features/analytics/components/MyPerformanceContainer.tsx` — s57 rebuild: guided `EmptyState` + `GhostedChartFrame`, banner preserved (AC3)
- `classlite-web/src/features/dashboard/components/StudentWelcome.tsx` — s62 rebuild: guided `EmptyState` hero (AC3)
- `classlite-web/src/components/domain/{AnalyticsHomeShell,AnchoredQuestionCard,InboxListShell,MobileWritingSurface,PageHead,SpeakingGradingSurface,WriteDocSurface,WritingGradingSurface}.stories.tsx` — placeholder → `EmptyState` (AC5)
- `classlite-web/src/features/analytics/__tests__/AnalyticsHome.test.tsx` — net-new empty-path axe + aria-hidden boundary (AC7)
- `classlite-web/src/features/analytics/__tests__/student_patterns_softened.test.tsx` — net-new empty-path axe (AC7)
- `classlite-web/src/features/inbox/components/__tests__/InboxView.test.tsx` — TEST-FE-6 lens-absence assertion (AC7)
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — Story 10.3 parity block + `sidebar.*.profile` orphan fix
- `classlite-web/src/locales/en.json` / `vi.json` — net-new keys + classes headline/accent split (AC6)

### Deleted
- `classlite-web/src/test/fixtures/empty-state-placeholder.tsx` — superseded by the canonical `EmptyState` (AC5; `error-state-placeholder.tsx` left for Story 10.4)

## Pre-existing gate fixes (Ducdo: "fix the pre existings", 2026-10-08)

After the initial implementation flagged 3 pre-existing RED full-project gates, Ducdo directed fixing them. All now GREEN:

1. **i18n-parity** — `sidebar.{owner,admin,teacher,student}.profile` (Story 9-4 profile nav, never claimed) added to `STORY_1D_3_KEYS`.
2. **ESLint** — `billing/BillingDashboardPage.tsx:69` setState-synchronously-in-effect: the reconcile flag now seeds from the return URL via a lazy `useState` initializer, so the effect only clears it in `.finally` (18 billing tests still green). Exit 0; 5 benign pre-existing RHF `watch()` warnings remain.
3. **storybook:test:ci** — Ducdo chose to make route-page stories a FIRST-CLASS tier (vs delete/relocate): added `../src/features/*/*.stories.@(ts|tsx)` to `.storybook/main.ts` + a one-segment `features/<area>/*.stories.tsx` pattern to `fw7-placement.ts` (+ its test), and `// storybook-rule: no-three-state` on 14 page/presentational stories. This made 14 catalog-invisible stories render + smoke-test for the first time, surfacing **18 genuine latent defects** (fixed; 3 parallel fork subagents + direct work):
   - **Onboarding (CenterSetup/OnboardingDone/PersonaSelect)** — sessions were seeded into the global `queryClient` singleton, not the preview's `useQueryClient()` client → stuck on `skeleton-onboarding`. Fixed with `SeedSession` decorators.
   - **LoginPage** — localStorage lockout pollution leaked across stories (the `Lockout` stories' key was never cleared). Fixed with a meta decorator clearing `classlite_login_lockout_until`.
   - **VerifyEmailPage** — `Expired` poll fired past the 1s findBy timeout (→ `waitFor` 9s); `Mobile390LongEmail` session seeded into the wrong client (→ `withSeededSession` decorator).
   - **OnboardingDonePage `Error500Persistent`** — retry clicks coalesced (no wait for the `disabled→enabled` fetch settle) so `retryCount` never hit the threshold; fixed by waiting for the button to re-enable between clicks.
   - **SampleDashboardPreview** — `opacity-50` on the stat `<ul>` dropped slate text to 1.94:1; removed it, bumped the placeholder to slate-500.
   - **CenterSetupPage** — a draft-rehydrate race (→ `waitFor` the value) AND a REAL component a11y bug: the logo-initials chip hardcoded `text-white`, failing WCAG contrast on mid-tone brand colors (amber `#d97706` → 3.2:1). Fixed with a new `readableTextColor(hex)` luminance helper (+ unit test guarding all 6 palette colors ≥4.5:1).

**Also fixed — the `writing-attempt/WritingAttemptShell.test.tsx` full-suite flake.** It intermittently failed ~1 of its multi-tab / 413 / focus tests per full `npm run test` (a different one each run) yet passed 8/8 isolated → real-timer starvation under the parallel suite (40ms autosave / async focus-move slipping past RTL's default 1s `waitFor`), not a logic bug. Fixed without touching the component: `configure({ asyncUtilTimeout: 5000 })` scoped to the file (beforeAll/afterAll) + wrapped the one synchronous `toHaveFocus()` in `waitFor`. Validated with 3 consecutive clean full-suite runs (302 files / 3934 tests each).

### Additional files (gate fixes)
- Added: (test) assertions in `onboarding/lib/__tests__/letterMark.test.ts` for `readableTextColor`.
- Modified: `.storybook/main.ts`, `src/test/storybook-rules/fw7-placement.ts` (+ `.test.ts`), `src/features/billing/BillingDashboardPage.tsx`, `src/features/dashboard/SampleDashboardPreview.tsx`, `src/features/onboarding/lib/letterMark.ts`, `src/features/onboarding/CenterSetupPage.tsx`, and 14 `features/{auth,dashboard,onboarding}/*.stories.tsx` (+ `auth/components/Banner.stories.tsx`) — `no-three-state` opt-out + per-story defect fixes.

## Party-Mode Review Appendix

N/A at implementation time — the pre-dev party-mode review was folded into the story spec before dev (see the story Change Log). Post-implementation review pending (`/bmad-code-review 10-3`, different LLM).

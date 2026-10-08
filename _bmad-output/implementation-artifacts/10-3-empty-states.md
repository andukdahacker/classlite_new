---
baseline_commit: 41b9fd961aab9c66c2e91955c59dbed29a4712ae
---

# Story 10.3: Empty States

Status: done

## Story

As a **user (teacher / student / admin / owner)**,
I want **helpful, role-specific, i18n'd empty states throughout the app, all rendered through one canonical component**,
so that **I understand what a feature does and how to get started when there is no data yet — and the codebase stops carrying ten hand-rolled "no data" boxes that drift apart.**

## Context & the one thing to understand first

**This is a consolidation + polish story.** Nearly every screen already ships a working Loading/Empty/Error trilogy (UX-1 is enforced from day one). The canonical `EmptyState` component that was supposed to unify them was **deferred out of Story 1d-5** into *this* story (1d-5 AC3 is the design brief — `1d-5-shells-and-states.md:60-90`). Until now, feature pages used ad-hoc local empties, plus a stand-in fixture `src/test/fixtures/empty-state-placeholder.tsx` (imported by 8 domain `.stories.tsx`) whose own header says: *"the canonical `EmptyState` ships in Epic 10 Story 10.3 … a find-replace swaps the import path; the `EmptyStatePlaceholder` directory is then deleted in the same PR."*

**10.3 = build the canonical `EmptyState`, re-platform the empty surfaces onto it, swap+delete the placeholder.**

> **Honest value framing (party-mode, John):** the end-user sees **no change** on the 5 already-complete surfaces (AC3 guarantees it). D1's payoff is **engineering**, not user-facing: delete the placeholder, kill idiom drift, one component to evolve. That payoff is real and is anchored to **AC5 (swap+delete)** + drift-prevention — not to "the user notices consistency." Build it for the code-health reason, state it as such.

### Ducdo rulings (2026-10-07, /bmad-create-story 10-3)

- **D1 — refactor ALL surfaces** onto `EmptyState` (incl. the 5 already-complete ones) for one idiom. "Refactor" = route each surface's empty render through the shared component while **preserving semantics/gating/test-ids/tests** (no behavior regression). ⚠️ The 5 complete surfaces are **two risk tiers** (party-mode, Winston): *trivial 1:1* = s56 inbox + s60 archive (the exact idiom `EmptyState` is abstracted from — the proving oracle); *structural rebuild wearing a "re-platform" label* = s57 my-performance, s61 analytics (today a `📊` emoji + raw button / a one-line dashed banner — NOT the ghost-chip idiom; moving them onto `EmptyState`+`GhostedChartFrame` is a genuine visual rebuild), s62 student-welcome (additive, `useStudentWelcome`-gated). Sequence accordingly (see Tasks).
- **D2 — pragmatic single primary CTA** per the UX mock. The epic AC's "three paths" (s54/s55/s59) are the *illustrative* body; the epic's binding close (`epic-10.md:167`) is "each offers **at least one** actionable path forward." §6.4 confirms single-CTA is canonical, multi-path (`es-help →`) the exception. True multi-path lists → **FU-10-3-MULTIPATH-CTA**. ⚠️ Corrected scope of that FU (party-mode, John): the deferred paths are s54 template/from-archive **+ the ghosted "populated preview"**, s55 share-link/email/**add-from-unassigned**, s59 **create-folder (ships as topbar `newFolder`)** / **link-from-exercise** — NOT "URL".
- **D3 — s53 TeacherDayOne guided empty is SPLIT OUT** → new **Story 10-5-teacher-day-one** (party-mode, John + Sally). It is a net-new *activation* surface (3-step progress funnel with done-states, new copy, new interaction logic, open design questions) — not an empty state, and it carries the only net-new behavior in a story otherwise defined as "change nothing the user sees." `EmptyState`'s `tone='guided'` is still built + exercised here by the s62 student story; 10-5 consumes it.
- **D4 — the <44px InboxRow touch-target** (10-1b deviation #5) → **Story 10.4**. 10.3 does not touch `InboxRow`.

## Acceptance Criteria (BDD)

> **WF-8:** No risk-score ≥6 AC *for new-feature correctness* — pure frontend, no API/DB/RLS/auth (`codegen.sh` NOT run; WF-7 all imports in `classlite-web/`). ATDD tagged red-phase NOT mandatory. **BUT the dominant risk is silent regression on the 5 shipped surfaces (D1)** → the mitigation is **characterization-first**: baseline-green, pin copy before refactor, run-green→refactor→run-green (see AC7 + Tasks). Honor **R52** (Storybook three-state rule, live since 1d-1): `Empty` stories MSW-driven (empty arrays), never a mocked `useQuery`. One residual ≥6 is VN-copy correctness → ★ REVIEWER-MANDATORY (AC6).

### AC1 — Canonical `EmptyState` component (1d-5 AC3, UX-DR31)

**Given** the empty-state proliferation across s54–s62,
**When** inspecting `src/components/domain/EmptyState.tsx`,
**Then** ONE component covers all variants via prop composition (NOT N components), with this contract:

```ts
export type EmptyStateTone = 'simple' | 'guided'

export interface EmptyStateProps {
  icon?: ReactNode             // ghosted lucide glyph; OPTIONAL — renders a bare muted chip when absent, nothing when tone='guided' suppresses it
  headline?: string            // i18n-resolved — OPTIONAL: required in spirit for tone='simple'; omittable for tone='guided' where a page-head/warn-banner carries the message
  headlineAccent?: string      // i18n-resolved; rendered as a TRAILING italic text-[color:var(--cl-accent)] span appended to headline (§6.4 brand signature). Trailing only — no mid-string accent needed (all mocks are trailing)
  description?: string         // i18n-resolved, optional
  actions?: ReactNode          // zero or more CTAs; renders nothing if absent (s60 archive has none)
  tone?: EmptyStateTone        // default 'simple' (ghost-chip + headline idiom); 'guided' = wider, children-carrying, chip/headline suppressible
  children?: ReactNode         // guided-only rich content (GhostedChartFrame, warn-banner, next-session hero) below/instead-of the headline
  live?: boolean               // async-arrival announcement: default (false) renders NO live role (plain div, not announced on first paint); true → role="status" (implies aria-live=polite)
  'data-testid'?: string
}
```

**And** the `tone='simple'` visual idiom generalizes the shipped `InboxEmpty`/`ArchiveEmpty` pattern exactly (`InboxStates.tsx:85-110`, `ArchiveStates.tsx:57-82`): circular muted ghost-icon chip (`size-14`, `bg-muted/50`), Fraunces/`--cl-font-display` headline with optional `headlineAccent` as a **trailing** `<span className="italic text-[color:var(--cl-accent)]">`, muted `--cl-ink-soft` description (`max-w-sm`), centered `actions`. The accent span is the **brand invariant** — it lives ONLY inside this component, never recomposed at call sites (that was the point of consolidating).
**And** `tone='guided'` **suppresses the chip/headline/headlineAccent when the consumer omits them** and renders `children` in a wider container — so a day-one or ghosted surface that already carries its message in a page-head `<h1>` or a warn-banner does NOT get a second redundant headline stamped on top (party-mode: Sally/Winston/Murat — this is the guard against flattening s57/s61/s62 into a headline-shaped hole).
**And** the component **never reads role** and **never calls `t()`** — all strings arrive i18n-resolved from the consumer (UX-3 role-decorator at the call site; UX-1/TEST-FE-4). The flat interface above is intentional — **no discriminated union** (a DU buys ~no safety on a dumb presentational leaf and fights ergonomics).
**And** a11y: default (`live` unset) renders a plain container (NOT `role="status"`, which would make a first-paint empty announce as if it just arrived); `live` promotes it to `role="status"`. Async-loaded empties (inbox/archive/analytics/my-performance — data fetched, then empty) pass `live`; mount-present/gated surfaces (student-welcome) do not. Decorative icons/frames are `aria-hidden`.
**And** `EmptyState.stories.tsx` ships the inventory variants (ClassesEmpty/RosterEmpty/InboxEmptyTeacher/InboxEmptyStudent/InboxEmptyOwner/QuestionsEmpty/KnowledgeHubEmpty/ArchiveEmpty/AnalyticsNoData/MyPerformanceEmpty/StudentDayOne), every string i18n-resolved via `t()`, axe-zero. **It carries `// storybook-rule: no-three-state`** — the three-state rule enforces Default/Loading/Empty/Error on EVERY `.stories.tsx` under `components/domain/` (it is NOT suffix-globbed; `required-exports.ts:103-123`), so without the opt-out the Storybook test-runner setup throws.

### AC2 — `GhostedChartFrame` companion (s57 / s61)

**Given** the two data-surface ghosted states (s57 My Performance, s61 Analytics) — which today render *differently* (s57 a one-line dashed banner; s61 a `📊` emoji box) and do NOT share a chart-shaped frame,
**When** inspecting `src/components/domain/GhostedChartFrame.tsx`,
**Then** it renders a **minimal** chart-shaped frame at reduced opacity (dashed `--cl-line-soft` border + em-dash `—` placeholders) that consumers drop into an `EmptyState` (`tone='guided'`) `children` slot. This is **net-new UI** (not a DRY extraction — label it honestly), justified only because the two data surfaces *should* look alike.
**And** it is presentation-pure (no data, no role); the decorative frame + `—` placeholders are inside an `aria-hidden` subtree, so the region's accessible name comes ONLY from the surrounding `EmptyState` copy (never "dash dash dash").
**And** the **amber threshold banner stays at the my-performance call site** (it is the existing `my-performance-ghosted-banner`, a `MIN_GRADED_FOR_PATTERNS`-specific concept with its own test-id; analytics-class-empty has no threshold) — do NOT push a one-consumer slot into the shared component.
**And** stories: `Default`; axe-zero; `motion-reduce:animate-none` (or static fill) if any pulse ships.

### AC3 — Re-platform the existing empty surfaces onto `EmptyState` (D1)

**Given** the surfaces below, **when** re-platformed, **then** behavior/gating/role-scoping/test-ids/tests are **preserved** — and for the structural-rebuild tier the dev treats it as new-component integration (new aria-hidden boundary + test-id reattachment), not a cosmetic re-skin:

| Tier | Screen | File | Rule |
|---|---|---|---|
| 1:1 (oracle) | s56 Inbox | `features/inbox/components/InboxStates.tsx` → `InboxEmpty({lens})` | Role-decorator stays at call site (`inbox.empty.${lens}.{title,titleAccent,body}`). Pass `live`. Keep `InboxFilterEmpty` **distinct** (filtered-no-match ≠ day-one; 10-1b D2c). Keep skeleton/error untouched (10-4 owns errors). Preserve `data-testid="inbox-empty"`. |
| 1:1 (oracle) | s60 Archive | `features/archive/components/ArchiveStates.tsx` → `ArchiveEmpty()` | Via `EmptyState`, no actions, `live`. Preserve `data-testid="archive-empty"`. |
| rebuild | s57 My Performance | `features/analytics/components/MyPerformanceContainer.tsx:57-64`, `StudentPerformanceOverview.tsx` | Below-threshold (`gradedSubmissionCount < MIN_GRADED_FOR_PATTERNS`) → `EmptyState tone='guided'` (no stamped headline) + `GhostedChartFrame` + the existing warn-banner in `children`. Preserve the threshold + `my-performance-ghosted-banner`/zone test-ids. Add empty-path axe (new). |
| rebuild | s61 Analytics | `features/analytics/components/AnalyticsHome.tsx:81-111` | `data.classes.length === 0` → `EmptyState tone='guided'` + `GhostedChartFrame`. **Preserve the role branch**: owner/admin get the actionable `navigate('/classes')` CTA in `actions`; teacher gets the non-actionable hint. Preserve `analytics-home-empty`/`-teacher-hint` test-ids + the `role:null\|undefined`-renders-no-owner-card predicate sweep. Add empty-path axe (new). **Note: the owner CTA is a deliberate addition beyond the mock (which shows no s61 CTA) — keep it, but it is a product departure, not "preserved."** |
| rebuild (gated) | s62 Student day-one | `features/dashboard/components/StudentWelcome.tsx` (gated by `useStudentWelcome`) | `EmptyState tone='guided'` with the next-session line + starter checklist (`dashboard.welcome.step1/2/3`) + accent in `children`/props, dismiss CTA in `actions`, default (no `live`). **Preserve the additive durable-flag gating** (gating lives in the parent `StudentDashboard`, not the component body). ⚠️ **Pin this surface's content BEFORE refactoring** (AC7) — its current tests assert the wrapper but NOT the checklist/accent/nextSession, so a flattening would pass green. |

**And** no existing Vitest/axe test for these surfaces regresses; re-platforming does not change rendered copy or role behavior (the *structure* changes on the rebuild tier — keep assertions semantic: test-id/role/name/copy, **never DOM snapshots**).

### AC4 — Upgrade the PARTIAL surfaces onto `EmptyState`

| Screen | File | Change |
|---|---|---|
| s54 Classes | `features/classes/ClassesPage.tsx` (`EmptyHero` local fn :402) | Replace with `EmptyState` (`tone='simple'`, `live`): classes glyph, `classes.empty.headline`+accent, single "Create class" CTA (topbar `classes.createCta` stays — confirmed shipped). Keep the per-tab quiet `classes.emptyTab` note as-is (filtered). |
| s55 Roster | `features/people/components/StudentRosterView.tsx` (local `EmptyState` :573) | Replace with the shared `EmptyState` (`live`). **No invented add/invite CTA** — enrolment UI is Epic 7.3; the roster empty is action-less today (like s60) and stays so here. Preserve `people.student.list.empty.*` copy + test-ids. The invite paths defer → FU-10-3-MULTIPATH-CTA (+ depend on 7.3). |
| s58 Questions | `features/questions/QuestionsConsolePage.tsx:192` (`questions-console-empty`) | Replace inline empty with `EmptyState` + **add the Q&A-vs-Inbox explainer** as `description` (net-new `questions.empty.teacher.explainer`, ★ REVIEWER-MANDATORY VN). Single "Open Inbox" CTA. |
| s59 Knowledge Hub | `features/knowledge-hub/KnowledgeHubPage.tsx` (`TrueEmptyHero` :588 / `EmptyFolder` :603) | Replace `TrueEmptyHero` with `EmptyState` (`tone='simple'`, single "Upload files" CTA; topbar `knowledgeHub.actions.newFolder` + Upload stay). Keep `EmptyFolder` as the quiet filtered variant. "Link from exercise" path defers → FU-10-3-MULTIPATH-CTA. |

**And** each upgraded surface preserves its loading-skeleton + error branches (unchanged).

### AC5 — Swap and delete the placeholder (same PR)

**Given** `src/test/fixtures/empty-state-placeholder.tsx` (`EmptyStatePlaceholder`), imported by exactly 8 Storybook files (`MobileWritingSurface`, `WriteDocSurface`, `AnchoredQuestionCard`, `PageHead`, `InboxListShell`, `WritingGradingSurface`, `SpeakingGradingSurface`, `AnalyticsHomeShell` — all `.stories.tsx` in `components/domain/`),
**When** 10.3 lands,
**Then** every import is swapped to `EmptyState`, mapping props explicitly: placeholder `{headline?, body?, actionLabel?, onAction?}` → `EmptyState {headline, description: body, actions: <Button onClick={onAction}>{actionLabel}</Button>}`. Because `icon` is **optional** (AC1), a story passing no icon keeps compiling — no forced icon decision across the 8.
**And** `src/test/fixtures/empty-state-placeholder.tsx` is **deleted**; the sibling `error-state-placeholder.tsx` is **left intact** (Story 10.4).
**And** `npm run storybook:test` stays green — every swapped story still exports a satisfying `Empty` story (R52 is a name-set check; it throws in setup if an `Empty` export is lost). Confirm `storybook:test` actually **executes** the stories (play/smoke), not just the setup scan — the name-check alone would pass a broken-render swap.

### AC6 — i18n parity ratchet (STORY_10_3_KEYS) + VN correctness

**Given** the net-new keys this story adds,
**When** wiring the ratchet,
**Then** a plain module (`src/features/<feature>/__tests__/*I18nKeys.ts` or shared `src/lib/test/story10_3Keys.ts`) exports `STORY_10_3_KEYS: readonly string[]` — **exhaustive, net-new only** (do NOT re-list `inbox.empty.*`/`archive.empty.*` — s56/s60 own them, or the orphan/dup guard trips),
**And** it is imported into the master ratchet `src/lib/test/__tests__/i18n-parity-coverage.test.ts` with a `describe('Story 10.3 i18n parity', …)` running `assertI18nParity`, `assertI18nInterpolationParity`, and the closed-enumeration prefix ratchet (10-2 precedent: `archiveI18nKeys.ts`),
**And** every net-new string exists in BOTH `en.json` + `vi.json` (VN co-primary, UX-2); `{{token}}` sets match across locales,
**And** ⚠️ the net-new **prose** copy — `questions.empty.teacher.explainer` (and any other net-new sentence-length string) — is flagged **★ REVIEWER-MANDATORY (VN-fluent)**: the parity ratchet checks key *existence* and token-shape, NEVER translation *correctness* (a `vi` value that is verbatim English passes green). This restores the prior-story precedent (1-8, 1-9a-d carried this flag on net-new user-facing copy).

### AC7 — Characterization-first regression discipline + a11y discharge

**Given** D1 re-platforms 5 shipped surfaces,
**When** executing,
**Then**:
- **Baseline-green gate:** run the full existing suite on `41b9fd9` and record it green **before** touching anything ("no regression" is meaningless without a proven baseline).
- **Pin the structure-blind surface BEFORE refactor:** add content assertions to `StudentWelcome` (s62) — assert `step1/step2/step3`, the accent, and the nextSession line render on the OLD component — so the re-platform cannot silently drop them (current tests assert only wrapper + gating; parity stays green on a dropped-but-present key, so only a render assertion catches it).
- **Empty-path axe (net-new):** AnalyticsHome + MyPerformance **empty** renders get `vitest-axe` assertions — the existing axe tests run on *populated* data only; the new `GhostedChartFrame` aria-hidden boundary is unasserted today. Assert the frame subtree is `aria-hidden` AND the region's accessible name comes only from the `EmptyState` copy.
- **Everything else:** run-green → refactor → run-green. Do NOT scaffold net-new characterization for the Analytics role-branch or inbox lens — those suites already exist and are strong (`AnalyticsHome.test.tsx` predicate sweep; `StudentDashboard.test.tsx` gating P0-negative; `InboxView` lens absence).
- **a11y:** `role`/`live` per AC1; TEST-FE-6 **absence** assertion for the inbox lens (teacher copy absent from DOM on student render, not merely hidden); en + vi render for every surface (overflow); `motion-reduce` on any pulse.

## Tasks / Subtasks

> **Sequence is risk-ordered** (party-mode, Winston): prove the component on the oracle before the dangerous moves.

- [x] **Task 0 (AC7):** Baseline-green — run full suite on `41b9fd9`, record green. Pin `StudentWelcome` content on the OLD component (step1/2/3 + accent + nextSession).
- [x] **Task 1 (AC1):** Build `src/components/domain/EmptyState.tsx` per the contract (flat interface, optional `icon`/`headline`, trailing `headlineAccent`, `tone` suppresses chip/headline under guided, `live`→`role="status"`). `EmptyState.stories.tsx` with the inventory variants + `// storybook-rule: no-three-state`; axe-zero.
- [x] **Task 2 (AC2):** Build `src/components/domain/GhostedChartFrame.tsx` (minimal, `aria-hidden` frame + `—`; threshold banner stays at call site) + `GhostedChartFrame.stories.tsx` (+ `no-three-state` opt-out); axe-zero; `motion-reduce` if pulsing.
- [x] **Task 3 (AC3 oracle):** Re-platform **s56 inbox + s60 archive** onto `EmptyState` (pass `live`). These prove the abstraction — if they can't render byte-equivalent, stop and fix the contract. Keep `InboxFilterEmpty` distinct; keep skeletons/error alerts.
- [x] **Task 4 (AC4):** Upgrade the PARTIAL greenfield consumers — s54 classes, s55 roster (no invented CTA), s58 questions (+ explainer), s59 knowledge-hub. No prior tests to regress here.
- [x] **Task 5 (AC3 rebuild):** Migrate the risky three LAST, each its own reviewable unit with its own green run: s61 analytics (preserve role branch + predicate sweep; add empty axe), s57 my-performance (preserve threshold + warn-banner; add empty axe), s62 student-welcome (preserve `useStudentWelcome` gating; content now pinned by Task 0).
- [x] **Task 6 (AC5):** Swap the 8 `EmptyStatePlaceholder` story imports → `EmptyState` (explicit prop map); delete the placeholder fixture; leave `error-state-placeholder.tsx`. Confirm `storybook:test` executes stories + stays green.
- [x] **Task 7 (AC6):** Author net-new keys in `en.json`+`vi.json`; build the exhaustive `STORY_10_3_KEYS`; wire into `i18n-parity-coverage.test.ts`; flag prose keys ★ REVIEWER-MANDATORY VN.
- [x] **Task 8 (AC7):** Final gates — `tsc -b`=0, ESLint=0, `vitest` 0-regression, `storybook:test` green, `i18n-parity` green; inbox-lens absence test; en/vi overflow; empty-path axe on analytics/my-perf.

### Review Findings

_Code review 2026-10-08 (/bmad-code-review 10-3, Amelia; Blind Hunter + Edge Case Hunter + Acceptance Auditor @ Opus). Diff `fefd965^..fefd965`. 3 decision-needed resolved (Ducdo: 1a accept · 2b patch · 3a accept), 8 patches APPLIED, 3 dismissed (2 noise + 1 FP). Gates re-verified: vitest 7f/1112t · tsc -b=0 · ESLint 0 · i18n-parity OK._

- [x] [Review][Decision→Dismissed] Bundled production-behavior changes in a "change-nothing" story — "fix the pre existings" carries real component edits beyond gate-greening (billing lazy-seed, SampleDashboardPreview contrast, `readableTextColor` WCAG fix, WritingAttemptShell flake). **Ducdo 1a: accept — intended to ride this PR.**
- [x] [Review][Patch] FW-7 hard-rule relaxed repo-wide → **narrowed (Ducdo 2b).** Replaced the unconditional `features/<area>/*.stories.tsx` allow with an explicit `ROUTE_PAGE_STORIES` allowlist (13 registered pages); an unregistered feature-root story now fails with a "register-or-move-to-/components/" reason. Restored the `features/grading/GradingCard.stories.tsx` negative test + added a non-`Page`-suffixed registered positive. (blind+auditor) [classlite-web/src/test/storybook-rules/fw7-placement.ts, fw7-placement.test.ts]
- [x] [Review][Decision→Dismissed] Re-platform behavior deltas on the 3 PARTIAL surfaces (classes/roster/knowledge-hub) — lost dashed-border card + gained net-new `role="status"`. **Ducdo 3a: accept — exactly what D1 one-idiom consolidation intends.**
- [x] [Review][Patch] Vacuous a11y assertion `not.toHaveTextContent('— — — —')` → replaced with a dash-under-`aria-hidden`-ancestor walk (the spaced literal could never match the unspaced DOM, and `toHaveTextContent` reads `aria-hidden` text so it proved nothing). [classlite-web/src/components/domain/__tests__/GhostedChartFrame.test.tsx, classlite-web/src/features/analytics/__tests__/AnalyticsHome.test.tsx]
- [x] [Review][Patch] Dead locale key `questions.empty.teacher.body` retired from en.json/vi.json + its `STORY_7_4B_KEYS` parity entry. [classlite-web/src/locales/en.json, vi.json, i18n-parity-coverage.test.ts]
- [x] [Review][Patch→Dismissed FALSE-POSITIVE] 9-4 keys under `STORY_1D_3_KEYS` is NOT mis-attribution — the parity file header (L160-164) documents that all `sidebar.*`/chrome-namespace keys are "1D-owned" and MUST live in a `STORY_1D_*_KEYS` array by namespace (precedents: 7.2b, 7.3b, 2.7 all do this). Refiling into a `STORY_9_4_KEYS` array would BREAK the parity script. No change.
- [x] [Review][Patch] Stale doc comment referencing deleted `EmptyStatePlaceholder` corrected. [classlite-web/src/test/fixtures/error-state-placeholder.tsx]
- [x] [Review][Patch] `headlineAccent` dropped when `headline` omitted → gate now `headline || headlineAccent`; accent renders standalone in the `<h2>` (no stray leading space). Added `EmptyState.test.tsx` coverage. [classlite-web/src/components/domain/EmptyState.tsx]
- [x] [Review][Patch] Guided + `live` with only `aria-hidden` children (latent) → hardened the `live` prop docstring to a call-site invariant (a runtime guard would regress my-perf, which legitimately passes `live` with a visible-child banner and no headline/description; the component can't cheaply tell an announceable child from a hidden-only one). [classlite-web/src/components/domain/EmptyState.tsx]
- [x] [Review][Patch] Inbox lens-absence test → each other-lens absence assertion now guarded on the accent being lexically distinct from the student's, so a future shared-accent copy edit can't flip it to a false failure. [classlite-web/src/features/inbox/components/__tests__/InboxView.test.tsx]
- [x] [Review][Patch] English-only negative regex `/your next session/i` → derives the locale's own next-session prefix from the template via a sentinel split (guards under a non-EN default locale). [classlite-web/src/features/dashboard/components/__tests__/StudentWelcome.test.tsx]

## Dev Notes

### The reuse map (verdict → file → action)

| AC-screen | Verdict today | File (classlite-web/src) | 10.3 action |
|---|---|---|---|
| s54 Classes | PARTIAL (local `EmptyHero`, 1 CTA) | `features/classes/ClassesPage.tsx:206,:402` | Upgrade (AC4) |
| s55 Roster | PARTIAL (local `EmptyState`, **no add action — 7.3**) | `features/people/components/StudentRosterView.tsx:573` | Upgrade, no invented CTA (AC4). Class-detail `StudentsTab` ComingSoonPanel stays Epic 7.3. |
| s56 Inbox | COMPLETE (1:1 oracle) | `features/inbox/components/InboxStates.tsx:85` | Re-platform (AC3) |
| s57 My Performance | COMPLETE but **rebuild** (dashed banner) | `features/analytics/components/MyPerformanceContainer.tsx:57`, `StudentPerformanceOverview.tsx:132` | Re-platform + `GhostedChartFrame` (AC3, Task 5) |
| s58 Questions | PARTIAL (inline, no explainer) | `features/questions/QuestionsConsolePage.tsx:192` | Upgrade + explainer (AC4) |
| s59 Knowledge Hub | PARTIAL (`TrueEmptyHero`, 1 CTA) | `features/knowledge-hub/KnowledgeHubPage.tsx:194,:588,:603` | Upgrade (AC4) |
| s60 Archive | COMPLETE (1:1 oracle) | `features/archive/components/ArchiveStates.tsx:57` | Re-platform (AC3) |
| s61 Analytics | COMPLETE but **rebuild** (emoji+button, role-branched) | `features/analytics/components/AnalyticsHome.tsx:81` | Re-platform + `GhostedChartFrame` (AC3, Task 5) |
| s62 Student day-one | COMPLETE but **rebuild+gated** (additive) | `features/dashboard/components/StudentWelcome.tsx:26` (`hooks/useStudentWelcome.ts`) | Re-platform guided, keep gating; pin content first (AC3/AC7, Task 5) |
| ~~s53 Teacher day-one~~ | MISSING | — | **SPLIT OUT → Story 10-5** (D3) |

### The two canonical idioms to generalize (read first)

`InboxStates.tsx` `InboxEmpty({lens})` and `ArchiveStates.tsx` `ArchiveEmpty()` — identical shape: ghost `size-14 bg-muted/50` chip, `font-[var(--cl-font-display)] text-2xl` headline, trailing `<span className="italic text-[color:var(--cl-accent)]">` accent, `max-w-sm text-sm text-[color:var(--cl-ink-soft)]` body, `role="status"`, `data-testid`. `EmptyState` is these two with glyph/strings/actions hoisted to props: `title`→`headline`, `titleAccent`→`headlineAccent`, `body`→`description`. (Contract adds optional `headlineAccent` because the project has no `<Trans>` and the brand accent must stay single-source inside the component — endorsed by Winston.)

### Component placement, barrels, imports (FW-7, TS-7)

- `EmptyState` + `GhostedChartFrame` → `src/components/domain/` (tier-3, business-aware, cross-feature). Imported directly as `@/components/domain/EmptyState` — there is **no** `components/domain/index` barrel. `features/dashboard`/`features/people` have no feature barrel (fine — they import the domain component).
- Not in `components/ui/` (shadcn only). Consume `Button` from `@/components/ui/button`.

### Enforcement & conventions

- **R52 / Storybook three-state rule** is in `.storybook/test-runner.ts` + `src/test/storybook-rules/required-exports.ts` — it enforces `Default/Loading/Empty/Error` on **every** `.stories.tsx` under `components/domain/` or `features/*/components/` EXCEPT `ui/`, files with `// storybook-rule: no-three-state`, and the `AppShell/SidebarShell/TopbarShell` allowlist. It is **NOT suffix-globbed** — so `EmptyState.stories.tsx` and `GhostedChartFrame.stories.tsx` **DO** trip it and MUST carry the opt-out comment. It is NOT ESLint. Do NOT touch the negative fixture `src/test/fixtures/lint-bait/MissingEmptyTable.stories.tsx` (its test asserts it fails).
- **i18n ratchet:** `src/lib/test/i18n-parity.ts` (`assertI18nParity`, `assertI18nInterpolationParity`), aggregated in `src/lib/test/__tests__/i18n-parity-coverage.test.ts`. CI `npm run i18n-parity` (`scripts/i18n-parity.mjs`) — its `COVERED_NAMESPACES` does NOT include most empty-state namespaces, so the per-story array in the vitest ratchet is the real parity guard, and NOTHING mechanical catches a present-but-unrendered key (only render assertions do — AC7).
- **Typecheck gate = `tsc -b`** (checks test files), never `--noEmit`.
- **Locales:** `src/locales/en.json` + `src/locales/vi.json` — single flat-nested file per locale, dot-separated feature-scoped. Both in the same change.

### Stack guardrails (project-context.md)

React 19 (no `forwardRef`/`"use client"`) · strict TS (no `any`/`@ts-ignore`; **flat interface, no DU for `tone`**) · Tailwind utilities + `--cl-*` tokens, no raw hex, no inline `style` · component NEVER calls `t()` / reads role (UX-1/UX-3, call-site decorator) · no `new Date()` in render (TS-6) · `Button` from `ui/` (XL-1).

### What NOT to touch (regression guard)

Loading skeletons (`InboxSkeleton`/`ArchiveSkeleton`/`DashboardSkeleton`/local `*Skeletons`) + error alerts (`*ErrorAlert`) — Loading/Error legs, 10-4 owns errors · `InboxFilterEmpty` stays a distinct neutral line (10-1b D2c) · `error-state-placeholder.tsx` (10-4) · `InboxRow.tsx` 44px (10-4, D4) · class-detail `StudentsTab` ComingSoonPanel (Epic 7.3) · the AnalyticsHome role branch + `MIN_GRADED_FOR_PATTERNS` threshold + `useStudentWelcome` gating — preserve exactly · the `lint-bait` negative fixture. **No DOM snapshots** — keep assertions semantic.

### References

- Design brief: `1d-5-shells-and-states.md:60-90` (AC3). Epic: `epics/epic-10.md:109-170` (Story 10.3; binding close `:167` = "at least one actionable path").
- UX: `ux-design-specification.md` §6.4 (`:376-385`); verbatim mock `docs/classlite-entry/06b-empty-states.html` (s54@5787 … s62@6399; `.empty-state` CSS @4912-4963). s57/s61 use a warn-banner + ghosted frames (no headline-chip); s62 uses a `<h1>Welcome, …</h1>` hero (accent on the name).
- Forward-refs: `10-1b-...md:339` (EmptyState extraction → 10.3), placeholder header `empty-state-placeholder.tsx:4-18`.
- Project rules: `docs/project-context.md` — UX-1/UX-3, FW-7, TS-6/7, TEST-FE-4/5/6, TEST-UX-1/2; `docs/bmad-story-conventions.md` (≤600 lines; completion-notes split).

## Definition of Done

- [x] `EmptyState` (AC1) + `GhostedChartFrame` (AC2) in `components/domain/` with co-located stories (both carry `// storybook-rule: no-three-state`); axe-zero.
- [x] All 9 in-scope surfaces (s54–s62, minus s53) render their empty through `EmptyState`: 2 oracle + 3 rebuild re-platformed with no behavior/test regression (AC3), 4 upgraded (AC4). s53 split to Story 10-5.
- [x] 8 `EmptyStatePlaceholder` story imports swapped; placeholder deleted; `error-state-placeholder.tsx` untouched. **`storybook:test:ci`=GREEN** (79 suites / 451 tests). Resolving it required a Ducdo-approved convention amendment — a route-page story tier (`features/<area>/*.stories.tsx` added to `.storybook/main.ts` + `fw7-placement.ts`, `no-three-state` on 14 page/presentational stories) — which made 14 previously-catalog-invisible page stories first-class and surfaced + fixed 18 genuine latent defects in them (see completion-notes "Pre-existing gate fixes").
- [x] `STORY_10_3_KEYS` exhaustive (net-new only: `classes.empty.headlineAccent`, `questions.empty.teacher.explainer` ★, `questions.empty.teacher.openInbox`) + wired; every new key in both locales; interpolation parity; prose key ★ REVIEWER-MANDATORY VN (AC6).
- [x] Characterization discipline honored: baseline-green recorded (299 files/3899 tests); `StudentWelcome` content pinned pre-refactor; empty-path axe on analytics/my-perf; inbox-lens absence test; en/vi via real-i18n suite (AC7).
- [x] D2 honored (single-CTA; secondary paths unchanged, s55 no invented CTA); D4 honored (InboxRow untouched); `StudentsTab` untouched.
- [x] Gates ALL GREEN + deterministic: `tsc -b`=0 ✓ · `vitest` ✓ (302 files/3934 tests; validated 3 consecutive clean full runs after fixing the pre-existing `WritingAttemptShell` real-timer full-suite flake — raised `asyncUtilTimeout` + `waitFor` on focus, no component change) · `i18n-parity` green ✓ (fixed pre-existing `sidebar.*.profile` 9-4 orphan) · `ESLint`=0 errors ✓ (fixed pre-existing `billing` setState-in-effect error; 5 benign RHF `watch()` warnings remain) · `storybook:test:ci` green ✓ (79/451). `codegen.sh` NOT run. Pre-existing-gate fixes detailed in completion-notes.
- [x] Completion-notes sibling (`10-3-empty-states-completion-notes.md`) created per `bmad-story-conventions.md`.

## Out of Scope

- **s53 Teacher day-one guided activation** → **Story 10-5-teacher-day-one** (D3 split).
- **Error states** (s63–s67 + storage-100% upload error) + **the <44px InboxRow touch-target** → **Story 10.4** (D4). `error-state-placeholder.tsx` stays until then.
- **True multi-path "es-help →" CTA lists** → **FU-10-3-MULTIPATH-CTA**: s54 template/from-archive **+ the ghosted "populated preview" table**; s55 share-link/email/add-from-unassigned (depends on Epic 7.3 enrolment UI); s59 link-from-exercise (create-folder already ships as the `newFolder` topbar action).
- **Class-detail roster + enrolment/invite wiring** (`StudentsTab` ComingSoonPanel) → **Epic 7.3**.
- **`LoadingSkeleton` shape-primitive extraction** (1d-5 AC7) — not an empty state → **FU-10-3-SKELETON-PRIMITIVES** if ever needed.
- **Billing `PlanPickerPage` missing empty leg** (deferred-work.md:1211, near-unreachable) — own FU unless trivially swept.
- Visual-regression tooling (Chromatic/Percy) — not MVP.

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-10-07 | Story created (backlog → ready-for-dev). 4-agent recon. Canonical `EmptyState` (deferred from 1d-5 AC3) lands here; placeholder swap+delete. 4 Ducdo rulings (D1 refactor-all · D2 pragmatic single-CTA · D3 build s53 guided · D4 44px→10-4). | Amelia (/bmad-create-story 10-3) |
| 2026-10-08 | **IMPLEMENTED → review** (/bmad-dev-story 10-3, Amelia). Built canonical `EmptyState` + `GhostedChartFrame`; re-platformed all 9 surfaces (2 oracle + 4 upgrade + 3 rebuild); swapped 8 placeholder stories + deleted the fixture; `STORY_10_3_KEYS` ratchet (3 net-new keys). Gates: `tsc -b`=0, vitest 302/3925 (0-regression, +26), i18n-parity green. Surfaced 3 PRE-EXISTING broken full-project gates (not 10.3 regressions): i18n-parity `sidebar.*.profile` orphan from 9-4 (**fixed**); ESLint billing setState error + RHF warnings (left, 0 new); `storybook:test` setup-gate red on 14 unrelated auth/dashboard/onboarding page stories (0 of mine). Dev Agent Record + File List → `10-3-empty-states-completion-notes.md`. | Amelia (/bmad-dev-story 10-3) |
| 2026-10-07 | **Party-mode pre-dev review folded** (Sally/Winston/Murat/John subagents; Ducdo "apply all"). **D3 REVERSED → s53 SPLIT OUT to new Story 10-5** (activation feature, not an empty state — John/Sally). Contract fixes (Winston): flat interface not DU · trailing not mid accent · `icon`/`headline` optional · default no-live-role + `live`→`role="status"`. Flattening guard (Sally/Winston/Murat): `tone='guided'` suppresses chip/headline so s57/s61/s62 keep their warn-banner/page-head. AC2 `GhostedChartFrame` = net-new minimal, threshold banner stays at call site (Winston). Characterization-first regression net + Task reorder (oracle→partials→rebuild) + pin s62 content pre-refactor + empty-path axe (Murat). ★ REVIEWER-MANDATORY VN on prose keys (Murat). Storybook opt-out fix — rule is NOT suffix-globbed (Murat). FU-10-3-MULTIPATH-CTA scope corrected (John: create-folder/add-from-unassigned/link-from-exercise/ghosted-preview, not "URL"). s55 no invented CTA (enrolment=7.3). | Amelia (/bmad-party-mode) |

## Dev Agent Record

_Implementation record (Debug Log, Completion Notes, File List) → sibling [`10-3-empty-states-completion-notes.md`](./10-3-empty-states-completion-notes.md) per `docs/bmad-story-conventions.md`._

### Agent Model Used

claude-opus-4-8[1m] (Amelia / bmad-dev-story)

### Debug Log References

See sibling completion-notes → Dev Agent Record → Debug Log. Headlines: baseline-green recorded (299 files / 3899 tests on 41b9fd9); two PRE-EXISTING broken CI gates surfaced + flagged (i18n-parity `sidebar.*.profile` orphan from 9-4 — fixed; ESLint billing setState-in-effect error — left, 0 new); LSP generated-types flood = stale-cache (`tsc -b` clean).

### Completion Notes List

See sibling completion-notes. All 9 ACs implemented; 9 surfaces re-platformed onto canonical `EmptyState` (2 oracle + 3 rebuild + 4 upgrade); placeholder swapped (8 stories) + deleted; `STORY_10_3_KEYS` ratchet wired; characterization net (baseline + s62 pin + empty-path axe + lens-absence) in place.

### File List

See sibling completion-notes → File List (8 added, ~24 modified, 1 deleted).

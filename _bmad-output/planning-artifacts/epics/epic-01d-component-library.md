# Epic 1D: Component Library Buildout (Path B — Trim + Phase 4 Visual Bridge)

## Description

Build out the Storybook foundation, all shadcn primitives, the app-shell stack, and the **static visual shells** of Phase 4 behavior-heavy components (writing canvas, grading rail, anchored Q&A card, mobile writing surface, inbox row chrome, analytics scope chrome) — so the designer can iterate on the editorial-paper aesthetic AND the visual identity of the most distinctive screens during Epic 1D, while ALL behavior wiring (autosave, anchor persistence, audio playback, AI overlays, data fetching, role gating, recurrence editing, calendar-library decision, etc.) stays in the feature epics that own it.

### Path B re-scope context (2026-06-07)

This epic was originally scoped as 8 stories (1d-1 through 1d-8) covering full `ui/`+ `domain/` coverage with Phase 4 deferred entirely. **Party-mode review (Winston + Sally + Mary + Murat + Paige + Amelia, 2026-06-07) surfaced a convergent critique:** the original scope paid a launch slip to buy designer parallelization, but deferred the components that carry the most visual identity (writing canvas, grading rail, Q&A card, mobile writing surface) — handing the designer "the chrome of the cathedral and saving the stained glass for last" (Sally). Mary's strategic ledger argued for trimming to 1d-1/1d-2/1d-3 only. Sally counter-proposed a Phase 4 visual bridge for the most distinctive components. Path B is the synthesis: **trim + Phase 4 visual bridge as static shells only.**

Legacy story files `1d-5` (shells + states), `1d-6` (DataListTable family), `1d-7` (drawers/modals/forms), `1d-8` (tabs + calendar) — and the legacy `1d-4` (visual/status domain) — are retained as **input artifacts** for the feature epics that will absorb their scope. Their `Status` field reads `deferred-to-feature-epic` with the target epic + story enumerated at the top of each file. The current `1d-4` story is `1d-4-phase4-visual-bridge.md` (the Sally synthesis).

### Why this epic exists

The designer needs an iteration surface for the visual language while auth and onboarding API work continues. Pre-building primitives + shells + the Phase 4 visual identity in Storybook gives her a real playground for the editorial-paper aesthetic, the anchor taxonomy color (red `!` / green `★` / amber `✎`), the band-score Geist Mono typography rhythm, the role-scoped inbox row vocabulary, and the analytics scope chrome — without paying to build the behavior twice when feature epics actually wire it.

### Sequencing

Slots between Epic 1C (Frontend Foundation & Landing Page) and Epic 2 (Onboarding). Frontend critical path under Path B adds ~4–5 weeks (down from 4–9 weeks under the original scope); backend (Epic 2 API stories 2.1, 2.2) proceeds in parallel. Per Mary's "10–14 weeks realistic vs 4–9 weeks optimistic" finding, the Path B trim brings the realistic estimate in line with the original optimistic estimate. Pre-1d-1 gate: `/bmad-tea TD` re-run for Epic 1D (Murat — addresses stale `test-design-architecture.md` + R38 i18n parity score 6).

### Boundary contract with later epics

Every Epic 2–10 story that builds a `domain/` or `features/<area>/components/` component MUST extend or add its Storybook story alongside the implementation. Components ship with their Storybook coverage; this is amended into the project Definition of Done (see § "Definition of Done Amendment for Epic 2–10" below). Components deferred from old 1d-4 through 1d-8 ship with their owning feature epic per the expanded "Out of Scope" table.

## Screen References

All 93 screens contribute to the component vocabulary (see [`docs/classlite-entry/classlite-ia.md`](../../../docs/classlite-entry/classlite-ia.md)). Component-to-screen mapping lives in [component-inventory.md](../component-inventory.md). High-level groupings driving each story under Path B:

- **1d-1 (Storybook foundation):** N/A — tooling story.
- **1d-2 (Shadcn primitives):** N/A — primitives are screen-agnostic; consumed across all 93 screens.
- **1d-3 (App-shell stack):** `s06`, every desktop screen `s07–s73`, and the Chapter 8 mobile screens `s74–s86` (for `MobileTabBar`).
- **1d-4 (Phase 4 visual bridge):** `s34` (writing canvas), `s23` (writing grading), `s24` (speaking grading), `s18`/`s36` (anchored Q&A), `s78` (mobile writing), `s50`/`s51`/`s52` (per-role inbox), `s45`/`s48` (analytics home + dashboard).

## Functional Requirements

None new. This epic is internal tooling — no user-facing functional requirements. Component coverage supports existing FR-1 through FR-81 by providing the building blocks Epic 2–10 stories consume.

## UX Design Rules

- **UX-DR26:** Storybook as canonical component playground — every `ui/` and `domain/` component ships with at least one Story file in `*.stories.tsx` co-located with the component. Story files declare default render, role variants (where applicable), and the loading/empty/error trilogy from UX-1 for any data-rendering component.
- **UX-DR27:** Decorator stack (extended per Winston's preview-side dependencies finding) — every story renders inside a standard decorator chain: `QueryClientProvider` (with `retry: false`, `staleTime: 30_000`), `I18nextProvider` (en + vi switchable from Storybook toolbar), `MemoryRouter`, MSW handlers, role context (`useRole` mock toggleable from toolbar), Tailwind CSS load, design-token CSS import, font preload (Fraunces/Geist/Geist Mono), `Suspense` boundary, `date-fns/locale/vi` registration. One decorator module, applied as Storybook preview default.
- **UX-DR28:** Three-state coverage rule — for any component that renders data, four stories minimum: `Default`, `Loading`, `Empty`, `Error`. Skeleton loading shape mirrors final content; empty state uses icon + headline + action; error state uses i18n keys, never hardcoded English. Enforced by `@storybook/test-runner` rule (error-on-merge from 1d-1 day 1 per Murat — not "warning escalates later"). Pre-Epic-10 stories use `EmptyStatePlaceholder` / `ErrorStatePlaceholder` from 1d-1 until Epic 10 ships the real `EmptyState` / `ErrorState`.
- **UX-DR29:** Role-variant rendering convention — components with role-specific renders (sidebar, inbox row, analytics scope) expose role variants as Storybook stories named `OwnerView`, `AdminView`, `TeacherView`, `StudentView`. Storybook toolbar exposes role switcher backed by the role decorator. Per UX-3, components ship as separate role-variant stories, not internal role-branching.
- **UX-DR30:** `StatusPill` family consolidation — to be applied when `StatusPill` ships (deferred under Path B to Epic 8 with old 1d-4). Documented here for forward-compatibility; consumers in Epic 8 inherit the consolidation contract.
- **UX-DR31:** `EmptyState` and `ErrorState` shape variants — `EmptyState` consolidates to a single component with role-scoped i18n keys passed by consumer. `ErrorState` splits into three distinct shapes: `FormValidationError` (banner + inline), `LockedContentError` (read-only strip + unlock paths), `PermissionDeniedError` (full-page). Both ship in Epic 10 Story 10.3/10.4 under Path B (deferred with old 1d-5).
- **UX-DR32:** Mobile-vs-responsive decision per component — Chapter 8 (`s74–s87`) mobile screens are purpose-designed, not responsive squishes (per UX-4). `MobileTabBar` (1d-3) and `MobileWritingSurface` (new 1d-4) ship as purpose-designed components; the remainder defer to feature epics with mobile-first variant stories.

## Non-Functional Requirements Addressed

- **NFR-1 (i18n Foundation):** Every component story renders with both `en` and `vi` locales. **AC4 of Story 1d-1 ships `assertI18nParity()` + a CI step that errors on key-set divergence between `en.json` and `vi.json` — this is the R38 (score 6) mitigation** per Murat's party-mode finding. Without it, every 1d-N story would ship against an unmitigated score-6 risk.
- **NFR-3 (Performance Baseline):** Storybook build excluded from production bundle. CI `storybook` job soft-capped at 8 minutes per PR (Winston's CI-delta finding); shard-by-pattern plan documented for >100 stories.
- **NFR-5 (Accessibility Foundation):** Every component story runs `axe-core` audit via `vitest-axe` integration. CI fails on any `axe` violation. Establishes the per-component a11y baseline that Epic 2–10 stories inherit.

## Out of Scope (Deferred to Feature Epics — expanded under Path B)

The original epic deferred ~19 Phase 4 components. Path B additionally defers the full content of legacy stories 1d-4 (visual/status domain), 1d-5 (shells + states), 1d-6 (DataListTable family), 1d-7 (drawers/modals/forms), and 1d-8 (tabs + calendar) — those story files are retained as input artifacts for the consuming feature epics.

**Phase 4 behavior (unchanged from original):**

| Component | Defer target | Why behavior defers |
|---|---|---|
| `WriteDocSurface` behavior (debounced autosave, draft recovery) | Epic 5, Story 5-3 | Autosave + TanStack Query mutation coupling |
| `WritingGradingSurface` behavior (span anchor persistence + AI per-comment review) | Epic 6, Story 6-1 | Selection tracking + anchor persistence + AI overlay |
| `SpeakingGradingSurface` behavior (audio decode + playback) | Epic 6, Story 6-3 | Web Audio API + timestamp anchor persistence |
| `AutoGradeReviewSurface` | Epic 6, Story 6-4 | Auto-grade pipeline coupling |
| `AnchoredQASidebar` behavior (thread persistence + batch handling) | Epic 7, Story 7-4 | Anchor + thread coupling |
| `ExerciseAttemptShell` (MCQ / writing canvas / speaking recorder variants) | Epic 5, Stories 5-2/5-3/5-4 | Three behaviorally distinct attempt APIs |
| `MobileWritingSurface` behavior | Epic 5, Story 5-3 mobile variant | Mobile autosave + IME handling |

**Phase 4 visual shells now IN SCOPE under Path B (Story 1d-4 — the Sally synthesis):**

| Component | Owning AC | Visual scope vs. deferred behavior |
|---|---|---|
| `WriteDocSurface` static shell (Docs canvas, Fraunces, autosave indicator chrome) | 1d-4 AC1 | Visual only; autosave behavior → Epic 5 Story 5-3 |
| `WritingGradingSurface` static shell (rail + pin taxonomy + comment cards) | 1d-4 AC2 | Visual only; anchor persistence + AI → Epic 6 Story 6-1 |
| `SpeakingGradingSurface` static shell (waveform + pin chrome) | 1d-4 AC3 | Visual only; audio playback → Epic 6 Story 6-3 |
| `AnchoredQuestionCard` static shell (teacher + student variants) | 1d-4 AC4 | Visual only; thread persistence → Epic 7 Story 7-4 |
| `MobileWritingSurface` static shell (390x844 purpose-designed) | 1d-4 AC5 | Visual only; behavior → Epic 5 Story 5-3 mobile variant |
| `InboxListShell` + `InboxRow` static shells (per-role row chrome) | 1d-4 AC6 | Visual only; polling + action wiring → Epic 10 Story 10-1 |
| `AnalyticsHomeShell` + `ScopeBar` static shells | 1d-4 AC7 | Visual only; data fetching + RBAC → Epic 8 Story 8-2 |

**Legacy 1d-4 through 1d-8 scope now DEFERRED to feature epics:**

| Legacy story content | Defer target |
|---|---|
| `StatusPill` family, `MetricBox`, `SkillTag`, `WeekStrip`, `ActionRail`, `ActionCard`, `BandScoreChart`, role-variant `DashboardHero` (legacy 1d-4) | Epic 8 Stories 8-1/8-2/8-3 (dashboards + analytics own them) |
| `PlanUsageMeter`, `BillingGraceBanner` (legacy 1d-4) | Epic 9 Stories 9-1/9-3 (billing owns them) |
| `OnboardingShell`, `PersonaPickCard`, `StepProgressDots`, `SetupCard`, `DoneHeroPanel`, `TaskChecklistItem`, `ImportBanner` (legacy 1d-5) | Epic 2 Stories 2-3a/b/c/2-4 (onboarding owns them) |
| `EmptyState`, three `ErrorState` shapes, shape-semantic `LoadingSkeleton` patterns (legacy 1d-5) | Epic 10 Stories 10-3/10-4 (Epic 1D uses `EmptyStatePlaceholder` / `ErrorStatePlaceholder` from 1d-1 until then) |
| `AIInsightShell` (legacy 1d-5) | Epic 4 Story 4-3 OR Epic 6 Story 6-2 (AI-consuming epic owns the shell) |
| `DataListTable` + `FilterChipBar` + `Pagination` + 5 recurring usage shells + `GradingQueueShell` (legacy 1d-6) | Epic 3 Story 3-1 (class index — first consumer) + DoD propagation; `GradingQueueShell` → Epic 6 Story 6-1 |
| Drawer/Sheet chrome + 3 Modal patterns + RHF + Zod wrappers + `BrandColorPicker`/`AssignChip`/`TaskChecklistItem` (legacy 1d-7) | Epic 2 Story 2-3 (onboarding sheet) and Epic 2 Story 2-3a (canonical RHF wrapper); inline editors → Epic 2 Stories 2-1/2-2/2-4 |
| `ClassDetailTabsShell` + `SessionScheduleCalendar` (with widened 2-day spike + RRULE fit) + `ScheduleEditModal` + `RecurrenceScopeConfirm` (legacy 1d-8) | Epic 3 Story 3-2 (tabs) + Epic 3 Story 3-4 (schedule + library spike) + Epic 3 Story 3-5 (recurrence) |

**Total content deferred under Path B: ~70 components across Epics 2, 3, 4, 6, 7, 8, 9, 10.** Inventory `component-inventory.md` is updated with Path B deferral tags.

## Definition of Done Amendment for Epic 2–10

The project Definition of Done is amended for all stories in Epics 2–10:

> Any story that builds a `domain/` or `features/<area>/components/` component MUST extend or create its Storybook story file (`*.stories.tsx`) alongside the implementation. The story must include: default render, three-state coverage if data-rendering (per UX-DR28 — using `EmptyStatePlaceholder` / `ErrorStatePlaceholder` from 1d-1 until Epic 10 ships the real components), role variants if role-rendered (per UX-DR29 — three separate stories, not internal role-branching), and the `axe-core` audit baseline (per NFR-5). The legacy 1D story files (`1d-4-visual-status-domain.md`, `1d-5-shells-and-states.md`, `1d-6-data-list-table.md`, `1d-7-drawers-modals-forms.md`, `1d-8-tabs-shell-and-calendar.md`) are AC reference inputs for the consuming feature epics — their AC structure (typed columns, three-state coverage, role variants) carries over verbatim.

This amendment is folded into `_bmad-output/test-artifacts/test-design/test-design-qa.md` coverage matrix at the next test design refresh (the pre-1d-1 `/bmad-tea TD` gate per Murat).

## Stories (Path B — 4 stories)

---

### Story 1d-1: Storybook Foundation, Decorators & Vite Compat Spike

**Size:** M | **Audience:** Frontend | **Dependencies:** Story 1.7a (design tokens), Story 1.7b (QueryClient, Router, Zustand stores), Story 1.7c (i18n setup) | **Pre-Dev Gate:** `/bmad-tea TD` re-run for Epic 1D (Murat — addresses stale test-design + R38 mitigation map)
**UX-DRs:** UX-DR26, UX-DR27, UX-DR28

As a frontend developer,
I want Storybook installed against the Vite 8 / Rolldown build with a three-tier compatibility ladder (Rolldown → Vite/esbuild builder for Storybook only → defer entirely), a complete decorator stack (i18n, role, Query, Router, MSW, Tailwind, tokens, fonts, Suspense, `date-fns/locale/vi`), an enforced three-state authoring convention via `@storybook/test-runner` (error-on-merge from day 1), and an i18n-parity CI step that mitigates R38,
so that every component developed in Stories 1d-2 through 1d-4 — and every Epic 2–10 frontend story thereafter — ships with a consistent, designer-iteratable Storybook story file from day one without an unmitigated i18n parity risk lurking under the foundation.

**Key ACs:** Three-tier compatibility ladder (AC1, Winston's fix); decorator stack with preview-side deps (AC2, Winston); three-state lint as error-on-merge with negative fixture (AC3, Murat); `assertI18nParity()` helper + CI step (AC4 — R38 mitigation, Murat); axe-core via `@storybook/test-runner` (AC5); CI `storybook` job with 8-minute soft cap (AC6); FW-7 placement enforcement (AC7); conventions doc (AC8); smoke story validates all gates (AC9).

Full ACs: [1d-1-storybook-foundation.md](../../implementation-artifacts/1d-1-storybook-foundation.md).

---

### Story 1d-2: Shadcn Primitive Coverage & Token Theming

**Size:** L | **Audience:** Frontend | **Dependencies:** Story 1d-1, Story 1.7a (design tokens)
**UX-DRs:** UX-DR26, UX-DR28

As a frontend developer,
I want every shadcn primitive identified in the Phase 1 inventory (34 components — the original 32 plus `Toggle` and `ToggleGroup` per Amelia's coupling-gap fix) installed via `npx shadcn add`, themed with ClassLite design tokens, and wrapped with a Storybook story file covering its full variant API surface,
so that every downstream `domain/` and `features/<area>/components/` component built in Stories 1d-3 and 1d-4 (and Epics 2–10) composes against a finished, axe-clean, locale-correct primitive foundation rather than re-theming shadcn defaults inline.

**Key ACs:** Form + selection primitives (AC1, 12 primitives including `Toggle`/`ToggleGroup`); overlay primitives with focus-trap `play` functions (AC2); menu + command with keyboard nav (AC3); feedback + indicators including `Skeleton` pure shape variants (AC4 — shape-semantic skeletons defer to Epic 10 per Winston's FW-7 split); layout + structure (AC5); data primitives (AC6); design-token theming pass with two patterns (AC7); i18n + axe + CI green (AC8).

Full ACs: [1d-2-shadcn-primitive-coverage.md](../../implementation-artifacts/1d-2-shadcn-primitive-coverage.md).

---

### Story 1d-3: App-Shell Stack — Sidebar, Topbar, Navigation

**Size:** L | **Audience:** Frontend | **Dependencies:** Story 1d-2
**UX-DRs:** UX-DR26, UX-DR27, UX-DR29, UX-DR32

As a frontend developer,
I want the persistent app-shell components (`AppShell`, `SidebarShell` with explicit owner/admin/teacher/student role variants per `classlite-ia.md`, `SidebarNavItem`, `TopbarShell`, `BreadcrumbBar`, `SearchPill`, `UserPill`, `PageHead`, `MobileTabBar` purpose-designed per `s74–s86`),
so that every Epic 2–10 frontend story renders inside a finished shell rather than re-implementing layout chrome — and the designer can iterate on the role-variant sidebar vocabulary and the mobile tab bar taxonomy in Storybook.

**Key ACs:** Shell components with full TypeScript Props interfaces (AC1, Amelia's fix); SidebarShell Owner / Admin / Teacher / Student role variants matching `classlite-ia.md` exactly (AC2–AC5); SidebarNavItem badge + active state (AC6); MobileTabBar purpose-designed bottom tab bar with three role variants per `s74–s86` (AC7); mobile-breakpoint composition (AC8); i18n + axe-core + stable test selectors (AC9).

Full ACs: [1d-3-app-shell-stack.md](../../implementation-artifacts/1d-3-app-shell-stack.md).

---

### Story 1d-4: Phase 4 Visual Bridge — Static Shells

**Size:** L | **Audience:** Frontend | **Dependencies:** Story 1d-1, Story 1d-2, Story 1d-3
**UX-DRs:** UX-DR26, UX-DR28, UX-DR29, UX-DR32, UX-DR22

As a frontend developer (and as the designer's collaborator),
I want the visual identity shells of the Phase 4 behavior-heavy components (`WriteDocSurface`, `WritingGradingSurface`, `SpeakingGradingSurface`, `AnchoredQuestionCard`, `MobileWritingSurface`, `InboxListShell` + `InboxRow`, `AnalyticsHomeShell` + `ScopeBar`) built as static, fixture-driven Storybook stories with NO behavior wiring,
so that the designer can iterate on the editorial-paper aesthetic, the comment-anchor taxonomy color, the band-score typography rhythm, the role-scoped inbox row vocabulary, and the analytics scope chrome during Epic 1D rather than waiting until Epics 5/6/7/8 land — while behavior implementation stays in those feature epics where it belongs.

**Key ACs:** `WriteDocSurface` Docs-style canvas chrome `s34` (AC1); `WritingGradingSurface` span-anchored rail + pin taxonomy `s23` (AC2); `SpeakingGradingSurface` waveform + timestamp pin chrome `s24` (AC3); `AnchoredQuestionCard` teacher + student variants `s18`/`s36` (AC4); `MobileWritingSurface` purpose-designed mobile canvas `s78` (AC5); `InboxListShell` + `InboxRow` per-role chrome `s50`/`s51`/`s52` (AC6); `AnalyticsHomeShell` + `ScopeBar` role-scoped analytics chrome `s45`/`s48` (AC7); i18n + axe + FW-7 placement + stable selectors across all 8 components (AC8).

**Static-shells discipline (the load-bearing constraint):** NO autosave, NO anchor persistence, NO audio playback, NO real fetch, NO AI overlays. Every callback prop defaults to a no-op. JSDoc on every component names the feature epic + story that wires the behavior.

Full ACs: [1d-4-phase4-visual-bridge.md](../../implementation-artifacts/1d-4-phase4-visual-bridge.md).

---

## Parallelization plan

- **1d-1 → 1d-2 must run sequentially.** Foundation gates everything; primitives are the foundation for the shells and Phase 4 visual identity.
- **After 1d-2: 1d-3 and 1d-4 run in parallel.** 1d-3 owns app-shell chrome; 1d-4 owns Phase 4 visual identity. No cross-dependency between them (1d-4's shells don't compose 1d-3's `AppShell` — they're full-bleed surfaces).
- **Single frontend dev sequential:** ~4–5 weeks.
- **Two frontend devs:** ~3 weeks (1d-1 → 1d-2 sequential, 1d-3 + 1d-4 in parallel).

Backend (Epic 2 API stories 2.1, 2.2) and any Epic 1B/1C remaining work proceed in parallel — they don't depend on Epic 1D.

## Pre-Dev Gate (per Murat)

`/bmad-tea TD` must be re-run for Epic 1D **before Story 1d-1 transitions `backlog → ready-for-dev`**. The refresh delivers:
1. Confirmation of R38 (i18n parity, score 6) mitigation map — Story 1d-1 AC4 owns it.
2. P0–P3 coverage matrix for ~50 in-scope components under Path B (vs. the original ~70).
3. ATDD red-test scope per story (1d-1 AC4 has one ATDD red test; 1d-2/1d-3/1d-4 inherit the parity gate without new ATDD).
4. Documentation that 1d-1 Tier C kill-switch (defer Storybook entirely) carries a downstream a11y-gate consequence — every "zero violations" claim in 1d-2/1d-3/1d-4 evaporates if Tier C is invoked.

Without this gate, no 1d-N story advances. WF-8 hard rule: stories tied to ≥6 risk must have ATDD red tests on the branch BEFORE transitioning to `in-progress`.

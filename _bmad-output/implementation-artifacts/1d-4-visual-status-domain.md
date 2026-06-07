---
baseline_commit: a90010732057148b3c4e930c7c7b234aa4686378
---

# Story 1d-4 (legacy): Visual & Status Domain Components

Status: deferred-to-feature-epic

> **PATH B RE-SCOPE (2026-06-07):** After party-mode review, Epic 1D was re-scoped to the "trim + Phase 4 visual bridge" path (Mary + Sally synthesis). This story is deferred — its components ship with the feature epics that consume them:
> - `StatusPill` family, `MetricBox`, `SkillTag`, `WeekStrip`, `ActionRail`, `ActionCard` → **Epic 8** (Analytics, Dashboards & Search) Stories 8.1/8.2/8.3
> - `BandScoreChart` → **Epic 8** Story 8.3 (student performance)
> - `DashboardHero` role variants → **Epic 8** Story 8.1 (role-specific dashboards)
> - `PlanUsageMeter`, `BillingGraceBanner` → **Epic 9** (Billing) Stories 9.1/9.3
>
> Note: Story number `1d-4` was reassigned to a new "Phase 4 visual bridge" story. This file is kept as an input artifact for the listed feature epics — its ACs are reusable scope for consuming stories. The current Epic 1D story `1d-4` is `1d-4-phase4-visual-bridge.md`.

<!-- Validation is optional. Run `validate-create-story` for a quality second pass before `dev-story`. -->

## Story

As a frontend developer,
I want the visual identity and status-rich domain components (`StatusPill` family, `BandScoreChart`, `MetricBox`, `SkillTag`, `WeekStrip`, `ActionRail` + `ActionCard`, `DashboardHero`, `PlanUsageMeter`, `BillingGraceBanner`) built, themed against the design tokens from Story 1.7a, and Storybook-cataloged,
so that the designer can iterate on the visual feedback language (UX-DR22) and every analytics, dashboard, and billing surface across Epic 2–10 has consistent visual primitives ready to consume.

## Acceptance Criteria (BDD)

> **No risk-score ≥6 ACs in this story.** This is internal frontend tooling — no security surface, no tenant isolation, no auth flow. WF-8 ATDD red-tests are NOT mandatory. Component-level Vitest + axe assertions described below are written by the dev inline using the patterns from `test-design-qa.md`. Role gating for `PlanUsageMeter` / `BillingGraceBanner` lives at the route (per FW-7) — these components are pure UI.

### AC1: `StatusPill` composable consolidation (UX-DR30)

**Given** the inventory's six status pill specializations (`PerfPill`, `BandPill`, `SubmissionPill`, `InvoiceStatusPill`, attendance pill, session pill — first seen in `s07`/`s08`/`s09`/`s10`/`s11`/`s12`/`s35`/`s39`/`s42`/`s50`/`s70`),
**When** inspecting `src/components/domain/StatusPill.tsx`,
**Then** one composable component replaces all six with the following API surface:
```ts
type StatusPillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent'
type StatusPillVariant = 'solid' | 'soft' | 'outline'
type StatusPillProps = {
  tone: StatusPillTone
  variant?: StatusPillVariant // default: 'soft'
  icon?: ReactNode             // leading icon slot
  children: ReactNode          // i18n-resolved label — never hardcoded English
}
```

**And** the full `tone` × `variant` matrix renders correctly against design tokens — `success` resolves to `--cl-accent-green`, `warning` to `--cl-amber` (text-safe variant per UX-DR2), `danger` to `--cl-crimson`, `info` to `--cl-blue`, `neutral` to `--cl-muted`, `accent` to `--cl-accent`. No raw hex anywhere.

**And** semantic re-export stories (no new components, just preset `<StatusPill>` usages) ship under `StatusPill.stories.tsx` named:
- `PerformancePill` — Good (success/soft), Normal (neutral/soft), At-risk (warning/soft), Paused (neutral/outline), Active (success/soft), Upcoming (info/soft), Ended (neutral/outline)
- `BandPill` — `Band 6.5` rendering with Geist Mono numeric value, tone `accent`, variant `soft`
- `SubmissionPill` — `3 pending` (warning), `All in` (success), `Graded` (success/solid), `1 missed` (danger), `Next` (info), `Upcoming` (info), `Completed` (success/solid)
- `InvoiceStatusPill` — Paid (success), Declined (danger), Refunded (neutral), Upcoming (info)
- `AttendancePill` — Present (success), Absent (danger), Late (warning)
- `SessionPill` — Today (accent), Next (info), Cancelled (neutral/outline + strikethrough class), Amber-alert (warning)

**And** consumers wishing for ergonomic short-hands compose at the call site (`<StatusPill tone="success">{t('attendance.present')}</StatusPill>`) — no `PerfPill` / `BandPill` / etc. exported as components.

**And** axe-core reports zero violations across the full matrix, and contrast ratios meet UX-DR2 token fixes (5.1:1 minimum on muted; text-safe amber confirmed).

### AC2: `BandScoreChart` feedback language compliance (UX-DR22)

**Given** the `BandScoreChart` component (formerly `BandScoreGrid` in inventory — renamed per project convention; first seen `s23`, reused in `s24`/`s35`),
**When** rendered with a series of per-criterion band scores (Task response / Coherence / Lexical / Grammar for writing OR Fluency / Lexical / Grammar / Pronunciation for speaking),
**Then** the four-criterion grid renders Geist Mono numeric values at 28px (primary band cell) and 14px per-criterion sub-labels per UX-DR22,
**And** the overall band aggregate cell uses tone `accent` (`--cl-accent`) — never tone `danger` even when the band score declines,
**And** an optional trend indicator next to a criterion uses the regression-framing rule (UX-DR22): improvement renders `--cl-accent`, stable renders `--cl-muted`, regression renders `--cl-ink-soft` (NEVER `--cl-crimson` / `--cl-danger`),
**And** the "N pinned" annotation slot ties each cell to its pinned-comment count via `aria-label="{count} pinned comments"`.

**And** the three required state stories ship:
- `Default` — populated four-criterion grid with overall aggregate
- `Loading` — shape-mirroring skeleton (four numeric cell skeletons + one overall cell skeleton, NOT a centered spinner — per UX-DR24)
- `Empty` — "Awaiting first submission" with subdued aggregate cell using `--cl-muted`; no negative framing

**And** any date or score-time-axis label resolves via the i18n date formatter — `t('date', { val: isoString })` — never `new Date().toLocaleDateString()` (TS-6).

### AC3: `MetricBox`, `SkillTag`, `WeekStrip` visual primitives

**Given** the `MetricBox` component (replacing inventory's `StatBox` / `DashStat` consolidation; first seen `s08`, reused `s10`/`s12`/`s46`/`s47`),
**When** rendered,
**Then** typography matches UX-DR22 — Geist Mono at 28px for the primary metric value, Geist Sans 14px for the label, optional delta indicator (▲/▼/neutral) where the delta direction follows UX-DR22 regression framing (improvement `--cl-accent`, stable `--cl-muted`, regression `--cl-ink-soft`, never red).

**And** the `MetricBox` exports stories `Default`, `WithDelta`, `Loading` (numeric cell skeleton), and `Empty` (em-dash placeholder `—` for no-data per UX-1 — never blank).

**Given** the `SkillTag` component (first seen `s07`, reused `s09`/`s15`/`s26`/`s37`/`s46`),
**When** rendered with a `skill` prop,
**Then** the prop type is `'reading' | 'listening' | 'writing' | 'speaking' | 'vocab' | 'grammar' | 'general'`, each mapping to a stable color token defined in `src/lib/skill-tokens.ts` — no inline hex, no Tailwind `bg-red-500`-style classes,
**And** the displayed label resolves via i18n (`t('skill.reading')`) — never hardcoded English.

**Given** the `WeekStrip` component (`s06`, also reused in `s82` mobile per inventory),
**When** rendered with a week of session data,
**Then** seven day-cells render Mon–Sun (locale-aware via i18n formatter — never `new Date()` in the render path per TS-6), each cell may host a `SessionPill` (consuming AC1's `StatusPill` with `SessionPill` semantic shape) tagged by status — `today`, `next`, `cancelled`, `amber-alert`,
**And** clicking a pill emits `onSessionClick(sessionId: string)` — the component owns no fetching, consumers wire TanStack Query (per FW-1),
**And** the component is read-only — explicitly distinct from `SessionScheduleCalendar` (Story 1d-8), documented in component header JSDoc.

**And** the three required state stories ship for `WeekStrip`: `Default`, `Loading` (seven day-cell skeletons), `Empty` ("No sessions this week" via `EmptyState` consumed from 1d-5).

### AC4: `ActionRail` + `ActionCard` dashboard composition

**Given** the `ActionRail` and `ActionCard` components (first seen `s06`, reused `s09`/`s46`/`s48`),
**When** rendered on a dashboard,
**Then** `ActionRail` is a vertical-stack layout primitive — no fetching, no role logic — taking `children` of one or more `ActionCard`,
**And** `ActionCard` has three named slots: `head` (title + count badge + foot link), `body` (rows), `foot` (optional CTA strip),
**And** each row is an `ActionRow` sub-component with three sub-slots: avatar/icon, main (title + sub), meta (tag or status pill).

**And** the empty state per UX-1 composes `EmptyState` from 1d-5 with `icon` + `headline` + one `action` — never a blank card, never "No data found.",
**And** the loading state renders three placeholder skeleton rows mirroring `ActionRow` shape (UX-DR24).

**And** stories ship: `Default` (populated grading queue card), `Empty` (composes `EmptyState`), `Loading` (skeleton rows), `Multiple` (ActionRail with three ActionCards demonstrating composition).

### AC5: `DashboardHero` role variants (UX-DR29)

**Given** the `DashboardHero` component (first seen `s06`, reused `s29` student / `s48` owner),
**When** the component is built per UX-3 (role-based rendering uses separate components, NOT internal `if (role === ...)` branches),
**Then** three role-specific components ship in `src/components/domain/`:
- `TeacherDashboardHero` — triage framing per `s06`: greeting + today's session count + grading backlog count + at-risk student count
- `StudentDashboardHero` — due-now framing per `s29`: greeting + due-now card (composing `DueNowCard` from inventory) + recent activity peek + band trajectory peek
- `OwnerDashboardHero` — center-pulse framing per `s48`: greeting + teachers/students/revenue/inbox KPI tiles

**And** `AdminDashboardHero` is NOT a separate component — admins reuse `OwnerDashboardHero` per the IA convention documented in `classlite-ia.md`. A Storybook story `AdminView` re-exports `OwnerDashboardHero` with role context set to `admin` to make the reuse discoverable.

**And** every greeting copy ("Good morning, X") resolves via role-scoped i18n keys per UX-2 — `t('dashboard.teacher.greeting', { name })`, `t('dashboard.student.greeting', { name })`, etc. — never hardcoded English, never concatenated strings.

**And** stories ship `Default`, `Loading` (skeleton hero card mirroring final shape), `Empty` (day-one variant for teacher and student per `s53`/`s62` — composes `EmptyDashboardSteps` from inventory) for each role variant, plus the `AdminView` re-export.

**And** every story renders both `en` and `vi` correctly via the Storybook locale toolbar — Vietnamese greeting length verified to not overflow.

### AC6: `PlanUsageMeter` and `BillingGraceBanner` (Owner-only consumers, pure UI)

**Given** the `PlanUsageMeter` component (first seen `s69`, reused `s72`),
**When** inspecting its API,
**Then** props are `{ label: string; value: number; max: number; tone?: 'default' | 'warn' | 'critical' }` — no role prop, no role-resolution inside,
**And** the rendered output shows `{label}` over `{value} of {max} · {percent}%` (Geist Mono numerics) over a progress bar (consumes `Progress` primitive from 1d-2),
**And** the `tone` prop is computed by the consumer (e.g., `value/max > 0.9 ? 'critical' : value/max > 0.75 ? 'warn' : 'default'`) — the component does NOT compute thresholds, so different surfaces can adopt different warning policies,
**And** all visible strings (label, "of", "used", warning sub-text) resolve via i18n keys — never hardcoded English.

**Given** the `BillingGraceBanner` component (first seen `s73`, reused on every page when active),
**When** rendered,
**Then** the banner renders a red top strip with messaging (`title`, `description`, `action` slots) and an `onDismiss` callback — but the dismiss/show state is owned by the consumer (Zustand UI store or route prop, NOT inside the component, per FW-5),
**And** the banner accepts an `aria-live="polite"` region so screen readers announce the grace-period appearance on route entry (per TEST-UX-2),
**And** the danger color uses `--cl-crimson` (token-driven, not raw hex), and contrast against the white-paper background meets WCAG AA per UX-DR2.

**And** both components are documented in their JSDoc as **Owner-only by product design** — role gating lives at the route per FW-7 (consumers wrap routes in `<RoleGate role="owner">`). The component itself does NOT check role,
**And** Storybook stories tag each with role context `owner` via the role toolbar default, and include a note "Component is pure UI; route-level role gate required" in the story description.

### AC7: Three-state coverage rule discharged for every data-rendering component

**Given** the UX-DR28 three-state rule from Story 1d-1,
**When** any data-rendering component in this story's scope has its story file authored,
**Then** the file exports at minimum `Default`, `Loading`, `Empty` (and `Error` where applicable):
- `BandScoreChart` — Default / Loading / Empty (data only — no Error variant; AC2 covers)
- `MetricBox` — Default / WithDelta / Loading / Empty
- `WeekStrip` — Default / Loading / Empty
- `ActionRail` + `ActionCard` — Default / Empty / Loading / Multiple
- `DashboardHero` (×3 role variants) — Default / Loading / Empty each
- `PlanUsageMeter` — Default / Warn / Critical / Loading

**And** loading skeletons are shape-mirroring per UX-DR24 — list-shaped components get list-shaped skeletons; chart-shaped components get chart-shaped rectangles; metric boxes get numeric-cell skeletons. NEVER a centered spinner.

**And** the pulse animation respects `prefers-reduced-motion` per UX-DR24 — when the media query matches, the skeleton renders as a static placeholder fill with `--cl-line-soft`.

### AC8: i18n + axe-core baseline across all stories

**Given** the Storybook foundation from Story 1d-1 is operational,
**When** every story in this story's scope renders,
**Then** the locale toolbar switches between `en` and `vi` cleanly — no text overflow, no truncation in numeric cells, no broken layouts when Vietnamese strings exceed English length (e.g., Vietnamese skill names tested explicitly for `SkillTag`),
**And** every story declares its required i18n keys (in a comment block at the top of the file) and a Vitest assertion confirms `i18n.exists(key)` returns true in both `en.json` and `vi.json` (per TEST-FE-4),
**And** axe-core via `vitest-axe` reports zero violations across all stories (per TEST-FE-5),
**And** color contrast meets UX-DR2 token fixes — muted 5.1:1 minimum, text-safe amber confirmed, accent vs paper background AA-passing.

## Tasks / Subtasks

- [ ] **Task 1 (AC1):** Build `StatusPill` composable in `src/components/domain/StatusPill.tsx`.
  - [ ] Define `StatusPillTone` and `StatusPillVariant` types in a co-located `StatusPill.types.ts`.
  - [ ] Implement the `tone` × `variant` matrix via Tailwind class composition mapped from design tokens — no inline hex.
  - [ ] Author `StatusPill.stories.tsx` with six semantic preset stories (`PerformancePill`, `BandPill`, `SubmissionPill`, `InvoiceStatusPill`, `AttendancePill`, `SessionPill`) demonstrating prop composition.
  - [ ] Write Vitest tests for the tone/variant matrix and add an axe assertion per story.
  - [ ] Migration note in JSDoc: "Replaces PerfPill / BandPill / SubmissionPill / InvoiceStatusPill / attendance pill / session pill per UX-DR30."
- [ ] **Task 2 (AC2):** Build `BandScoreChart` in `src/components/domain/BandScoreChart.tsx`.
  - [ ] Implement four-criterion grid + overall aggregate cell with Geist Mono 28px primary.
  - [ ] Add `trend` slot per criterion with regression-framing color logic (UX-DR22).
  - [ ] Author `BandScoreChart.stories.tsx` with `Default`, `Loading` (shape-mirroring), `Empty` (subdued aggregate).
  - [ ] Vitest: assert no `--cl-crimson` class applied for regression case (UX-DR22 check).
  - [ ] Confirm any date label uses `t('date', { val })` — add a lint regex check in Storybook test-runner for `new Date(` calls in this file.
- [ ] **Task 3 (AC3):** Build `MetricBox`, `SkillTag`, `WeekStrip`.
  - [ ] `MetricBox` — Default / WithDelta / Loading / Empty stories.
  - [ ] `SkillTag` — extract skill-token map to `src/lib/skill-tokens.ts`; story exercises all seven skills.
  - [ ] `WeekStrip` — read-only seven-day cell strip; story exercises `onSessionClick` callback.
  - [ ] Header JSDoc on `WeekStrip`: "Read-only. Distinct from SessionScheduleCalendar (Story 1d-8)."
- [ ] **Task 4 (AC4):** Build `ActionRail` + `ActionCard` + `ActionRow`.
  - [ ] Three-slot composition (head / body / foot) on `ActionCard`.
  - [ ] Three-slot composition (avatar / main / meta) on `ActionRow`.
  - [ ] Stories: `Default`, `Empty` (composes 1d-5 `EmptyState`), `Loading`, `Multiple` (rail with three cards).
  - [ ] Note in story description: "Pure layout; consumers own fetching via TanStack Query per FW-1."
- [ ] **Task 5 (AC5):** Build three role-specific `DashboardHero` components (per UX-3 separate-component rule).
  - [ ] `TeacherDashboardHero.tsx` + stories Default / Loading / Empty (day-one variant).
  - [ ] `StudentDashboardHero.tsx` + stories Default / Loading / Empty (first-login variant).
  - [ ] `OwnerDashboardHero.tsx` + stories Default / Loading / Empty.
  - [ ] Storybook `AdminView` re-export of `OwnerDashboardHero` with role context `admin` — comment documents the IA reuse.
  - [ ] All greeting copy via role-scoped i18n keys per UX-2; verify Vietnamese rendering in stories.
- [ ] **Task 6 (AC6):** Build `PlanUsageMeter` + `BillingGraceBanner`.
  - [ ] `PlanUsageMeter` — consumer-computed `tone`; component is dumb (no threshold logic).
  - [ ] `BillingGraceBanner` — `aria-live="polite"` region; dismiss state owned by consumer.
  - [ ] JSDoc on both: "Owner-only by product design — route-level RoleGate required per FW-7. Component is pure UI."
  - [ ] Stories tagged role `owner` via Storybook toolbar default + description note.
- [ ] **Task 7 (AC7):** Verify three-state coverage rule discharged for every data-rendering component in scope.
  - [ ] Skeleton shapes mirror final content per UX-DR24.
  - [ ] Pulse animation respects `prefers-reduced-motion` (test via Vitest `matchMedia` mock).
- [ ] **Task 8 (AC8):** i18n + axe baseline.
  - [ ] Every story renders cleanly in `en` and `vi`.
  - [ ] Vietnamese skill names tested in `SkillTag` for overflow.
  - [ ] Vitest assertion: required i18n keys exist in both locales (per TEST-FE-4).
  - [ ] axe-core: zero violations across all stories in this story's scope.

## Dev Notes

- **Stack reminders:**
  - React 19 — no `forwardRef`, refs are plain props, no `"use client"`.
  - Vite 8 (Rolldown) — story files run under the Storybook builder configured in 1d-1.
  - TypeScript strict — no `any`, no `// @ts-ignore`. All component props typed.
  - Tailwind utility classes only; design tokens via CSS variables (`--cl-ink`, `--cl-paper`, `--cl-accent`, `--cl-crimson`, `--cl-amber`, `--cl-muted`, `--cl-line-soft`). No inline `style={{}}`. No raw hex.
  - Typography: Geist body / Geist Mono numeric — Geist Mono is mandatory for any numeric value rendered in `MetricBox`, `BandScoreChart`, `PlanUsageMeter`, `BandPill`.
  - shadcn primitives (`Badge`, `Progress`, `Avatar`) consumed from `src/components/ui/` — never hand-edited (XL-1 + FW-7). If a primitive needs behavioral extension, wrap in `domain/`.

- **One mock seam per side:** None of these components fetch data. Stories that exercise data-shaped variants pass props directly. If a downstream feature epic needs to demonstrate live data flow, it uses MSW at the HTTP boundary (per TEST-FE-1) — never mock `useQuery` in stories.

- **i18n is co-primary** (UX-2 + NFR-1): every visible string uses `t()`. Test in `vi` — Vietnamese skill names, greetings, and meter labels can exceed English length. `SkillTag` and `MetricBox` are the highest-risk surfaces for overflow.

- **UX-DR22 (Feedback Design Language) is the highest-leverage rule in this story:**
  - Band scores never render in red — even on decline.
  - Use `--cl-muted` for stable trends, `--cl-accent` for improvement, `--cl-ink-soft` for regression.
  - AI confidence badge is teacher-only — but no component in this story renders one (those live in `AIInsightShell` in Story 1d-5).

- **UX-DR29 (role variants via separate components):** `DashboardHero` is implemented as three components (`TeacherDashboardHero`, `StudentDashboardHero`, `OwnerDashboardHero`) — never as one component with internal role branches. Admin reuses Owner per the IA — Storybook story documents the reuse.

- **UX-DR30 (StatusPill consolidation) is the second-highest-leverage rule:** six legacy pill names from the inventory collapse to one composable. Migration is enforced by Storybook stories that demonstrate semantic presets, not by re-exporting deprecated component names.

- **Role-rendering rule (UX-3):** components in this story are pure UI. Role gating is at the route via `<RoleGate>` per FW-7 — components do NOT check role internally. `PlanUsageMeter` and `BillingGraceBanner` are documented as Owner-only consumers but contain no role logic.

- **TS-6 (no `new Date()` in render):** all date labels in `WeekStrip` and `BandScoreChart` resolve via `t('date', { val: isoString })`. The Storybook test-runner / ESLint should grep for `new Date(` in story-co-located components and flag it.

- **WF-3 codegen note:** This story does NOT touch `api.yaml` or `.sql` files. `codegen.sh` does NOT need to run.

- **WF-7 service boundary:** All imports stay within `classlite-web/`. Components do not reach into `../../classlite-api/`. Any API-shape references use generated types from `src/generated/`.

- **WF-8 ATDD note:** No risk-score ≥6 ACs in this story (no auth, no tenant boundary, no payment processing). ATDD red tests are NOT mandatory. Vitest + axe assertions are written inline per TEST-FE-1 through TEST-FE-5.

- **Storybook conventions inherited from 1d-1:** decorator stack provides `QueryClientProvider`, `I18nextProvider`, `MemoryRouter`, MSW, role context. Locale and role toolbars switch global context. Three-state authoring rule enforced by the lint rule from 1d-1 AC3.

## Definition of Done

- [ ] All 8 ACs discharged.
- [ ] `StatusPill` consolidation complete; six legacy pill names retired in favor of semantic preset stories.
- [ ] `BandScoreChart`, `MetricBox`, `SkillTag`, `WeekStrip`, `ActionRail` + `ActionCard`, `DashboardHero` (×3 role variants + `AdminView` re-export), `PlanUsageMeter`, `BillingGraceBanner` all exist in `src/components/domain/` with co-located `.stories.tsx` files per FW-7.
- [ ] Three-state authoring rule (UX-DR28) satisfied for every data-rendering component.
- [ ] UX-DR22 regression-framing rule verified — no `--cl-crimson` / `--cl-danger` classes on any decline indicator.
- [ ] Every story renders correctly in `en` and `vi` (verified via Storybook locale toolbar).
- [ ] Vitest assertions confirm required i18n keys exist in both locales (per TEST-FE-4).
- [ ] axe-core via `vitest-axe` reports zero violations across all stories in scope.
- [ ] CI pipeline (`storybook:build` + `storybook:test` from 1d-1 AC5) is green on the PR.
- [ ] Stories reviewed by the designer via the Storybook artifact (or preview deploy if available).

## Out of Scope

- App-shell stack components (`AppShell`, `SidebarShell`, `TopbarShell`, etc.) — Story 1d-3.
- State components (`EmptyState`, `ErrorState`, `LoadingSkeleton`, `AIInsightShell`) — Story 1d-5.
- DataListTable family — Story 1d-6.
- Drawers / modals / forms — Story 1d-7.
- Tabs shell + schedule calendar (`SessionScheduleCalendar`, `MonthCalendar`, `ScheduleEditModal`) — Story 1d-8.
- Phase 4 deferred components: `WritingGradingSurface`, `SpeakingGradingSurface`, `AudioPlayer`, `WriteDocSurface`, `AnchoredQuestionCard`, `ExerciseAttemptShell`, `MobileWritingSurface`, `MobileQAThread`, etc. — these ship with their parent feature epics (5, 6, 7) per the Epic 1D Out-of-Scope table.
- Plan-tier upgrade flow, prorated billing math (`UpgradeModal`) — Story 1d-7 hosts the modal shell; billing logic ships in Epic 9 (billing).
- `PlanCard` / `BillingDashboardShell` / `NextInvoiceCard` / `InvoiceTable` / `UsageMetersGrid` — billing surfaces that compose `PlanUsageMeter` and `BillingGraceBanner` ship in Epic 9 (billing), not in this story.
- Real plan-limit threshold policy (when to show `warn` vs `critical` on the meter) — product decision, not a component concern; the meter takes `tone` from the consumer.
- Visual regression testing (Chromatic, Percy) — not in MVP scope per 1d-1 Out-of-Scope.

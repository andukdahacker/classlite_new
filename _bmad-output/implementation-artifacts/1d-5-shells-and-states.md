---
baseline_commit: a90010732057148b3c4e930c7c7b234aa4686378
---

# Story 1d-5 (legacy): Shells & State Components (Onboarding, Empty, Error, Loading)

Status: deferred-to-feature-epic

> **PATH B RE-SCOPE (2026-06-07):** After party-mode review, this story is deferred. Components ship with their consuming feature epics:
> - `OnboardingShell`, `PersonaPickCard`, `StepProgressDots`, `SetupCard`, `DoneHeroPanel`, `TaskChecklistItem`, `ImportBanner` → **Epic 2** (Onboarding) Stories 2.3a/2.3b/2.3c/2.4
> - `EmptyState` (consolidated) → **Epic 10** Story 10.3 (empty states)
> - Three `ErrorState` shape variants → **Epic 10** Story 10.4 (error states)
> - `LoadingSkeleton` primitives (`SkeletonText`, `SkeletonRect`, `SkeletonCircle`) → **MOVED TO STORY 1d-2** (`ui/` tier per Winston) — only the shape-semantic skeletons (`SkeletonTable`, `SkeletonChart`, `SkeletonList`) defer
> - `LoadingSkeleton` shape-semantic patterns → **Epic 10** Story 10.3 (or per-feature epic)
> - `AIInsightShell` → **Epic 4** Story 4.3 (AI content generation) or **Epic 6** Story 6.2 (AI grading)
>
> Note: This file is kept as an input artifact. Stories `1d-1`/`1d-2`/`1d-3` proceed; the new `1d-4` is the Phase 4 visual bridge.

<!-- Validation is optional. Run `validate-create-story` for a quality second pass before `dev-story`. -->

## Story

As a frontend developer,
I want the onboarding shell and the universal state components (`OnboardingShell`, `PersonaPickCard`, `StepProgressDots`, `SetupCard`, `DoneHeroPanel`, `TaskChecklistItem`, `ImportBanner`, the consolidated `EmptyState`, three `ErrorState` shape variants, `LoadingSkeleton` patterns, `AIInsightShell`) built and storied,
so that Epic 2 (onboarding) and Epic 10 (universal state surfaces) and every data-fetching view across Epic 2–10 (UX-DR24) compose against a complete state-handling palette without re-implementing the loading/empty/error trilogy per surface.

## Acceptance Criteria (BDD)

> **No risk-score ≥6 ACs in this story.** This is internal frontend tooling — no security surface, no tenant isolation, no auth flow. WF-8 ATDD red-tests are NOT mandatory. Vitest + axe assertions are written inline per `test-design-qa.md`. Note: `OnboardingShell` precedes role resolution (per `classlite-ia.md`); it does NOT depend on role context, which is a structural property tested via axe and unit test.

### AC1: `OnboardingShell` precedes role resolution

**Given** the `OnboardingShell` component (first seen `s00`, reused across `s01`–`s08`),
**When** inspecting `src/components/domain/OnboardingShell.tsx`,
**Then** it renders the centered hero layout used across the entire onboarding flow — top bar with brand mark + autosave indicator slot, centered content area (max-width per token scale), NO sidebar (distinct from `AppShell` from Story 1d-3),
**And** it does NOT call `useRole()` nor consume `RoleContext` — onboarding precedes role resolution per `classlite-ia.md`. A Vitest unit test asserts no role context is required to render (renders cleanly without a `RoleContext.Provider` wrapper),
**And** the autosave indicator slot accepts arbitrary content (typically a Storybook-decorated `<AutosaveStatus />` from later stories) — the shell does NOT own autosave state.

**And** the brand mark links to the marketing site root in production but is non-interactive in the onboarding flow (per UX team note in mockups — prevents users from accidentally leaving mid-onboarding).

**And** stories ship: `Default`, `WithAutosaveIndicator` (autosave slot populated), `Mobile` (stacked variant for `s00`-equivalent mobile onboarding — purpose-designed mobile per UX-DR32, NOT a CSS squish per UX-4).

### AC2: Onboarding step components

**Given** the inventory's onboarding step components (`PersonaPickCard` `s00`, `StepProgressDots` reused `s01`/`s02`/`s03`/`s05`, `SetupCard` reused `s01`/`s02`/`s03`/`s05`/`s07`/`s08`, `DoneHeroPanel` `s04`/`s06`, `TaskChecklistItem` `s09`/`s53`, `ImportBanner` `s02`/`s07`),
**When** each component is built in `src/components/domain/`,
**Then**:
- `PersonaPickCard` renders the three-up illustrated card-pick (Operator / Solo / Founder) with SVG illustrations passed as a slot, selected + hover states, and an `onSelect(persona)` callback. Stories: `Default`, `Selected`, `Hover`.
- `StepProgressDots` accepts `currentStep`, `totalSteps` props — persona-aware total (Operator/Founder = 4 steps; Solo = 2 steps). Stories exercise both persona totals.
- `SetupCard` is the standard sheet container with three named slots: `head` (eyebrow + title + sub), `body`, `foot` (back / skip / save → next CTA). Stories: `Default`, `WithSkipOption`, `LastStep` (only "Save" CTA, no "Skip").
- `DoneHeroPanel` renders the big checkmark hero + name-em headline + summary stat tiles slot + primary CTA. Stories: `Default`, `WithStats` (composing `MetricBox` from 1d-4).
- `TaskChecklistItem` accepts `done: boolean`, `required: boolean`, `arrow: () => void`, plus icon + name + foot-badge slots. Stories: `Default`, `Done`, `Required`, `Optional`.
- `ImportBanner` renders the "Have existing data?" banner with an action link slot. Stories: `Default`, `Dismissed` (state owned by consumer per FW-5 — the banner accepts an `onDismiss` callback, dismiss state lives in Zustand UI store at consumer site).

**And** every visible string in every onboarding component resolves via i18n keys per UX-2 — including persona names (`t('onboarding.persona.operator')`, `t('onboarding.persona.solo')`, `t('onboarding.persona.founder')`),
**And** the locale toolbar verifies Vietnamese rendering — persona descriptions can exceed English length and must not overflow the card.

**And** axe-core reports zero violations across all onboarding component stories — `PersonaPickCard` selection is announced via `aria-pressed`, `StepProgressDots` provides an `aria-label` describing progress (e.g., "Step 2 of 4").

### AC3: `EmptyState` consolidation (UX-DR31)

**Given** the inventory's empty-state proliferation across `s53`–`s62` (10 distinct empty surfaces — teacher day-one, classes empty, roster empty, inbox empty per role, knowledge hub empty, archive empty, analytics no-data, student day-one, etc.),
**When** inspecting `src/components/domain/EmptyState.tsx`,
**Then** one component covers all 10 variants via prop composition (NOT 10 separate components),
**And** the API is:
```ts
type EmptyStateProps = {
  icon: ReactNode                 // icon or illustration slot
  headline: string                // i18n-resolved
  description?: string            // i18n-resolved, optional
  actions?: ReactNode             // one or more CTAs; renders nothing if absent
  tone?: 'guided' | 'simple'      // 'guided' is day-one rich variant; default 'simple'
}
```
**And** every visible string is passed in i18n-resolved by the consumer — `EmptyState` never owns translation logic. Storybook stories pass `t('classes.empty.headline')` etc., NEVER hardcoded English (per UX-1 + TEST-FE-4).

**And** the role-decorator pattern (per UX-DR29) applies at the consumer level: for the inbox-empty variant (`s56`), the consumer wraps `EmptyState` rendering with role-scoped headline keys (`t('inbox.empty.teacher.headline')` vs `t('inbox.empty.student.headline')` vs `t('inbox.empty.owner.headline')`). The component itself does NOT read role — separation enforced per UX-3.

**And** Storybook stories demonstrate the 10 inventory variants via prop composition:
- `TeacherDayOne` (`s53`) — `tone='guided'` with three-step start headline; composes `EmptyDashboardSteps` companion if rich-day-one
- `ClassesEmpty` (`s54`) — simple variant: icon + headline + "Create class" CTA
- `RosterEmpty` (`s55`) — icon + "No students yet" + "Add students" CTA
- `InboxEmptyTeacher` / `InboxEmptyStudent` / `InboxEmptyOwner` (`s56` per role) — three stories using role-scoped i18n keys
- `KnowledgeHubEmpty` (`s59`) — icon + "Hub is empty" + upload CTA
- `ArchiveEmpty` (`s60`) — icon + "Nothing archived" + zero CTAs
- `AnalyticsNoData` (`s57`/`s61`) — icon + headline + companion `GhostedChartFrame` slot (ghosted chart per inventory)
- `StudentDayOne` (`s62`) — `tone='guided'` with role-appropriate student copy

**And** axe-core reports zero violations on every variant — empty-state region uses `aria-live="polite"` so users who arrive via async load are notified of "no data" appearance per TEST-UX-2.

### AC4: `FormValidationError` shape variant (UX-DR31 + UX-DR16)

**Given** the form-validation error shape from `s65`,
**When** inspecting `src/components/domain/ErrorState/FormValidationError.tsx`,
**Then** it renders the three-part recovery pattern per UX-DR16 — `what happened` (banner heading) + `why` (enumerated field-level issues) + `what to do next` (per-issue inline CTAs OR a single primary recovery action),
**And** the component composes two sub-parts:
- A top-of-form summary banner listing the field errors (one row per error, each linkable to the offending field via internal anchor)
- Inline field-error decoration applied at the field level (red border on input + below-input message + `aria-invalid="true"` + `aria-describedby` pointing to the message node)

**And** every error string resolves via i18n keys — `t('form.errors.nameConflict', { name })`, `t('form.errors.invalidDates')`, `t('form.errors.capacityExceedsPlan', { cap, planMax })` — NEVER hardcoded English (per UX-1 + TEST-FE-4),

**And** the story covers the canonical `s65` triple-error pattern: name conflict + invalid date range + capacity exceeds plan, with each error rendered in the banner and decorated inline,

**And** axe-core reports zero violations — banner uses `role="alert"` for SR announcement, field error messages are `aria-describedby`-linked, field inputs are `aria-invalid="true"`.

**And** the banner provides keyboard navigation: each enumerated issue is a focusable link that scrolls/focuses the offending field on Enter (per TEST-UX-2).

### AC5: `LockedContentError` shape variant (UX-DR31 + UX-DR16)

**Given** the locked-content error shape from `s64`/`s66`,
**When** inspecting `src/components/domain/ErrorState/LockedContentError.tsx`,
**Then** it renders the read-only strip + unlock-paths-explainer pattern per UX-DR16 three-part recovery — `what happened` (locked headline) + `why` (lock reason: "grades finalized" / "deadline passed") + `what to do next` (unlock paths: "clone and edit" / "request extension" / "unfinalize cohort"),
**And** the component has two named slots:
- `lockReason` — short paragraph explaining the lock (i18n-resolved)
- `unlockPaths` — `ReactNode` accepting one or more action cards (typical: 2-up cards from inventory's `UnlockPathsCard`, which is deferred to feature epics — this story ships the shell, not the card content)

**And** stories cover both inventory patterns:
- `FinalizedAssignment` (`s66`) — "Locked because grades finalized" + 2-up unlock paths
- `PastDeadlineSubmission` (`s64` shell only — the late-penalty breakdown is deferred to Epic 5) — read-only essay shell + "request extension" placeholder

**And** every visible string resolves via i18n keys — never hardcoded English,
**And** axe-core reports zero violations — strip uses `role="status"` for non-urgent announcement (per TEST-UX-2),
**And** the strip visually uses `--cl-line-soft` border + `--cl-paper-muted` background (no danger coloration — locked is informational, not error).

### AC6: `PermissionDeniedError` shape variant (UX-DR31 + UX-DR16)

**Given** the permission-denied error shape from `s67`,
**When** inspecting `src/components/domain/ErrorState/PermissionDeniedError.tsx`,
**Then** it renders the full-page denied state per UX-DR16 three-part recovery — `what happened` (lock icon + "Permission denied" headline) + `why` (i18n-resolved explainer: "You need teacher access to view this class.") + `what to do next` (back-to-allowed-page CTA + optional "Request access" secondary action),
**And** the component accepts:
```ts
type PermissionDeniedErrorProps = {
  resourceLabel: string             // i18n-resolved noun for the denied resource
  reason?: string                   // i18n-resolved one-sentence explainer
  primaryAction?: { label: string; onClick: () => void }
  secondaryAction?: { label: string; onClick: () => void }
}
```

**And** the component does NOT call `useRole()` or `useRouter()` — the consumer wires the `primaryAction` callback (typically `router.push('/dashboard')`) at the route level per FW-7. Centralizing routing in the component would couple it to React Router internals,

**And** stories cover three role × resource combinations: `StudentBlockedFromBilling`, `TeacherBlockedFromOwnerSettings`, `AdminBlockedFromOwnerOnlyAction` — each demonstrating different `resourceLabel` + `reason` props (all i18n-resolved),

**And** axe-core reports zero violations — page-level region uses `<main role="main">` with focused-on-mount headline so SR announces the denial on route entry per TEST-UX-2,

**And** every visible string resolves via i18n keys — never hardcoded English (per UX-1 + TEST-FE-4).

### AC7: `LoadingSkeleton` patterns (UX-DR24)

**Given** the UX-DR24 skeleton-state rule and the absence of a centralized skeleton primitive in `ui/` (shadcn provides `Skeleton`, but consumers compose shapes per surface),
**When** inspecting `src/components/domain/LoadingSkeleton/`,
**Then** the directory exports composable skeleton shape patterns that consumers assemble to mirror their final layout:
- `SkeletonText` — single text-line skeleton with width prop (`narrow` | `medium` | `wide` | `full`)
- `SkeletonRect` — generic rectangular skeleton with width + height props
- `SkeletonCircle` — circular skeleton (avatar placeholder) with size prop
- `SkeletonList` — repeating list-row skeleton (rows = N prop)
- `SkeletonCard` — card-shaped skeleton (head + body + foot rows)
- `SkeletonTable` — table-shaped skeleton (header row + N body rows × M columns)
- `SkeletonChart` — chart-shaped rectangle with optional axis-line strokes (no animated bars per UX-DR24)

**And** all skeleton patterns use `--cl-line-soft` as the base fill with a pulse animation overlay,
**And** the pulse animation is suppressed when `prefers-reduced-motion: reduce` matches — render becomes a static fill (verified via Vitest with `matchMedia` mock per TEST-UX-2),
**And** centered spinners are explicitly REJECTED — a Storybook test-runner rule (or ESLint rule) flags any `<Spinner>` or `role="progressbar"` indeterminate primitive inside a `*.stories.tsx` Loading export. Spinners are reserved for in-flight button states only, NOT for data loading,

**And** stories cover the seven patterns above plus a `ComposedExample` story demonstrating assembly into a dashboard-card skeleton (head + three data-row skeletons + foot CTA skeleton).

### AC8: `AIInsightShell` consolidation + teacher-only confidence (UX-DR22)

**Given** the inventory's three AI strip components (`AIRailStrip` `s18`/`s23`/`s24`, `AIGradingSuggestion` `s23`/`s24`/`s25`, `AICohortInsight` `s46`/`s23`/`s24`) and the cross-cutting observation that they share visual DNA,
**When** inspecting `src/components/domain/AIInsightShell.tsx`,
**Then** one component consolidates the three via slots and props (per the inventory's "Consider unified `AISuggestionShell`" recommendation),
**And** the API is:
```ts
type AIInsightShellProps = {
  intent: 'summary' | 'suggestion' | 'cohort-insight' // affects header tone, not content
  marker: ReactNode                                   // AI gradient marker slot
  body: ReactNode                                     // suggestion content slot
  actions?: ReactNode                                 // accept / refine / dismiss slot
  confidence?: 'high' | 'medium'                      // OPTIONAL — teacher-only render
  disclaimer?: string                                 // i18n-resolved AI caveat
  viewerRole?: 'teacher' | 'student' | 'owner' | 'admin' // for confidence-badge gating
}
```

**And** the confidence badge renders ONLY when `viewerRole === 'teacher'` AND `confidence` is provided per UX-DR22 — student-facing, owner-facing, and admin-facing renders ALL suppress the badge even when `confidence` is passed,
**And** a Vitest test asserts the badge is absent from the DOM (not just hidden) for non-teacher roles per TEST-FE-6 (test what's absent, not just present),

**And** stories ship for each `intent` × applicable role combination:
- `RailStripTeacher` (`intent='summary'`, `viewerRole='teacher'`, with confidence badge)
- `RailStripStudent` (`intent='summary'`, `viewerRole='student'`, NO confidence badge in DOM)
- `GradingSuggestionTeacher` (`intent='suggestion'`, `viewerRole='teacher'`, with accept/refine/dismiss actions)
- `CohortInsightOwner` (`intent='cohort-insight'`, `viewerRole='owner'`, no confidence badge per UX-DR22)
- `Loading` — skeleton shape mirroring the shell (marker + body + actions skeletons)

**And** the disclaimer is always rendered as small text below the body — i18n-resolved (`t('ai.disclaimer')`), never hardcoded English,
**And** axe-core reports zero violations across all variants — gradient marker has `aria-hidden="true"`, action buttons have accessible names from i18n labels.

### AC9: aria-live regions + three-state coverage discharged

**Given** the UX-DR28 three-state rule from Story 1d-1 and TEST-UX-2 aria-live requirement,
**When** any state component in this story's scope renders dynamic content,
**Then**:
- `EmptyState` uses `aria-live="polite"` when it appears after async load (the consumer wraps it in a live region OR the component opts-in via a `live` prop)
- `FormValidationError` banner uses `role="alert"` for immediate SR announcement on form-submit failure
- `LockedContentError` strip uses `role="status"` for non-urgent informational announcement
- `PermissionDeniedError` focuses its headline on mount so SR announces the denial on route entry
- `LoadingSkeleton` patterns use `aria-busy="true"` on the skeleton container; consumers toggle `aria-busy="false"` and announce the loaded content via `aria-live` on the data region (consumer responsibility — documented in Storybook conventions)

**And** every state component renders correctly in `en` and `vi` via the Storybook locale toolbar — Vietnamese error messages can exceed English length and must not break the banner layout,
**And** every story declares its required i18n keys (top-of-file comment) and a Vitest assertion confirms `i18n.exists(key)` returns true in both `en.json` and `vi.json` (per TEST-FE-4),
**And** axe-core via `vitest-axe` reports zero violations across all stories in this story's scope (per TEST-FE-5).

## Tasks / Subtasks

- [ ] **Task 1 (AC1):** Build `OnboardingShell` in `src/components/domain/OnboardingShell.tsx`.
  - [ ] Centered hero layout with brand-mark top bar + autosave-indicator slot.
  - [ ] Vitest unit test asserts no `RoleContext.Provider` is required to render.
  - [ ] Stories: `Default`, `WithAutosaveIndicator`, `Mobile`.
- [ ] **Task 2 (AC2):** Build onboarding step components.
  - [ ] `PersonaPickCard` — three-up illustrated, `onSelect` callback, persona-name i18n keys.
  - [ ] `StepProgressDots` — persona-aware total step count, `aria-label="Step X of Y"`.
  - [ ] `SetupCard` — head / body / foot slot composition.
  - [ ] `DoneHeroPanel` — checkmark + headline + summary stats slot + primary CTA.
  - [ ] `TaskChecklistItem` — done / required / arrow props; stories cover all states.
  - [ ] `ImportBanner` — `onDismiss` callback; dismiss state owned by consumer per FW-5.
  - [ ] Stories: each component exercised in `en` and `vi` for Vietnamese overflow.
- [ ] **Task 3 (AC3):** Build consolidated `EmptyState` in `src/components/domain/EmptyState.tsx`.
  - [ ] Props: `icon`, `headline`, `description?`, `actions?`, `tone?`.
  - [ ] Storybook stories: 10 named variants per inventory + `s56` role-decorator pattern (three role-keyed inbox-empty stories).
  - [ ] No internal role logic — consumer passes role-scoped i18n keys per UX-3.
  - [ ] `aria-live="polite"` region option for async-arrival announcement per TEST-UX-2.
- [ ] **Task 4 (AC4):** Build `FormValidationError` in `src/components/domain/ErrorState/FormValidationError.tsx`.
  - [ ] Top-banner + inline-field-error sub-parts.
  - [ ] Three-part recovery pattern per UX-DR16: what happened / why / what next.
  - [ ] Banner uses `role="alert"`; field errors use `aria-invalid` + `aria-describedby`.
  - [ ] Story: canonical `s65` triple (name conflict + invalid dates + capacity exceeds plan).
  - [ ] Keyboard nav: banner-link Enter focuses offending field (per TEST-UX-2).
- [ ] **Task 5 (AC5):** Build `LockedContentError` in `src/components/domain/ErrorState/LockedContentError.tsx`.
  - [ ] Read-only strip + unlock-paths slot.
  - [ ] Stories: `FinalizedAssignment` (`s66`), `PastDeadlineSubmission` (`s64` shell only).
  - [ ] Strip uses `role="status"`; visual uses `--cl-paper-muted` not danger coloration.
- [ ] **Task 6 (AC6):** Build `PermissionDeniedError` in `src/components/domain/ErrorState/PermissionDeniedError.tsx`.
  - [ ] Full-page lock icon + headline + reason + primary/secondary actions.
  - [ ] No internal `useRole()` or `useRouter()` — consumer wires callbacks.
  - [ ] Stories: `StudentBlockedFromBilling`, `TeacherBlockedFromOwnerSettings`, `AdminBlockedFromOwnerOnlyAction`.
  - [ ] Page-level `role="main"` + headline focused on mount per TEST-UX-2.
- [ ] **Task 7 (AC7):** Build `LoadingSkeleton` pattern set in `src/components/domain/LoadingSkeleton/`.
  - [ ] `SkeletonText`, `SkeletonRect`, `SkeletonCircle`, `SkeletonList`, `SkeletonCard`, `SkeletonTable`, `SkeletonChart`.
  - [ ] Pulse animation respects `prefers-reduced-motion` (Vitest `matchMedia` mock).
  - [ ] `aria-busy="true"` on skeleton container.
  - [ ] Lint rule (Storybook test-runner OR ESLint) flags `<Spinner>` / `role="progressbar"` indeterminate in `Loading` stories.
  - [ ] Stories: seven patterns + `ComposedExample` (dashboard-card composition).
- [ ] **Task 8 (AC8):** Build `AIInsightShell` in `src/components/domain/AIInsightShell.tsx`.
  - [ ] Consolidate `AIRailStrip`, `AIGradingSuggestion`, `AICohortInsight` per inventory recommendation.
  - [ ] Props: `intent`, `marker`, `body`, `actions?`, `confidence?`, `disclaimer`, `viewerRole`.
  - [ ] Confidence badge renders ONLY when `viewerRole === 'teacher'` per UX-DR22.
  - [ ] Vitest test per TEST-FE-6: badge absent from DOM for student/owner/admin (not just hidden).
  - [ ] Disclaimer always rendered i18n-resolved.
  - [ ] Stories: `RailStripTeacher`, `RailStripStudent`, `GradingSuggestionTeacher`, `CohortInsightOwner`, `Loading`.
- [ ] **Task 9 (AC9):** Discharge aria-live + three-state + i18n coverage.
  - [ ] Every dynamic state region declares the correct aria role / live attribute per TEST-UX-2.
  - [ ] Every story renders in `en` and `vi`; Vietnamese overflow verified.
  - [ ] Vitest assertion: required i18n keys exist in both locales per TEST-FE-4.
  - [ ] axe-core: zero violations across all stories in scope.

## Dev Notes

- **Stack reminders:**
  - React 19 — no `forwardRef`, refs are plain props, no `"use client"`.
  - Vite 8 (Rolldown) — story files run under the Storybook builder from 1d-1.
  - TypeScript strict — all props typed; no `any`; no `// @ts-ignore`. Discriminated unions for `tone`, `intent`, `viewerRole`.
  - Tailwind utility classes only; design tokens via CSS variables. No raw hex. No inline `style={{}}`.
  - shadcn primitives (`Skeleton`, `Alert`, `Card`) consumed from `src/components/ui/` — never hand-edited (XL-1 + FW-7).
  - i18n: all visible strings via `t()`. `EmptyState`, `ErrorState` shape variants, and `AIInsightShell` accept i18n-resolved strings from the consumer — they never own translation logic.

- **One mock seam per side:** None of these state components fetch data. Stories pass props directly. Loading-state stories simulate the "data not yet arrived" condition by rendering the skeleton variant — they do NOT invoke MSW. Feature epics that consume these components use MSW at the HTTP boundary (per TEST-FE-1) to drive real loading → success / error transitions in their feature stories.

- **i18n is co-primary** (UX-2 + NFR-1): Vietnamese error messages are often longer than English equivalents and use diacritics that affect line-height — verify in every error-state story. Persona descriptions in `PersonaPickCard` are the second-highest overflow risk.

- **UX-DR31 (state-component consolidation) is the highest-leverage rule in this story:**
  - `EmptyState` is ONE component with prop composition for 10 inventory variants — NOT 10 separate components. This is the key architectural call on the designer's behalf.
  - `ErrorState` splits into THREE shape-distinct components — `FormValidationError`, `LockedContentError`, `PermissionDeniedError` — because their layouts and recovery patterns differ enough that one shell would over-abstract. Each gets one AC.

- **UX-DR24 (skeleton states):** shape-mirroring is mandatory. Centered spinners are reserved for in-flight button states ONLY — NEVER for data loading. A lint rule (ESLint OR Storybook test-runner) enforces this on `Loading` story exports.

- **UX-DR16 (three-part recovery framing):** every error-state variant follows what-happened + why + what-next — this is structural to the component, not a styling concern. Tested via story content reviews.

- **UX-DR22 (Feedback Design Language) for `AIInsightShell`:** confidence badge is teacher-only. The student / owner / admin renders MUST suppress the badge from the DOM entirely (per TEST-FE-6 — hidden is not enough; absence is enforced).

- **UX-DR29 (role variants):** the inbox-empty pattern (`s56`) is the canonical role-decorator example — consumer passes role-scoped i18n keys; component does NOT read role. This is the project's preferred pattern for role-aware empty states.

- **Role-rendering rule (UX-3):** components in this story are role-agnostic by design. `OnboardingShell` precedes role resolution (tested). `EmptyState` and `ErrorState` shapes take i18n-resolved strings from the consumer — role-scoping happens at the call site. `AIInsightShell` accepts `viewerRole` as a prop and gates the confidence badge in render — this is a deliberate exception because the gating rule is one-line and component-local, not cross-cutting.

- **TS-6 (no `new Date()` in render):** state components do not render dates directly. If a feature epic adds a "Last updated" timestamp to an `EmptyState` description, the consumer formats it via `t('date', { val })` and passes the resolved string.

- **TEST-UX-2 (aria-live for dynamic state changes):** every state region declares the correct ARIA semantics:
  - Empty (async arrival): `aria-live="polite"` (consumer opt-in)
  - Form validation error (immediate): `role="alert"`
  - Locked content (informational): `role="status"`
  - Permission denied (route entry): `role="main"` + focused headline on mount
  - Loading skeleton: `aria-busy="true"` on container

- **WF-3 codegen note:** This story does NOT touch `api.yaml` or `.sql` files. `codegen.sh` does NOT need to run.

- **WF-7 service boundary:** All imports stay within `classlite-web/`. No reach into `../../classlite-api/`. State components do not consume generated API types — they are presentation-layer pure.

- **WF-8 ATDD note:** No risk-score ≥6 ACs in this story (no auth, no tenant boundary, no payment). ATDD red tests are NOT mandatory. Vitest + axe assertions are written inline per TEST-FE-1 through TEST-FE-5 and TEST-UX-2.

- **Storybook conventions inherited from 1d-1:** decorator stack (`QueryClientProvider`, `I18nextProvider`, `MemoryRouter`, MSW, role context), locale toolbar, role toolbar, three-state authoring rule, axe-core baseline.

## Definition of Done

- [ ] All 9 ACs discharged.
- [ ] `OnboardingShell`, `PersonaPickCard`, `StepProgressDots`, `SetupCard`, `DoneHeroPanel`, `TaskChecklistItem`, `ImportBanner` exist in `src/components/domain/` with co-located `.stories.tsx` per FW-7.
- [ ] Consolidated `EmptyState` ships with 10 inventory-variant stories — NOT 10 separate components.
- [ ] Three `ErrorState` shape variants (`FormValidationError`, `LockedContentError`, `PermissionDeniedError`) exist in `src/components/domain/ErrorState/` with co-located stories.
- [ ] `LoadingSkeleton` pattern set (7 patterns + composed example) exists in `src/components/domain/LoadingSkeleton/`. Spinner-as-loading-indicator lint rule active.
- [ ] `AIInsightShell` consolidates the three inventory AI strips; confidence badge teacher-only per UX-DR22 (verified by TEST-FE-6 absence assertion).
- [ ] Every visible string in every story is i18n-resolved — no hardcoded English (verified by TEST-FE-4 + lint check on `en.json` / `vi.json` key existence).
- [ ] Every dynamic state region carries the correct ARIA role / live attribute per TEST-UX-2.
- [ ] `prefers-reduced-motion` suppresses skeleton pulse animation (Vitest `matchMedia` mock test passes).
- [ ] axe-core via `vitest-axe` reports zero violations across all stories.
- [ ] CI pipeline (`storybook:build` + `storybook:test` from 1d-1 AC5) is green on the PR.
- [ ] Stories reviewed by the designer via the Storybook artifact (or preview deploy if available).

## Out of Scope

- App-shell stack components (`AppShell`, `SidebarShell`, `TopbarShell`, etc.) — Story 1d-3.
- Visual & status domain components (`StatusPill` family, `BandScoreChart`, `MetricBox`, `SkillTag`, `WeekStrip`, `ActionRail`, `DashboardHero` role variants, `PlanUsageMeter`, `BillingGraceBanner`) — Story 1d-4.
- DataListTable family — Story 1d-6.
- Drawers / modals / forms (`Drawer`, `Modal` patterns, RHF + Zod wrappers, `BrandColorPicker`, `AssignChip` inline editors) — Story 1d-7.
- Tabs shell + schedule calendar — Story 1d-8.
- Phase 4 deferred components: `WriteDocSurface`, `WritingGradingSurface`, `SpeakingGradingSurface`, `AudioPlayer`, `AnchoredQuestionCard`, `ExerciseAttemptShell`, `FinishSetupCard`, `TemplateStarterCard`, `ClassRowEditor`, `LatePenaltyBreakdown`, `LockedSubmissionState`, `UnlockPathsCard`, `MobileWritingSurface`, `MobileQAThread`, `MobileResultHero`, `MobileSwipeRow`, `MobilePushApproveCard`, `MobileQuestionReplyComposer`, `EnrolmentComposer`, `PermissionsMatrix`, `TermCalendarEditor`, `StudentMistakesList`, `RecommendationsList`, `StudentPerformanceDashboard`, `DocumentPreview` — all defer to their parent feature epics per the Epic 1D Out-of-Scope table.
- Inventory's `EmptyDashboardSteps` companion component (`s53`/`s62` rich-day-one three-step row) — covered as a consumer story variant of `EmptyState` with `tone='guided'`; the three-step card content is a feature-level concern that ships with onboarding handoff (Epic 2).
- Inventory's `GhostedChartFrame` (`s57`/`s61` ghosted analytics chart) — covered as a consumer story variant of `EmptyState` for analytics no-data; the dashed-line chart frame ships as part of Epic 8 (analytics) when the live chart components ship.
- Inventory's `LatePenaltyBreakdown` (`s63`) — deferred to Epic 5 (assignments) per the Epic 1D Out-of-Scope table.
- Translation content authoring for `en.json` / `vi.json` keys — Story 1.7c (i18n setup) provides the infrastructure; this story declares which keys exist and asserts they resolve in both locales, but the actual copy is authored by the content writer per the UX team's tone guide.
- Visual regression testing (Chromatic, Percy) — not in MVP scope per 1d-1 Out-of-Scope.

---
baseline_commit: a90010732057148b3c4e930c7c7b234aa4686378
---

# Story 1d-1: Storybook Foundation, Decorators & Vite Compat Spike

Status: backlog

<!-- Validation is optional. Run `validate-create-story` for a quality second pass before `dev-story`. -->

> **PRE-DEV GATE (mandatory per Murat):** `/bmad-tea TD` must be re-run for Epic 1D before this story transitions `backlog → ready-for-dev`. The current `test-design-architecture.md` (2026-06-04) and `test-design-qa.md` predate Epic 1D; R38 (i18n parity, score 6) is unmitigated across the epic. Confirm R38/R42 inheritance per story, decompose ~30 in-scope components (Path B trimmed scope) into the P0–P3 coverage matrix, and treat AC4 of this story (i18n-parity CI) as **the R38 mitigation evidence** required before 1d-2 unblocks.

## Story

As a frontend developer,
I want Storybook installed against the Vite 8 / Rolldown build with a three-tier compatibility ladder, a complete decorator stack (i18n, role context, TanStack Query, React Router, MSW, design tokens, fonts, Tailwind, `axe-core`, `Suspense`), an enforced three-state authoring convention, and an i18n parity CI step,
so that every component developed in Stories 1d-2 through 1d-4 — and every Epic 2–10 frontend story thereafter — ships with a consistent, designer-iteratable Storybook story file from day one **without** an unmitigated i18n parity risk lurking under the foundation.

## Acceptance Criteria (BDD)

> **Three-tier compatibility ladder (per Winston).** AC1 is no longer a binary "Storybook works on Rolldown or we defer Storybook entirely." It's a three-tier fallback: (a) Storybook on Rolldown — preferred; (b) Storybook on standard Vite/esbuild builder while the main app stays on Rolldown — preserves the designer playground; (c) defer Storybook entirely — last resort. The trade we're making in Epic 1D (launch slip for parallel designer iteration) is only protected if (b) is reachable.
>
> **R38 mitigation is in-scope (per Murat).** This story introduces the i18n-parity CI step that mitigates R38 (Vietnamese key parity, register score 6) for every Epic 1D story downstream. Without AC4 discharged, no 1d-N story should advance.
>
> **No other risk-score ≥6 ACs in this story.** This is internal frontend tooling — no security surface, no tenant isolation, no auth flow. WF-8 ATDD red tests are NOT mandatory beyond AC4's parity assertion. Vitest + Playwright assertions described below are written by the dev inline using the patterns from `test-design-qa.md` (refreshed by the TEA gate above).

### AC1: Three-tier Vite 8 / Rolldown compatibility ladder

**Given** the `classlite-web/` project on its current Vite 8 (Rolldown) configuration,
**When** the dev runs the compatibility ladder,
**Then** the work proceeds top-down through three tiers, stopping at the highest tier that passes:

**Tier A — Storybook on Rolldown (preferred, 1 day timebox).**
1. Install via `npx storybook@latest init --type react --builder vite`.
2. Verify the 5 acceptance checks:
   - Storybook starts via `npm run storybook` with no Rolldown-specific plugin errors.
   - A trivial primitive story (`Button.stories.tsx`) renders correctly in the Storybook UI.
   - A primitive story importing a Tailwind-themed component renders with design tokens applied (no missing CSS).
   - `vite.config.ts` continues to build the main app via `npm run build` (Rolldown bundle) with Storybook config present.
   - `npm run storybook:build` produces a static Storybook artifact.
3. If all 5 pass → commit Tier A and proceed to AC2.
4. If any fail on Rolldown grounds → record failure mode and escalate to Tier B.

**Tier B — Storybook on standard Vite/esbuild builder, app stays on Rolldown (1 day timebox).**
1. Configure Storybook's Vite builder to use the upstream Vite default builder (esbuild) for its own process: `framework: { name: '@storybook/react-vite', options: { builder: { viteConfigPath: '.storybook/vite.config.storybook.ts' } } }`.
2. Maintain a separate `.storybook/vite.config.storybook.ts` that does NOT enable Rolldown — the main `vite.config.ts` keeps Rolldown for production builds.
3. Re-run the 5 checks from Tier A.
4. If all 5 pass → commit Tier B, document the dual-builder footprint in `classlite-web/docs/storybook-rolldown-spike.md`, and proceed to AC2. The designer playground is preserved.
5. If any still fail → escalate to Tier C.

**Tier C — Defer Storybook (last resort, requires explicit re-scope approval).**
1. Document the failure modes from Tiers A and B in `classlite-web/docs/storybook-rolldown-spike.md`.
2. Open follow-up story `1d-Z: Storybook Foundation — post-Rolldown-fix Retry` in the backlog with the failure mode as scope.
3. Mark this story `done` with the kill-switch invoked; AC2–AC9 are NOT discharged.
4. Stories 1d-2, 1d-3, 1d-4 proceed without Storybook — each builds components with three-state Vitest coverage but NO `*.stories.tsx` files. The DoD amendment for Epic 2–10 is suspended until 1d-Z ships.
5. **Re-scope decision required:** the PM (John) and the user (Ducdo) must explicitly approve Tier C before invoking it — it materially compromises the Path B trade (parallel designer iteration via Storybook). Do not invoke Tier C silently.

**And** total timebox across Tier A + Tier B = 2 working days. If both fail, escalate; do not silently extend the spike.

_Pinned by the spike doc: `classlite-web/docs/storybook-rolldown-spike.md` records the outcome regardless of tier reached._

### AC2: Decorator stack + preview-side dependencies

**Given** Storybook is operational at Tier A or Tier B,
**When** inspecting `classlite-web/.storybook/preview.tsx`,
**Then** the file exports a `decorators` array applied to every story containing the following wrappers, composed outside-in (Router outermost, MSW innermost). The composition order matters — document it at the top of `preview.tsx` with a comment, and require any future addition to preserve the chain.

1. **`QueryClientProvider`** with a fresh `QueryClient` per story render:
   ```ts
   const queryClient = new QueryClient({
     defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
   })
   ```
   Fresh per render so cache state never leaks across stories (per TEST-FE-1).

2. **`I18nextProvider`** with both `en.json` and `vi.json` loaded synchronously at preview boot. A Storybook toolbar control exposes locale switching:
   ```ts
   globalTypes: {
     locale: {
       name: 'Locale',
       defaultValue: 'en',
       toolbar: { items: ['en', 'vi'], icon: 'globe' },
     },
   }
   ```
   The active locale is read by a decorator that calls `i18n.changeLanguage(context.globals.locale)` before render.

3. **`MemoryRouter`** from React Router v7. Default `initialEntries={['/']}`. Stories override via parameters:
   ```ts
   export const ClassDetail = { parameters: { router: { initialEntries: ['/classes/abc'] } } }
   ```

4. **MSW handlers** wired via `msw-storybook-addon`. The global `worker.start()` runs at preview boot. Stories declare per-story handlers via `parameters.msw.handlers`:
   ```ts
   parameters: {
     msw: {
       handlers: [
         http.get('/api/v1/classes', () => HttpResponse.json({ data: mockClasses })),
       ],
     },
   }
   ```
   **`Empty` stories are driven by MSW returning empty arrays/objects** (e.g. `HttpResponse.json({ data: [] })`) — NEVER by mocking `useQuery` directly. The consumer's component handles the empty-render branch; MSW provides the trigger.

5. **Role context decorator** wrapping a mock `useRole()` hook. Storybook toolbar exposes role switching:
   ```ts
   globalTypes: {
     role: {
       name: 'Role',
       defaultValue: 'teacher',
       toolbar: { items: ['owner', 'admin', 'teacher', 'student'], icon: 'user' },
     },
   }
   ```
   The role value is read by the decorator and injected via the existing `RoleContext` provider so `useRole()` returns the toolbar-selected role.

6. **Preview-side dependencies (per Winston's foundation-gap finding)** — `preview.tsx` ALSO imports/registers, before any decorator runs:
   - **Tailwind:** `import '../src/index.css'` (or whichever entry loads Tailwind via `@tailwindcss/vite`). Without this, design-token classes don't resolve in Storybook.
   - **Design tokens:** `import '../src/tokens.css'` (the shared `tokens.css` file from Story 1.7a). All `--cl-*` custom properties must resolve in story render.
   - **Fonts:** Preload Fraunces, Geist, and Geist Mono via `<link rel="preload" as="font" ...>` in `.storybook/preview-head.html`. Without preload, Fraunces fallbacks load and the typography rhythm in `s00`/`s23`/`s34` looks wrong in Storybook.
   - **Suspense boundary:** wrap stories in a single top-level `<Suspense fallback={<SkeletonRect />}>` so any story using `useSuspenseQuery` (FW-1 contract) renders without crashing the preview.
   - **`date-fns/locale/vi`:** register via `setDefaultOptions({ locale: vi })` when the locale toolbar is set to `vi`. Without this, calendar / date formatters in downstream stories default to `en-US` regardless of toolbar (per TS-6).

**And** these preview-side dependencies are verified by the Tier A/B compatibility check #3 — design-token resolution and font rendering must pass before the spike commits.

### AC3: Three-state authoring convention — enforced by `@storybook/test-runner` (error-on-merge)

**Given** a story file is authored for any `domain/` or `features/<area>/components/` data-rendering component,
**When** the file is committed,
**Then** the file exports at minimum:
- `Default` — the canonical render with realistic data.
- `Loading` — skeleton state (shape-mirroring per UX-DR24, never a centered spinner).
- `Empty` — composes the eventual `EmptyState` (ships in Epic 10 Story 10.3); **for stories authored during Epic 1D (1d-2/1d-3) before EmptyState exists, use an inline placeholder pattern `<EmptyStatePlaceholder />` declared in `1d-1`'s `classlite-web/src/test/fixtures/empty-state-placeholder.tsx` shipped as part of this story.** The placeholder is replaced by the real `EmptyState` import when Epic 10 lands. The placeholder import is allowed by ESLint via a `// eslint-disable-next-line storybook/empty-placeholder` directive that the rule recognizes.
- `Error` — composes the eventual `ErrorState` (ships in Epic 10 Story 10.4); same placeholder pattern as `Empty` until Epic 10 lands.

**And** for role-rendered components, additional exports per UX-DR29:
- `OwnerView`, `AdminView`, `TeacherView`, `StudentView` — each rendered with the corresponding role context.

**And** the convention is enforced by **`@storybook/test-runner`** (chosen over a custom ESLint rule for proximity to story AST and zero risk of stale lint cache):
1. The repo ships `classlite-web/.storybook/test-runner.ts` with a `postRender` hook that introspects each story file's exported names against a `requiredExportsByPattern` map:
   ```ts
   const requiredExportsByPattern = {
     '*Table.stories.tsx': ['Default', 'Loading', 'Empty', 'Error'],
     '*List.stories.tsx': ['Default', 'Loading', 'Empty', 'Error'],
     '*Card.stories.tsx': ['Default', 'Loading', 'Empty', 'Error'],
     '*Hero.stories.tsx': ['Default', 'Loading', 'Empty', 'Error'],
     '*Shell.stories.tsx': ['Default', 'Loading', 'Empty', 'Error'],
   }
   ```
2. **The rule is error-on-merge from day 1 of this story merging — not "warning that escalates later" (per Murat).** A failing test fixture (`fixtures/missing-empty-export.stories.tsx`) lives in the repo and is asserted to FAIL the rule when run; the test for the rule itself uses this fixture and confirms `npm run storybook:test` exits non-zero. Without that fixture and assertion in CI, UX-DR28 has no teeth.
3. Primitives in `ui/` are exempt — they only export `Default` plus the variants relevant to their API (per Story 1d-2). The test-runner skips files matching `src/components/ui/**`.

### AC4: i18n parity CI step + `assertI18nParity` helper (R38 mitigation)

**Given** R38 (Vietnamese key parity, register score 6) — every Epic 1D story introduces new `sidebar.*`, `topbar.*`, `class.detail.tabs.*`, etc. keys,
**When** the i18n parity is verified,
**Then** **both** of the following exist before this story is DONE:

1. **A `classlite-web/src/test/i18n/assertI18nParity.ts` helper** that reads `classlite-web/src/i18n/en.json` and `classlite-web/src/i18n/vi.json`, computes the symmetric difference of their key sets, and throws with a list of orphans if non-empty:
   ```ts
   export function assertI18nParity(): void {
     const en = flattenKeys(require('../../i18n/en.json'))
     const vi = flattenKeys(require('../../i18n/vi.json'))
     const enOnly = en.filter(k => !vi.includes(k))
     const viOnly = vi.filter(k => !en.includes(k))
     if (enOnly.length + viOnly.length > 0) {
       throw new Error(`i18n parity violated. en-only: ${enOnly.join(', ')}; vi-only: ${viOnly.join(', ')}`)
     }
   }
   ```

2. **A CI step `i18n:parity`** in `.github/workflows/ci-web.yml` that runs `assertI18nParity()` standalone (Vitest one-liner test) on every PR touching `classlite-web/`. The step is required to pass before merge.

**And** the failing-fixture assertion exists: a temporary deleted-key test demonstrates the helper throws when `vi.json` is intentionally missing a key (the test commits and reverts a key during execution, and asserts the helper raises with that key in the message). Without the failing fixture, R38 mitigation is unverified.

**And** every Story 1d-2/1d-3/1d-4 dev-pickup checklist references this helper — any new key added in `en.json` MUST be added in `vi.json` in the same PR, and CI enforces it.

_Pinned ATDD red test: `classlite-web/src/test/i18n/assertI18nParity.test.ts::TestAssertI18nParity_RaisesOnViOnlyKey` — the red phase MUST be authored on this branch before AC4 implementation begins (R38 score 6 triggers WF-8 ATDD)._

### AC5: `axe-core` integration via `@storybook/addon-a11y` + `vitest-axe`

**Given** the `@storybook/addon-a11y` addon is installed,
**When** any story renders in the Storybook UI,
**Then** the a11y panel in the Storybook sidebar runs the axe audit automatically and surfaces violations inline.

**Given** the CI pipeline,
**When** the Storybook test-runner runs against built stories,
**Then** `vitest-axe`'s `toHaveNoViolations()` matcher is asserted against each rendered story (per TEST-FE-5):
```ts
test.each(allStories)('story %s has no axe violations', async (storyName) => {
  const { container } = render(<Story />)
  expect(await axe(container)).toHaveNoViolations()
})
```
**And** the CI step fails the build on any violation.

**And** the dev runs the axe test-runner locally via `npm run storybook:test` before opening a PR.

**And** **if AC1 invokes Tier C (defer Storybook entirely),** this axe gate disappears for Epic 1D — every "zero violations" claim in 1d-2/1d-3/1d-4 evaporates. TEA must re-scope the epic's a11y plan in that scenario; document this explicit dependency in `classlite-web/docs/storybook-rolldown-spike.md`.

### AC6: CI integration — all gates required

**Given** the GitHub Actions workflow `ci-web.yml`,
**When** inspecting the build matrix,
**Then** a new job `storybook` runs on every PR touching `classlite-web/` with these steps, ALL required to pass before merge:
1. `npm ci`
2. `npm run i18n:parity` — invokes `assertI18nParity()` (AC4).
3. `npm run storybook:build` — produces a static artifact without errors.
4. `npm run storybook:test` — runs the test-runner against the built Storybook:
   - axe assertions (AC5) — zero violations.
   - Three-state required-exports check (AC3) — zero missing exports.
   - FW-7 placement check (AC7) — zero misplaced story files.
   - Smoke test that every story renders (no crash).

**And** the job has a **soft cap of 8 minutes on PR** (per Winston's CI-delta finding). If runtime exceeds 8 minutes after 100 stories, set up shard-by-pattern (`storybook-test --shard 1/3`, `2/3`, `3/3`) to parallelize. Document the runtime trend in `classlite-web/docs/storybook-conventions.md` so the team monitors PR-throughput erosion.

**And** the built Storybook artifact is uploaded as a GitHub Actions artifact for download / preview deployment. Preview deployment to Cloudflare Pages is deferred to a follow-up improvement story.

### AC7: FW-7 component placement & story co-location — enforced by `@storybook/test-runner`

**Given** the FW-7 component-placement rule,
**When** any new story file is created,
**Then** the file lives co-located with its component:
- `src/components/ui/Button.tsx` + `src/components/ui/Button.stories.tsx`
- `src/components/domain/SidebarShell.tsx` + `src/components/domain/SidebarShell.stories.tsx`
- `src/features/<area>/components/<Component>.tsx` + `src/features/<area>/components/<Component>.stories.tsx`

**And** the same `@storybook/test-runner` config used by AC3 enforces placement: a `prerender` hook reads the story's file path and rejects any `*.stories.tsx` file not under `src/components/ui/`, `src/components/domain/`, or `src/features/*/components/`. Error-on-merge from day 1.

**And** the story file's component import is always a relative sibling import (`import { Button } from './Button'`) — never a barrel import (`import { Button } from '@/components/ui'`) — so the story documents the component's exact module surface.

### AC8: Conventions doc — `classlite-web/docs/storybook-conventions.md`

**Given** the Storybook foundation is operational and AC2–AC7 are discharged,
**When** the conventions doc is committed,
**Then** it covers (10 sections, up from the original 8):

1. **Three-tier compatibility ladder** — what Tier A/B/C mean, which tier this repo is currently on, and the spike doc reference.
2. **Story file naming** — `*.stories.tsx`, co-located with component (FW-7 tiers).
3. **Required exports per component pattern** — three-state + role-variant rules from AC3, with copyable template for each pattern (table, list, card, hero, shell, modal, form, layout).
4. **Decorator usage** — the six-item stack (Query, i18n, Router, MSW, Role, Preview-side deps) and override patterns via `parameters`.
5. **Locale and role switching** — toolbar controls; writing stories that assert both `en` and `vi` render correctly.
6. **MSW handler patterns** — fixture location (`classlite-web/src/test/fixtures/`), per-story handler declaration, **how `Empty` stories are driven by empty-data MSW responses (NOT mocked hooks)**, fault-injection variants for error stories.
7. **Three-state authoring template** — copy-paste template for new component stories with TODO markers for required exports, including the `EmptyStatePlaceholder` pattern for pre-Epic-10 stories.
8. **i18n parity** — using `assertI18nParity()`, how to add a new key (both files, same PR), how the CI step protects R38.
9. **`axe-core` baseline** — when the audit runs (preview + CI), interpreting violations, escalation path for violations needing design changes.
10. **Designer access** — designer reviews via downloadable Storybook artifact from GitHub Actions; preview deploy is a follow-up improvement.

**And** the doc is linked from `classlite-web/README.md` so it's discoverable.

### AC9: Smoke story validates the full chain

**Given** the foundation is complete,
**When** a smoke story (`Button.stories.tsx` for the shadcn `Button` primitive, installed as part of this story) is added end-to-end,
**Then**:
- The story renders correctly in Storybook UI with locale `en` and `vi` switchable (Vietnamese text renders with Geist body font, no font fallback flash).
- The story renders correctly with role switched to each of `owner`, `admin`, `teacher`, `student` (no breakage even though `Button` is role-agnostic).
- The axe audit passes with zero violations.
- The `i18n:parity` CI step passes (Button uses an i18n key for its label and both `en.json` + `vi.json` carry it).
- The three-state lint rule's negative fixture (missing `Empty` export) is asserted to FAIL — proving the rule has teeth.
- The FW-7 placement check passes (file is under `src/components/ui/`).
- The Storybook job in `ci-web.yml` passes green end-to-end within the 8-minute soft cap.
- The smoke story + the negative fixtures are the canonical references the next dev consults when starting Story 1d-2.

**And** the smoke story is deliberately a single trivial primitive — comprehensive coverage of all 32 primitives is Story 1d-2's scope.

## Tasks / Subtasks

- [ ] **Pre-task (Murat gate):** Confirm `/bmad-tea TD` has been re-run for Epic 1D and the refreshed `test-design-architecture.md` + `test-design-qa.md` show R38 mapped to AC4 of this story. Without this, do not start.
- [ ] **Task 1 (AC1):** Run the three-tier compatibility ladder (2 working days total, 1 day per tier max). Document outcome in `classlite-web/docs/storybook-rolldown-spike.md`.
  - [ ] Tier A: `npx storybook@latest init --type react --builder vite`, run 5 checks.
  - [ ] Tier B (if A fails): configure `@storybook/react-vite` with a separate non-Rolldown builder config, re-run 5 checks.
  - [ ] Tier C (if B fails): get explicit PM + user approval; do NOT invoke silently.
- [ ] **Task 2 (AC2):** Author `.storybook/preview.tsx` with the six-layer stack (5 decorators + preview-side deps). Add locale and role globalTypes. Verify Tailwind, `tokens.css`, font preload, `Suspense`, and `date-fns/locale/vi` all resolve in render. Commit a screenshot of the toolbar to the conventions doc.
- [ ] **Task 3 (AC3):** Author `classlite-web/.storybook/test-runner.ts` with the three-state required-exports check. Author negative fixture `fixtures/missing-empty-export.stories.tsx` and assert it fails CI. Author `EmptyStatePlaceholder` and `ErrorStatePlaceholder` components in `classlite-web/src/test/fixtures/` for use until Epic 10 ships the real ones.
- [ ] **Task 4 (AC4):** Author `assertI18nParity()` helper, add CI step `i18n:parity`. Author ATDD red test `assertI18nParity.test.ts` BEFORE implementation. Wire into `ci-web.yml` as a required check.
- [ ] **Task 5 (AC5):** Install `@storybook/addon-a11y` + `vitest-axe`. Wire test-runner integration. Verify on the smoke story.
- [ ] **Task 6 (AC6):** Add `storybook` job to `.github/workflows/ci-web.yml` with all four gates required. Soft cap 8 minutes; document sharding plan.
- [ ] **Task 7 (AC7):** Add FW-7 placement check to the test-runner config (prerender hook). Reject misplaced files.
- [ ] **Task 8 (AC8):** Write `classlite-web/docs/storybook-conventions.md` covering all 10 sections. Link from `README.md`.
- [ ] **Task 9 (AC9):** Add `Button.stories.tsx` smoke story. Verify all six gates pass green end-to-end.

## Dev Notes

- **Stack reminders:**
  - React 19 — no `forwardRef`, refs are plain props, no `"use client"`.
  - Vite 8 (Rolldown) — three-tier ladder protects against plugin incompat; do not assume Rolldown is fine without running Tier A.
  - TypeScript strict — no `any`, no `// @ts-ignore`.
  - shadcn/ui — primitives in `src/components/ui/`, never hand-edited.
  - Tailwind utility classes only, no inline `style={{}}`.
  - TanStack Query owns server state; default `staleTime: 30_000` (per FW-3), never `0` without justification.

- **One mock seam per side:** Frontend mocks at the HTTP boundary via MSW. **NEVER mock `useQuery`/`useMutation` in stories or tests.** `Empty` stories are driven by MSW returning empty arrays/objects; the consumer's component handles the empty branch. This convention exists in 1d-1 — Story 1d-2/1d-3/1d-4 carry it via `storybook-conventions.md` reference.

- **i18n is co-primary** (UX-2 + NFR-1 + R38 score 6): every story renders correctly in both `en` and `vi`. Don't hardcode English strings; use `t()` even for placeholder copy. AC4's `assertI18nParity` is the gate.

- **Role-based rendering uses separate components, not conditional branches** (UX-3): the role decorator switches the `useRole()` return value; components that branch internally on role should be refactored to a `RoleGate` wrapper or to separate components — flag any during foundation work for Story 1d-3 to address.

- **WF-3 codegen note:** This story does not touch `api.yaml` or `.sql` files. `codegen.sh` does NOT need to run.

- **WF-7 service boundary:** Storybook imports stay within `classlite-web/` — never reach into `../../classlite-api/`. Mock API response shapes via MSW with fixtures matching the OpenAPI types in `src/generated/`.

- **Tier B implications:** If Tier B is invoked, the repo carries a dual-builder dev-dep footprint (Rolldown for app, standard Vite/esbuild for Storybook). Document this in the spike doc so future maintainers don't try to unify the configs and break Storybook.

- **Pre-Epic-10 placeholder pattern:** `EmptyState` and `ErrorState` defer to Epic 10. During Epic 1D, stories consume `EmptyStatePlaceholder` and `ErrorStatePlaceholder` shipped in this story. When Epic 10 lands, a global find-replace migrates the imports. Document this migration plan in `storybook-conventions.md` § 7.

## Definition of Done

- [ ] Murat's `/bmad-tea TD` gate passed (refreshed test-design artifacts show R38 mapped to AC4).
- [ ] All 9 ACs discharged at Tier A or Tier B (Tier C requires explicit re-scope approval).
- [ ] `classlite-web/docs/storybook-conventions.md` exists with all 10 sections and is linked from `README.md`.
- [ ] `classlite-web/docs/storybook-rolldown-spike.md` documents the tier outcome.
- [ ] CI `storybook` job is green on the PR within the 8-minute soft cap.
- [ ] One smoke story (`Button.stories.tsx`) passes all six gates (locale, role, axe, i18n-parity, three-state lint, FW-7 placement).
- [ ] Three-state lint negative fixture (`missing-empty-export.stories.tsx`) is asserted to FAIL CI — proving the rule has teeth.
- [ ] `assertI18nParity()` ATDD red test was authored BEFORE implementation; final test passes green.
- [ ] Conventions doc reviewed by at least one other frontend dev before merge.
- [ ] If Tier C was invoked, follow-up story `1d-Z` is opened in the backlog with the documented failure mode AND PM + user re-scope approval is recorded.

## Out of Scope

- Comprehensive shadcn primitive coverage — Story 1d-2.
- Domain component buildout — Stories 1d-3 (app-shell) and 1d-4 (Phase 4 visual bridge).
- Cloudflare Pages preview deploy for Storybook — follow-up improvement story.
- Visual regression testing (Chromatic, Percy, etc.) — not in MVP scope; revisit post-Epic 1D.
- Component-level performance benchmarks — not in MVP scope.
- Real `EmptyState` / `ErrorState` implementations — ship in Epic 10 Stories 10.3/10.4; Epic 1D uses placeholder pattern.
- Calendar library decision (`SessionScheduleCalendar`) — deferred to Epic 3 Story 3.4 with widened 2-day spike, RRULE-fit dimension, and axe baseline test (per Winston + Murat).

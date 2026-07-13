---
storyId: 2.3c
storyKey: 2-3c-onboarding-ui-completion-and-resume
storyFile: _bmad-output/implementation-artifacts/2-3c-onboarding-ui-completion-and-resume.md
atddChecklistPath: _bmad-output/test-artifacts/atdd-checklist-2-3c-onboarding-ui-completion-and-resume.md
inputDocuments:
  - _bmad-output/implementation-artifacts/2-3c-onboarding-ui-completion-and-resume.md
  - _bmad-output/implementation-artifacts/2-3b-onboarding-ui-template-selection-and-class-spawning.md
  - _bmad-output/implementation-artifacts/2-3a-onboarding-ui-persona-selection-and-center-setup.md
  - _bmad-output/planning-artifacts/epics/epic-02.md
  - classlite-web/src/features/onboarding/OnboardingLayout.tsx
  - classlite-web/src/features/onboarding/CenterSetupPage.tsx
  - classlite-web/src/features/onboarding/api/__tests__/handlers.ts
  - classlite-web/src/features/auth/api/authKeys.ts
  - classlite-web/src/hooks/useAuth.ts
  - classlite-web/src/lib/onboardingPayload.ts
  - classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts
  - classlite-web/vitest.config.ts
  - classlite-web/playwright.config.ts
  - docs/project-context.md
generatedTestFiles:
  - classlite-web/src/features/onboarding/__tests__/OnboardingDonePage.test.tsx  # NEW — Task 2.4 (18-test guard matrix + 6-row stat filter + retry + axe + focus-on-mount + Task 1.5 idempotence)
  - classlite-web/src/features/onboarding/components/__tests__/DoneHeroPanel.test.tsx  # NEW — Task 2.2 pure display contract
  - classlite-web/src/features/onboarding/api/__tests__/handlers.ts  # EXTENDED — putProgressInternalError + putProgressRateLimited variants
  - classlite-web/src/features/onboarding/__tests__/TemplateSelectPage.test.tsx  # EXTENDED — Task 3.4 Save-and-finish-later 3 sub-tests
  - classlite-web/src/features/onboarding/__tests__/ClassSpawnPage.test.tsx  # EXTENDED — Task 3.4 3 sub-tests + buildFromScratch variant + /dashboard placeholder
  - classlite-web/src/features/onboarding/__tests__/SoloFirstClassPage.test.tsx  # EXTENDED — Task 3.4 3 sub-tests + /dashboard placeholder
  - classlite-web/src/features/onboarding/__tests__/OnboardingLayout.test.tsx  # EXTENDED — Task 1.4 (5 new tests covering stepFromPathname + POST_CENTER_WIZARD_PATHS + AutoSaveIndicator hide/show/no-flash)
  - classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts  # EXTENDED — Task 6.2 STORY_2_3C_KEYS (13 keys) + prefix-ratchet + 3-token interpolation parity
  - classlite-web/e2e/route-bundle-boundaries.spec.ts  # EXTENDED — Task 4.2 /setup/done chunk isolation
  - classlite-web/e2e/onboarding-template-spawn.spec.ts  # EXTENDED — Task 7.4 6 named tests (3 personas × 2 locales) + Task 7.5 3 idempotence tests
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-07-12'
---

# ATDD Checklist — Story 2.3c (Onboarding UI: Completion & Resume)

## Executive summary

- **Mode**: Sequential (in-process). Explicit dispatch to `bmad-testarch-atdd` via `/bmad-tea AT 2-3c`. `tea_execution_mode: auto` resolved to `sequential` in-process rather than subagent because the story surface is small, the story spec enumerates every test, and the parent context already had every anchor file loaded — subagent dispatch would burn tokens re-loading identical context.
- **Stack**: `fullstack` (React 19 + Go). Story is FE-only; every red-phase artifact lands under `classlite-web/`.
- **Framework**: Vitest (jsdom, MSW-based) + Playwright + `vitest-axe`. Global MSW lifecycle at `src/test/vitest-setup.ts`; per-file `beforeEach(server.use(...onboardingHandlers))` re-seats happy handlers (2-3b D4 lesson).
- **Risk score ≥6 owned**: NONE. Epic 2 R1 (score 9) discharged at Stories 2.1+2.2 backend; R18 (bulk CSV, score 6) is Story 2.7's; R38 (i18n parity, score 6) inherited via existing CI gate + new `STORY_2_3C_KEYS` prefix-ratchet block.
- **WF-8 posture**: RECOMMENDED but SKIPPABLE (per story spec Task 0.1). This run executed the RECOMMENDED path — Amelia inherits every enumerated test scaffold instead of discovering them at green-phase.
- **Red signal verified**:
  - `tsc --noEmit -p tsconfig.app.json` reports exactly **2 TS2307** undefined-module errors:
    - `OnboardingDonePage.test.tsx(43,32): Cannot find module '@/features/onboarding/OnboardingDonePage'`
    - `DoneHeroPanel.test.tsx(22,27): Cannot find module '@/features/onboarding/components/DoneHeroPanel'`
  - `tsc --noEmit -p tsconfig.e2e.json` clean (Playwright red signal is at runtime — `/setup/done` renders NotFound, `<h1>` not present, etc.).
  - Extended shipped test files (i18n parity, page-level Save-and-finish-later, OnboardingLayout Task 1.4) will red-signal at `npm run test` runtime — assertions target features that don't yet exist (missing i18n keys, missing button, missing pathname mapping).

## Test strategy — AC → level → priority

| AC | Coverage | Level | Priority | Red-phase file |
|---|---|---|---|---|
| AC1 | `/setup/done` renders with DoneHeroPanel + stat strip + CTA | Component (Vitest+RTL) | P0 | `OnboardingDonePage.test.tsx` + `DoneHeroPanel.test.tsx` |
| AC2 | 6-branch guard ladder + spawnedClassIds visible fail | Component (Vitest+RTL) | P0 | `OnboardingDonePage.test.tsx` §AC2 (18 tests) |
| AC3 | Per-persona subtitle (3 branches) + VN copy | Component (Vitest+RTL) | P1 | `OnboardingDonePage.test.tsx` §AC3 + `DoneHeroPanel.test.tsx` |
| AC4 | Save-and-finish-later on 3 shipped pages | Component (Vitest+RTL) | P0 | 3 shipped page test extensions (9 tests) |
| AC5 | AutoSaveIndicator hidden on `/setup/done` | Component (Vitest+RTL) | P1 | `OnboardingLayout.test.tsx` §Task 1.4c/d/e |
| AC6 | `stepFromPathname('/setup/done') === 'done'` + idempotence | Unit + integration | P1 | `OnboardingLayout.test.tsx` §Task 1.4a + `OnboardingDonePage.test.tsx` §Task 1.5 |
| AC7 | Shipped resume routes preserved (no changes) | Playwright (integration) | P2 | `onboarding-template-spawn.spec.ts` §Task 7.5 re-entry idempotence |
| AC8 | `/setup/done` chunk isolation | Playwright (build audit) | P1 | `route-bundle-boundaries.spec.ts` §Story 2-3c |
| AC9 | Three-state (loading / success / error) + retry semantics | Component (Vitest+RTL) | P0 | `OnboardingDonePage.test.tsx` §AC9 |
| AC10 | i18n parity STORY_2_3C_KEYS + prefix-ratchet + 3-token parity | Unit (i18n-parity) | P0 | `i18n-parity-coverage.test.ts` §Story 2-3c |
| AC11 | axe zero-violations + focus-on-mount + persona×locale | Component (Vitest+RTL) | P0 | `OnboardingDonePage.test.tsx` §AC11 (6 axe renders + focus + no role="status" belt) |

## Generated test files — inventory

### NEW files

1. **`classlite-web/src/features/onboarding/__tests__/OnboardingDonePage.test.tsx`**
   - AC1/AC2/AC3/AC9/AC11 + Task 1.5 idempotence
   - **18 named guard-ladder tests** (M-B2 + M-I4): 2 early-exit + 12 currentStep dispatch (3 personas × 4 non-done steps) + 2 spawnedClassIds visible-fail (empty + undefined) + 1 stay + 1 error-no-route
   - **6-row stat-filter negative matrix** (M-S1): case-mismatch, trim-mismatch, null classesDraft, empty array, Founder self-injection, undefined teacherEmail — plus a 7th defensive null-user test (W-S3 fallback)
   - **3-attempt persistent-failure ratchet** (M-B3): retry-success, retry-fail, escalate after 3 failures
   - **6 axe renders** (M-S2): 3 personas × 2 locales
   - **Focus-on-mount + no role="status"** (S-B2)
   - **Vietnamese overflow discipline** (S-S1): `<h1>` `min-w-0 break-words` + responsive step-down classes
   - **Refetch race** (M-I2): mount-once ref latches on first non-loading render
   - **Guard-order pins** (M-I1): 2 specific interaction cases
   - **Task 1.5 idempotence** (M-S6): mounting `/setup/done` fires 0 PUT calls

2. **`classlite-web/src/features/onboarding/components/__tests__/DoneHeroPanel.test.tsx`**
   - Pure display contract per Task 2.2
   - Headline in `<h1>` with `tabIndex=-1`; SVG `aria-hidden`; `<dl>` semantic markup with 3 `<dt>/<dd>` pairs
   - Per-tile aria-labels (S-I1); shortCode composed via JS template literal (not i18next)
   - Primary CTA is `<button type="button">` (not `<a>`); persona-branch subtitle (3 cases)
   - VN overflow discipline (S-S1); base axe render

### EXTENDED files

3. **`classlite-web/src/features/onboarding/api/__tests__/handlers.ts`**
   - Added `errorHandlers.putProgressInternalError()` (500) and `errorHandlers.putProgressRateLimited(retryAfterSeconds=12)` (429 with Retry-After) — used by the 9 Save-and-finish-later contract tests.

4. **`classlite-web/src/features/onboarding/__tests__/TemplateSelectPage.test.tsx`**
   - New `describe('Story 2-3c AC4 — Save-and-finish-later contract (Murat-S3)')` block with 3 sub-tests (2xx / 500 / 429 — all navigate).

5. **`classlite-web/src/features/onboarding/__tests__/ClassSpawnPage.test.tsx`**
   - `/dashboard` placeholder route added to the shipped render helper's `Routes` block (Task 3.4a).
   - New describe block with 3 sub-tests (2xx / 500 / 429) + 1 buildFromScratch variant test (A-B1 placement).

6. **`classlite-web/src/features/onboarding/__tests__/SoloFirstClassPage.test.tsx`**
   - `/dashboard` placeholder route added (Task 3.4a).
   - New describe block with 3 sub-tests (2xx / 500 / 429).

7. **`classlite-web/src/features/onboarding/__tests__/OnboardingLayout.test.tsx`**
   - New `describe('Story 2-3c Task 1.4 — /setup/done route extension')` block with 5 tests:
     - (1.4a) `/setup/done` mounts without bouncing to `/dashboard`
     - (1.4b) `session.center != null` + `/setup/done` → no bounce
     - (1.4c) AutoSaveIndicator ABSENT on `/setup/done`
     - (1.4d) AutoSaveIndicator PRESENT on `/setup/spawn` (inverse, M-S5)
     - (1.4e) No-flash across spawn→done transition (W-S1)

8. **`classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts`**
   - New `STORY_2_3C_KEYS` closed enumeration (13 keys, all under `onboarding.done.*`) + `describe('Story 2-3c i18n parity (R38)')` block: parity assertion + interpolation parity across 3 tokens (`{{centerName}}`, `{{count}}`, `{{requestId}}`) + single-prefix ratchet `['onboarding.done.']` (A-I3 tightening).

9. **`classlite-web/e2e/route-bundle-boundaries.spec.ts`**
   - New `test('Story 2-3c — /setup/done chunk isolated from login+dashboard AND from spawn+first-class (Task 4.2)')` inside the existing `Route bundle boundaries` describe — asserts `OnboardingDonePage-*.js` chunk exists, is absent from login/student/teacher chunks, and does NOT statically import ClassSpawnPage or SoloFirstClassPage chunks. Deep-import discipline enforced via chunk content assertions.

10. **`classlite-web/e2e/onboarding-template-spawn.spec.ts`**
    - New `describe('Story 2-3c Task 7.4 — /setup/done celebration')` with **6 named tests** (3 personas × 2 locales via nested for-loops). Each asserts: (a) `<h1>` contains interpolated centerName in locale-appropriate copy; (b) stat strip renders locale-appropriate text; (c) `<h1>` receives focus on mount (`document.activeElement.tagName === 'H1'`); (d) Open Dashboard CTA navigates.
    - New `describe('Story 2-3c Task 7.5 — currentStep === "done" re-entry idempotence')` with 3 tests: (i) `/dashboard` shows no welcome-back banner after CTA click; (ii) manual re-nav to `/setup/done` re-renders idempotently with same heading; (iii) `/welcome` re-entry when `currentStep === 'done'` routes to `/dashboard` per shipped PersonaSelectPage:72 (uses `@ts-expect-error` on an intentionally-not-yet-shipped `initialProgressStep` stub option — Task 7.5 green-phase item).

## Red-signal verification

**tsc app config**:
```
$ npx tsc --noEmit -p tsconfig.app.json
src/features/onboarding/__tests__/OnboardingDonePage.test.tsx(43,32): error TS2307: Cannot find module '@/features/onboarding/OnboardingDonePage' or its corresponding type declarations.
src/features/onboarding/components/__tests__/DoneHeroPanel.test.tsx(22,27): error TS2307: Cannot find module '@/features/onboarding/components/DoneHeroPanel' or its corresponding type declarations.
```

**tsc e2e config**: clean (Playwright test file compiles; runtime red signal on missing route + missing button + missing i18n keys).

**Expected runtime red signals** (in addition to the above compile errors):
- `OnboardingLayout.test.tsx` Task 1.4 block will fail: `stepFromPathname('/setup/done')` returns undefined (not `'done'`), `POST_CENTER_WIZARD_PATHS` doesn't include `/setup/done`, `location.pathname !== '/setup/done'` guard not added → all 5 tests fail.
- Save-and-finish-later tests (9 total across 3 pages) will fail: the button doesn't exist on TemplateSelectPage/ClassSpawnPage/SoloFirstClassPage yet.
- i18n parity `Story 2-3c` describe block fails: 13 keys under `onboarding.done.*` don't exist in en.json / vi.json.
- Playwright Task 7.4 tests will fail: `/setup/done` renders NotFound, `<h1>` missing.
- Playwright Task 7.5 tests will fail: `dashboard-finish-setup-banner` visibility check + manual re-nav to `/setup/done` + `initialProgressStep` stub option.
- `route-bundle-boundaries.spec.ts` new test will fail: `OnboardingDonePage-*.js` chunk missing from dist/.

## Green-phase task order (recommended for Amelia)

The AC surface is small — a naive AC-order pass works. Suggested batch order to minimize compile-fail cycles:

1. **Task 6.1** — Add all 13 `onboarding.done.*` i18n keys to `en.json` + `vi.json`. (Fastest feedback: i18n parity `describe` block goes green immediately.)
2. **Task 1.1/1.2/1.3** — extend `OnboardingLayout.tsx` (stepFromPathname + POST_CENTER_WIZARD_PATHS + AutoSaveIndicator guard). OnboardingLayout.test.tsx Task 1.4 block goes green.
3. **Task 2.2** — write `DoneHeroPanel.tsx`. `DoneHeroPanel.test.tsx` compiles + goes green.
4. **Task 2.1** — write `OnboardingDonePage.tsx` (page + skeleton + Alert + guard ladder). `OnboardingDonePage.test.tsx` compiles + Task 2.4 tests go green.
5. **Task 3.1/3.2/3.3** — add Save-and-finish-later button to 3 shipped pages. 9 flush-navigate tests go green.
6. **Task 4.1** — wire `/setup/done` route in `routes.tsx`. Route bundle boundary + Playwright tests can then progress.
7. **Task 5.1** — barrel export `OnboardingDonePage` (only if needed for downstream imports; DoneHeroPanel stays feature-local).
8. **Task 7.4** — extend Playwright happy-path with 6 named tests; extend `stubOnboardingBackend` with `initialProgressStep` overload for Task 7.5.
9. **Task 7.5** — integration re-entry idempotence assertions (2 in-spec + 1 requires `initialProgressStep` stub extension).
10. **Task 4.2** — `route-bundle-boundaries.spec.ts` extension goes green once `OnboardingDonePage-*.js` chunk lands.
11. **Task 7.1/7.2/7.3** — full `npm run test` + `npm run lint` + `tsc --noEmit -p tsconfig.app.json` clean.

## Explicit gaps documented

- **Task 7.5 (3rd sub-test)** — the "initialProgressStep" option on `stubOnboardingBackend` doesn't exist yet. The red-phase spec uses `@ts-expect-error` at line 599 to mark the expected extension point. Green-phase Amelia must (a) extend the stub helper with the option, then (b) remove the `@ts-expect-error` annotation. Failure to do (b) reintroduces the ts-expect-error into the green suite as a warning.
- **DASHBOARD_PLACEHOLDER route** — added to `ClassSpawnPage.test.tsx` and `SoloFirstClassPage.test.tsx` render helpers (per Task 3.4a). `TemplateSelectPage.test.tsx` already had it. Amelia can leave these placeholders in place (they're inert MemoryRouter stubs).

## Definition-of-Done deltas (vs story spec)

- ✅ Task 0.1 executed (this run).
- ✅ Red-phase scaffolds landed for all 5 story-referenced ACs (#1/#2/#4/#9/#10/#11) + Task 1.5.
- ⏳ Green-phase implementation (Amelia's next pass).

## Hand-off

`/bmad-dev-story 2-3c` — Amelia consumes this checklist + the enumerated red-phase specimens and lands green-phase in the task order above.

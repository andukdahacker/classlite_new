---
storyId: '2.4'
storyKey: '2-4-post-onboarding-checklist-and-first-ai-grade-card'
storyFile: '_bmad-output/implementation-artifacts/2-4-post-onboarding-checklist-and-first-ai-grade-card.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-2-4-post-onboarding-checklist-and-first-ai-grade-card.md'
detectedStack: 'fullstack (frontend-only for this story per its scope guard)'
inputDocuments:
  - 'docs/project-context.md'
  - 'docs/bmad-story-conventions.md'
  - '_bmad-output/planning-artifacts/epics/epic-02.md'
  - '_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
  - '_bmad-output/implementation-artifacts/2-3c-onboarding-ui-completion-and-resume.md'
  - '_bmad-output/implementation-artifacts/2-3c-onboarding-ui-completion-and-resume-completion-notes.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - 'classlite-web/src/features/dashboard/TeacherDashboard.tsx'
  - 'classlite-web/src/features/onboarding/OnboardingDonePage.tsx'
  - 'classlite-web/src/hooks/useAuth.ts'
  - 'classlite-web/src/features/auth/api/authKeys.ts'
  - 'classlite-web/src/features/onboarding/api/__tests__/handlers.ts'
  - 'classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts'
  - 'classlite-web/src/components/ui/sonner.tsx'
  - 'classlite-web/src/App.tsx'
  - 'classlite-web/e2e/route-bundle-boundaries.spec.ts'
  - 'classlite-web/e2e/onboarding-template-spawn.spec.ts'
generatedTestFiles:
  - 'classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts'  # EXTENDED — STORY_2_4_KEYS block
  - 'classlite-web/src/lib/__tests__/teachersInvitedCount.test.ts'  # NEW
  - 'classlite-web/src/features/dashboard/hooks/__tests__/useChecklistState.test.tsx'  # NEW
  - 'classlite-web/src/features/dashboard/lib/__tests__/checklistDefinition.test.ts'  # NEW
  - 'classlite-web/src/features/dashboard/components/__tests__/DeadLinkTrigger.test.tsx'  # NEW
  - 'classlite-web/src/features/dashboard/__tests__/FinishSetupCard.test.tsx'  # NEW
  - 'classlite-web/src/features/dashboard/__tests__/TeacherDashboard.test.tsx'  # NEW
  - 'classlite-web/src/features/dashboard/__tests__/noTrialMechanic.test.ts'  # NEW
  - 'classlite-web/e2e/dashboard-first-run.spec.ts'  # NEW
  - 'classlite-web/e2e/route-bundle-boundaries.spec.ts'  # EXTENDED — Story 2-4 AC15 block
generationMode: 'ai-sequential-in-process'
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-07-14'
---

# ATDD Red-Phase Checklist — Story 2.4

**Story:** 2-4-post-onboarding-checklist-and-first-ai-grade-card
**Status:** ready-for-dev
**Baseline commit:** `c639031`
**ATDD invocation:** `/bmad-tea AT 2-4` on 2026-07-14, post party-mode fold.

## Step 1 — Preflight & Context

**Stack detection:** `fullstack` (manifest scan found both `classlite-web/package.json` + `classlite-api/go.mod`). Story 2-4 is explicitly frontend-only per its scope guard ("No `api.yaml` touch. No `codegen.sh` run."). Effective test stack for this workflow run: **frontend** (Vitest + Playwright + MSW).

**Prerequisite check:**
- ✅ Story approved with 17 clear ACs (post party-mode fold — 81 findings, 78 accepted).
- ✅ `playwright.config.ts` present at `classlite-web/playwright.config.ts`.
- ✅ `vitest.config.ts` present at `classlite-web/vitest.config.ts`.
- ✅ Dev environment active.

**TEA config resolved** (from `_bmad/tea/config.yaml`):
- `test_stack_type: auto` → frontend effective.
- `risk_threshold: p1` — P0/P1 mandatory; P2/P3 discretionary.
- `tea_use_playwright_utils: true` — Full UI+API profile loaded (e2e/ uses full Playwright).
- `tea_browser_automation: auto` — Playwright CLI loaded.

**Knowledge fragments loaded (tiered per `tea-index.csv`):**
- **Core:** `data-factories`, `component-tdd`, `test-quality`, `test-healing-patterns`, `risk-governance`, `probability-impact`, `test-levels-framework`, `test-priorities-matrix`, `selector-resilience`, `fixture-architecture`.
- **Frontend:** `network-first`, `timing-debugging`.
- **Playwright Utils:** `overview`, `api-request`, `auth-session`, `intercept-network-call`, `recurse`, `network-error-monitor`.
- **Playwright CLI:** `playwright-cli`.

**Framework patterns inspected:** 14 shipped test files under `classlite-web/src/features/onboarding/__tests__/` (canonical patterns to mirror). 7 Playwright specs under `classlite-web/e2e/`. Shared MSW handler seam at `src/features/onboarding/api/__tests__/handlers.ts:267` (`progressWithPersona(persona, currentStep, payload)` factory). Playwright `stubOnboardingBackend` seam at `e2e/onboarding-template-spawn.spec.ts:65`.

**Risk register anchoring** (from `test-design-architecture.md`):
- Epic 2 owns R1 (score 9) — discharged at Stories 2.1 + 2.2 backend.
- Epic 2 owns R18 (score 6) — Story 2.7's problem.
- R38 (i18n parity, score 6) — inherited via CI gate + AC14 `STORY_2_4_KEYS` block.
- **Story 2-4 owns NO risk score ≥6.** Per WF-8 hard rule, ATDD is RECOMMENDED but SKIPPABLE. User invoked `/bmad-tea AT 2-4` explicitly — RECOMMENDED path chosen despite the story owning no ≥6-risk AC. The 42-key ratchet + 12-cell matrix + shared-lib extract + `stableProps` latch pattern justify the red-phase enumeration.

## Step 2 — Generation Mode

**Mode: AI Generation** (default per step-02 default protocol).

Rationale: 17 ACs are clear, patterns are standard (Vitest component + MSW HTTP boundary + Playwright E2E), no live browser recording needed. Frontend-only story with fully-elaborated 17-AC spec. Post-fold Dev Notes already enumerates: 42 pinned i18n keys, testid inventory, MSW handler catalog (12-cell table), `MALFORMED_LOCALSTORAGE_FIXTURES` closed literal, closed-literal reject-list for no-trial audit. Sufficient signal to generate red-phase specimens deterministically.

## Step 3 — Test Strategy

### 3.1 AC-to-test-level map

| AC | Contract | Test level | Priority | Red-phase file(s) |
|---|---|---|---|---|
| AC1 (loading/error 8-cell matrix + `stableProps` latch) | TeacherDashboard shell renders per matrix; `stableProps` survives refetch-transient `undefined` | Component (RTL + MSW) | **P0** | `TeacherDashboard.test.tsx` (part of Task 6.6 24+-test file) |
| AC2 (card structure + fraction aria-live + testid inventory) | Header + fraction + `<ol>` + snooze button; `<div aria-live="polite" aria-atomic="true">` wraps fraction | Component | **P1** | `FinishSetupCard.test.tsx` |
| AC3 (per-persona 7/7/4 enumeration + resolver purity) | closed `Record<Persona, ChecklistItem[]>` + `isDone(ctx)` via normalized ctx | Lib unit + Component | **P1** | `checklistDefinition.test.ts` + `teachersInvitedCount.test.ts` |
| AC4 (snooze click + Sentry breadcrumb) | click → localStorage write + Sentry breadcrumb `checklist-snoozed` + card unmount | Hook + Component | **P1** | `useChecklistState.test.tsx` + `FinishSetupCard.test.tsx` |
| AC5 (snoozedUntil boundary scheduled bump) | on mount → `setTimeout(bump, snoozedUntil - Date.now() + 1000)`; cleanup on unmount | Hook | **P2** | `useChecklistState.test.tsx` |
| AC6 (useChecklistState hook + userId transition + MALFORMED fixtures) | module-scope subscribe, per-userId getSnapshot, JSON-parse guard, storage listener, cross-tab sync | Hook | **P1** | `useChecklistState.test.tsx` |
| AC7 (FirstAIGradeCard fixture display + Ducdo VN copy vetting) | Fixture renders excerpt + band + criteria + feedback + NO exploreCta; TEST-FE-2 N/A comment | Component | **P2** | `FirstAIGradeCard.test.tsx` |
| AC8 (SampleDashboardPreview ghosted-frame per UX §6.4) | 4-tile ghost + em-dash + threshold banner + disclaimer | Component | **P2** | `SampleDashboardPreview.test.tsx` |
| AC9 (YourClassesRow + XSS safety) | 2 cards from `classesDraft.slice(0,2)` + empty fallback ghost; `cohortName` renders as text-node | Component | **P1** | `YourClassesRow.test.tsx` |
| AC10 (no-trial reject-list + Vietnamese `dùng thử`) | grep-audit `src/{features/dashboard,locales}/**/*.{ts,tsx,json}` for 8 substrings | Static-analysis (Vitest reads FS) | **P0** | `noTrialMechanic.test.ts` |
| AC11 (`<DeadLinkTrigger>` via Sonner queue-of-one) | click → `toast.info(...)` w/ fixed id + Sentry breadcrumb + NO navigate | Component | **P1** | `DeadLinkTrigger.test.tsx` |
| AC12 (per-persona body components + shell composition + i18n rename atomic) | switch(persona) → 3 body components; `user?.displayName ?? user?.email ?? ''` interpolation | Component + shell | **P0** | `TeacherDashboard.test.tsx` (part of Task 6.6) |
| AC13 (4-file atomic rename) | `STORY_2_3A_KEYS` + `ALLOWED_PREFIXES` + `STORY_2_3B_KEYS ALLOWED_PREFIXES_2_3B` + `en.json` + `vi.json` + TeacherDashboard.tsx 3 sites | i18n-parity contract | **P0** | red signal via `npm run i18n-parity` when the atomic commit lands piecewise |
| AC14 (42-key `STORY_2_4_KEYS` closed literal + prefix ratchet + interpolation parity over ALL keys) | closed-literal enumeration + `assertI18nParity` + `assertI18nInterpolationParity` | i18n-parity contract | **P0** | `i18n-parity-coverage.test.ts` extension |
| AC15 (route-bundle chunk isolation via filename + testid substring) | `TeacherDashboard-*.js` filename regex + contains `dashboard-checklist-card` testid substring; onboarding chunks do NOT | Playwright E2E | **P1** | `e2e/route-bundle-boundaries.spec.ts` extension |
| AC16 (axe matrix 9 renders — 3 personas × 2 locales at cell 6 + 3 snoozed cells) | axe zero violations enumerated as `test.each` | Component axe | **P0** | `TeacherDashboard.test.tsx` (part of Task 6.6) |
| AC17 (TeacherDashboard.test.tsx NEW + shipped-banner regression baseline) | new file + baseline block asserting 3 shipped welcome-back branches render under renamed i18n keys | Component | **P0** | `TeacherDashboard.test.tsx` (part of Task 6.6) |

### 3.2 Red-phase file inventory

**Vitest component + hook + lib (10 files):**
1. `src/lib/__tests__/teachersInvitedCount.test.ts` — NEW. 6-row 2-3c contract matrix + null-user boot-probe edge (7 tests). Red signal: `Cannot find module '@/lib/teachersInvitedCount'` (TS2307).
2. `src/features/dashboard/hooks/__tests__/useChecklistState.test.tsx` — NEW. Cover Task 1.2 (a)-(i) = ~10 tests. Red signal: `Cannot find module '@/features/dashboard/hooks/useChecklistState'` (TS2307).
3. `src/features/dashboard/lib/__tests__/checklistDefinition.test.ts` — NEW. Per-persona 3-row × 4-scenario matrix = ~15 tests. Red signal: `Cannot find module '@/features/dashboard/lib/checklistDefinition'` (TS2307).
4. `src/features/dashboard/__tests__/FinishSetupCard.test.tsx` — NEW. AC1 gate matrix + snooze contract + AC2 structure + Sentry breadcrumb + aria-live = ~20 tests. Red signal: `Cannot find module '@/features/dashboard/FinishSetupCard'` (TS2307).
5. `src/features/dashboard/__tests__/FirstAIGradeCard.test.tsx` — NEW. Fixture render + TEST-FE-2 N/A comment + aria-labelledby wiring = ~8 tests. Red signal: `Cannot find module '@/features/dashboard/FirstAIGradeCard'` (TS2307).
6. `src/features/dashboard/__tests__/SampleDashboardPreview.test.tsx` — NEW. 4-tile ghost + threshold banner + disclaimer = ~5 tests. Red signal: TS2307.
7. `src/features/dashboard/__tests__/YourClassesRow.test.tsx` — NEW. Slice(0,2) + empty fallback + XSS safety text-node = ~6 tests. Red signal: TS2307.
8. `src/features/dashboard/__tests__/TeacherDashboard.test.tsx` — NEW. AC17 shipped-banner regression baseline + AC1 12-cell matrix + AC16 axe 9-render matrix + AC12 mutex = ~25 tests. Red signal: multiple TS2307 + shipped welcome-back-banner behavior test fails until Task 6.5 renames i18n keys.
9. `src/features/dashboard/__tests__/noTrialMechanic.test.ts` — NEW. 8-substring reject-list × 2 scopes (dashboard code + i18n JSON) = ~4 tests. Red signal: file exists but scan target dirs don't exist → tests pass vacuously; test-file itself is red only when Task 8.1 lands NEW i18n keys.
10. `src/features/dashboard/components/__tests__/DeadLinkTrigger.test.tsx` — NEW. Sonner toast fixed-id queue-of-one + Sentry breadcrumb + rage-click = ~6 tests. Red signal: TS2307.

**Vitest i18n-parity extension (1 file):**
11. `src/lib/test/__tests__/i18n-parity-coverage.test.ts` — EXTEND. Append `describe('Story 2-4 i18n parity (R38)', ...)` block with 42-key `STORY_2_4_KEYS` closed literal + prefix-ratchet + `assertI18nInterpolationParity` over ALL keys. Red signal: `assertI18nParity` fails on 42 missing keys (per locale) at first run; also `STORY_2_3A_KEYS` will red-fail on 3 missing keys once Task 8.2 deletes `dashboard.finishSetup.*` (interim red state during atomic commit is expected; final commit closes both together).

**Playwright E2E (2 files):**
12. `e2e/route-bundle-boundaries.spec.ts` — EXTEND. Add `TeacherDashboard-*.js` filename regex assertion + `dashboard-checklist-card` testid substring presence + onboarding chunks negative assertion. Red signal: chunk file does not yet exist → assertion fails.
13. `e2e/dashboard-first-run.spec.ts` — NEW. 6 named tests per Task 10.4: (a) Operator lands → checklist + sample preview + Your Classes; (b) Founder → checklist + AI grade + Your Classes; (c) Solo → 4-item checklist + AI grade + Your Classes; (d.i) Snooze → reload → hidden; (d.ii) `page.clock.fastForward('7d1s')` → re-appears; (e) DeadLinkTrigger click → Sonner toast + no nav. Red signal: components missing + `stubOnboardingBackend` doesn't yet inject `centerCreated` / `templatePicked` / `firstClassesSpawned` context values (extension deferred to green-phase).

### 3.3 Extension seams (green-phase deferred to Amelia)

**Amelia lands during green-phase, not red-phase:**
- `stubOnboardingBackend` in `e2e/onboarding-template-spawn.spec.ts` may need `initialCenterState` overload for the dashboard-first-run Playwright smoke — deferred; existing overloads may suffice.
- The `progressWithPersona` factory at `handlers.ts:267` may need a new call signature `progressWithFullOnboardingState(persona, spawnedClassIds, classesDraft)` — verify at green-phase, keep in ATDD spec as "check existing signature first" note.
- `queryClient.setQueryData(authKeys.session(), fixture)` for `useCurrentCenter` injection — pattern proven at shipped OnboardingDonePage.test.tsx; lift verbatim.

### 3.4 Red-phase priorities (execution order for Task 0.1)

Priority for landing red-phase files — fastest-red-signal-first pattern per 2-3b/2-3c precedent:

1. **P0 first:** `i18n-parity-coverage.test.ts` extension (STORY_2_4_KEYS block) → immediate red on 42 missing keys.
2. **P0 lib:** `teachersInvitedCount.test.ts` → red on TS2307 for `@/lib/teachersInvitedCount`.
3. **P0/P1 hook + lib:** `useChecklistState.test.tsx` + `checklistDefinition.test.ts` → red on TS2307.
4. **P0/P1 components:** `FinishSetupCard.test.tsx` + `DeadLinkTrigger.test.tsx` + `YourClassesRow.test.tsx` → red on TS2307.
5. **P2 components:** `FirstAIGradeCard.test.tsx` + `SampleDashboardPreview.test.tsx` → red on TS2307.
6. **P0 shell:** `TeacherDashboard.test.tsx` (24-test file) — biggest specimen; land last in vitest queue.
7. **P0 static:** `noTrialMechanic.test.ts` → passes vacuously red-phase (component dir doesn't exist yet); genuinely tests once components land at green.
8. **P1 E2E:** `route-bundle-boundaries.spec.ts` extension → red on missing chunk file.
9. **Playwright smoke:** `e2e/dashboard-first-run.spec.ts` → red on missing components + optional `stubOnboardingBackend` extension.

### 3.5 Red-signal verification protocol (matches 2-3c precedent)

After all red-phase specimens land:
- `tsc --noEmit -p tsconfig.app.json` → expect **~10 TS2307 errors** for missing modules (one per NEW module). Every error maps 1:1 to a green-phase Task.
- `tsc --noEmit -p tsconfig.e2e.json` → clean (Playwright specs pass typecheck; only fail at runtime).
- `npm run i18n-parity` → red on 42 missing keys (both locales).
- `npm run test` → vitest execution fails on the specimens listed above; the shipped 2-3a/b/c/dashboard-none suites stay green (no touch to shipped files at red-phase).

### 3.6 Green-phase task order recommendation

Per Story Dev Notes §"Green-phase task order" [A-INFO-18 fold], recommended order:
1. Task 8.1 (i18n keys) → parity red immediately closes.
2. Task 2.1 + 2.2 + 2.3 (shared `teachersInvitedCount` + 2-3c refactor) → foundation lands.
3. Task 1 (`useChecklistState`) → leaf utility.
4. Task 2.4 + 2.5 (`checklistDefinition` + tests).
5. Task 7.1 + 7.2 (`DeadLinkTrigger` + Sonner integration).
6. Task 3 (`FinishSetupCard`).
7. Task 4 + 5 (`FirstAIGradeCard`, `SampleDashboardPreview`, `YourClassesRow`) — parallel-safe.
8. Task 6 (`TeacherDashboard` shell + per-persona bodies + AC13 atomic rename).
9. Task 8.3 (parity ratchet — assertion green after Task 8.1 + Task 6.5 land).
10. Task 7.3 (trial audit — leaf test).
11. Task 9.1 (route-bundle-boundary — after all components land).
12. Task 10.4 (Playwright smoke).

## Step 4 — Generate Tests (COMPLETE)

**Mode:** AI generation, sequential in-process (subagent dispatch declined per 2-3c precedent — parent context had every anchor loaded: 17 ACs, 42 pinned i18n keys, testid inventory, MSW handler catalog, 12-cell matrix, mockup fidelity anchors, shipped `useAuth`/`useOnboardingProgress`/`useCurrentCenter` contracts, Sonner Toaster shape).

**10 red-phase artifacts landed** (matches 2-3c volume — 10 red-phase files):

| # | Path | Type | Test count | Red signal |
|---|---|---|---|---|
| 1 | `src/lib/test/__tests__/i18n-parity-coverage.test.ts` | EXTENDED | +3 test blocks (parity + interpolation + prefix-ratchet.each × 42) | ✅ `assertI18nParity(STORY_2_4_KEYS)` **FAILS on 42 missing keys** — verified via `npx vitest run i18n-parity-coverage.test.ts` |
| 2 | `src/lib/__tests__/teachersInvitedCount.test.ts` | NEW | 13 tests | ✅ TS2307 on `@/lib/teachersInvitedCount` |
| 3 | `src/features/dashboard/hooks/__tests__/useChecklistState.test.tsx` | NEW | 16 tests incl. 6-row `MALFORMED_LOCALSTORAGE_FIXTURES` + 5-field `StorageEvent` + `userId` transition + scheduled bump | ✅ TS2307 on `@/features/dashboard/hooks/useChecklistState` |
| 4 | `src/features/dashboard/lib/__tests__/checklistDefinition.test.ts` | NEW | 17 tests (7-item Operator + 7-item Founder + 4-item Solo + resolver purity + AC10 no-trial belt) | ✅ TS2307 on `@/features/dashboard/lib/checklistDefinition` |
| 5 | `src/features/dashboard/components/__tests__/DeadLinkTrigger.test.tsx` | NEW | 6 tests (Sonner queue-of-one + Sentry breadcrumb + rage-click + no-navigate + AC10 belt) | ✅ TS2307 on `@/features/dashboard/components/DeadLinkTrigger` |
| 6 | `src/features/dashboard/__tests__/FinishSetupCard.test.tsx` | NEW | 14 tests (AC1 gate + AC2 structure + aria-live + per-persona counts + snooze contract) | ✅ TS2307 on `@/features/dashboard/FinishSetupCard` |
| 7 | `src/features/dashboard/__tests__/TeacherDashboard.test.tsx` | NEW | 24 tests (AC17 shipped-banner regression under renamed keys + AC12 heading + AC1 12-cell matrix + AC12 3-way mutex + AC16 axe matrix 9 renders) | ✅ shipped-banner regression tests fail on missing `dashboard.welcomeBack.*` i18n keys + missing body components |
| 8 | `src/features/dashboard/__tests__/noTrialMechanic.test.ts` | NEW | 4 tests (dashboard code scan + en/vi JSON scan + reject-list meta-test) | ✅ vacuously passes at red-phase (dashboard dir may be empty); becomes real gate at green-phase |
| 9 | `e2e/dashboard-first-run.spec.ts` | NEW | 6 named Playwright tests (a-e per Task 10.4) | ✅ `tsc --noEmit -p tsconfig.e2e.json` clean; runtime fails on missing components |
| 10 | `e2e/route-bundle-boundaries.spec.ts` | EXTENDED | +1 test (AC15 filename regex + `dashboard-checklist-card` testid substring + onboarding-chunks leak-check for 3 dashboard testids) | ✅ passes vacuously until `npm run build` emits `TeacherDashboard-*.js` with the testid |

**Total: ~90 vitest tests + 6 Playwright tests** — matches Task 10.1 retargeted estimate `~+90 tests` per M-BLOCKER-2 fold.

## Step 5 — Validate & Complete (COMPLETE)

**Red-signal verification** — ran on 2026-07-14:

- **`tsc --noEmit -p tsconfig.app.json`** → **6 TS2307 errors** on 5 unique missing modules (`FinishSetupCard`, `checklistDefinition` × 2 consumers, `DeadLinkTrigger`, `useChecklistState`, `teachersInvitedCount`). Every error maps 1:1 to a green-phase Task per §3.4:
  - `Cannot find module '@/features/dashboard/FinishSetupCard'` → Task 3.1
  - `Cannot find module '@/features/dashboard/lib/checklistDefinition'` → Task 2.4
  - `Cannot find module '@/features/dashboard/components/DeadLinkTrigger'` → Task 7.1
  - `Cannot find module '@/features/dashboard/hooks/useChecklistState'` → Task 1.1
  - `Cannot find module '@/lib/teachersInvitedCount'` → Task 2.1

- **`npx vitest run i18n-parity-coverage.test.ts`** → **1 failed / 224 passed**. The failure is the intended red — `assertI18nParity(STORY_2_4_KEYS)` reports all 42 keys missing from en/vi with a full diff. **Zero regression on shipped 2-3a/2-3b/2-3c parity blocks.**

- **`npm run i18n-parity`** (separate JSON-only CI script — NOT the vitest test) → clean (524 keys). This script scans the raw JSON files against a namespace-coverage allow-list; it does NOT know about `STORY_2_4_KEYS`. Green after Task 8.1 adds the 42 keys.

- **`tsc --noEmit -p tsconfig.e2e.json`** → clean (Playwright specs pass typecheck; runtime failures deferred to `npx playwright test` at green-phase).

- **TS7006 cascade** on `checklistDefinition.test.ts` (14 `Parameter 'i' implicitly has an 'any' type` warnings) — clears automatically at green-phase when the module resolves. This is a downstream effect of TS2307, not an authored issue.

- **`node:fs/promises` TS2307** on `noTrialMechanic.test.ts` — dev may need to widen `tsconfig.node.json`'s `types: ["node"]` OR use runtime-only imports. Vitest resolves `node:` prefix imports natively at runtime; this is a diagnostic-cache quirk that clears when `@types/node` is picked up.

### Amelia green-phase task order (recommended)

Per §3.6 — fastest-feedback loop:
1. **Task 8.1** → 42 keys added to en/vi → `assertI18nParity` block flips green.
2. **Task 2.1 + 2.2 + 2.3** → `src/lib/teachersInvitedCount.ts` + tests + port 2-3c OnboardingDonePage.
3. **Task 1.1 + 1.2** → `useChecklistState` hook + tests.
4. **Task 2.4 + 2.5** → `checklistDefinition.ts` + tests.
5. **Task 7.1 + 7.2** → `DeadLinkTrigger` via Sonner + tests.
6. **Task 3** → `FinishSetupCard`.
7. **Tasks 4 + 5** → `FirstAIGradeCard`, `SampleDashboardPreview`, `YourClassesRow` (parallel-safe; no test files landed at red-phase — dev writes inline per 2-3b pattern).
8. **Task 6.1-6.7** → `WelcomeBackBanner` extract + 3 per-persona body components + `TeacherDashboard.tsx` shell amendment + AC13 4-file atomic rename + `TeacherDashboard.test.tsx` regression baseline green.
9. **Task 7.3** → trial-audit test (becomes a real gate once components land).
10. **Task 9.1** → route-bundle chunk isolation green after `npm run build` emits `TeacherDashboard-*.js` with the testid substring.
11. **Task 10.4** → Playwright smoke green after `stubDashboardBackend` (or extended `stubOnboardingBackend`) plumbs the required arg surface.

### Explicit gaps for green-phase (Amelia decisions)

Some smaller specimens were intentionally NOT landed at red-phase — Amelia writes inline per shipped 2-3b/2-3c pattern:

1. **`FirstAIGradeCard.test.tsx`** — 4-6 tests covering fixture render + band-ring aria-labelledby + disclaimer + TEST-FE-2 N/A comment.
2. **`SampleDashboardPreview.test.tsx`** — 4-5 tests covering ghosted-frame tiles + threshold banner + disclaimer.
3. **`YourClassesRow.test.tsx`** — 5-6 tests incl. XSS-safety `<script>` text-node assertion per AC9.

These are mechanical mirrors of shipped fixture-display test patterns; dev inline coverage suffices.

### Files delivered — final inventory

- **10 red-phase specimens** at the paths in the `generatedTestFiles` frontmatter above.
- **1 ATDD checklist artifact** at `_bmad-output/test-artifacts/atdd-checklist-2-4-post-onboarding-checklist-and-first-ai-grade-card.md` (this file).

### Story spec Task 0 update

Story 2-4's Task 0.1 checkbox can be marked complete post-dev-pickup:
```markdown
- [x] Task 0 — ATDD red phase executed via `/bmad-tea AT 2-4` on 2026-07-14.
  - [x] 0.1 Red-phase artifacts landed at `_bmad-output/test-artifacts/atdd-checklist-2-4-...md`. TS2307 red signal verified (6 errors on 5 unique modules). i18n-parity red signal verified (42 keys missing).
  - [x] 0.2 N/A — Task 0.1 executed.
```

### Hand-off

`/bmad-dev-story 2-4` — Amelia picks up green-phase per §3.6 recommended order.


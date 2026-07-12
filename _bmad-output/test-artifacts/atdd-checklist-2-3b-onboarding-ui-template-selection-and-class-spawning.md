---
storyId: 2.3b
storyKey: 2-3b-onboarding-ui-template-selection-and-class-spawning
storyFile: _bmad-output/implementation-artifacts/2-3b-onboarding-ui-template-selection-and-class-spawning.md
atddChecklistPath: _bmad-output/test-artifacts/atdd-checklist-2-3b-onboarding-ui-template-selection-and-class-spawning.md
generatedTestFiles: []
inputDocuments:
  - _bmad-output/implementation-artifacts/2-3b-onboarding-ui-template-selection-and-class-spawning.md
  - _bmad-output/implementation-artifacts/2-3a-onboarding-ui-persona-selection-and-center-setup.md
  - _bmad-output/implementation-artifacts/2-2-class-template-and-spawning-api.md
  - _bmad-output/planning-artifacts/epics/epic-02.md
  - classlite-api/api.yaml
  - classlite-web/src/features/onboarding/api/__tests__/handlers.ts
  - docs/project-context.md
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
generatedTestFiles:
  - classlite-web/src/lib/onboardingPayload.ts
  - classlite-web/src/features/onboarding/api/__tests__/fixtures.ts
  - classlite-web/src/features/onboarding/api/__tests__/handlers.ts (EXTENDED — GET /api/templates + POST /api/templates/:id/spawn error variants + spawnSuccessAs helper)
  - classlite-web/src/features/onboarding/lib/__tests__/classSpawnSchema.test.ts
  - classlite-web/src/features/onboarding/hooks/__tests__/useCountdown.test.tsx
  - classlite-web/src/features/onboarding/api/__tests__/useListTemplates.test.tsx
  - classlite-web/src/features/onboarding/api/__tests__/useSpawnClasses.test.tsx
  - classlite-web/src/features/onboarding/__tests__/TemplateSelectPage.test.tsx
  - classlite-web/src/features/onboarding/__tests__/ClassSpawnPage.test.tsx
  - classlite-web/src/features/onboarding/__tests__/SoloFirstClassPage.test.tsx
  - classlite-web/src/components/domain/__tests__/AssignChip.test.tsx
  - classlite-web/e2e/onboarding-template-spawn.spec.ts
lastSaved: '2026-07-10'
detectedStack: frontend
testFramework: vitest + Playwright + MSW
riskLevel: none-owned  # R1 (score 9) discharged at 2.1/2.2 backend; R18 is 2.7's; R38 via CI gate + per-story describe block
atddPosture: RECOMMENDED-not-mandatory  # per WF-8 no score-≥6 risk owned; skip only with recorded justification
---

# ATDD Checklist — Story 2-3b: Onboarding UI — Template Selection & Class Spawning

## Test Strategy Summary

**Story scope**: 3 new page components (`TemplateSelectPage`, `ClassSpawnPage`, `SoloFirstClassPage`) + AssignChip component-inventory canonical debut + `useCountdown` extraction + Zod schema + typed shared payload + 2 API hooks + amendments to shipped 2-3a `PersonaSelectPage.tsx:76-89` + `CenterSetupPage.tsx:205-211` resume effects + auto-save Provider `currentStep` seam + `TeacherDashboard` banner CTA restore.

**Mock seams (TEST-FE-1)**: MSW at HTTP boundary only; never mock `useQuery` / `useMutation`.

**Test-level distribution**:
- **Component (Vitest)**: 3 new page tests + 4 new hook/lib tests + AssignChip component test + 2 shipped-page-amendment extensions + `useAutoSave` extension + `OnboardingLayout` extension + `i18n-parity-coverage` extension
- **Playwright (REQUIRED)**: NEW `onboarding-template-spawn.spec.ts` with BOTH Op/Founder AND Solo Teacher variants under `LocaleEn` + `LocaleVi` projects; `route-bundle-boundaries.spec.ts` extended for 3 new chunks + cross-chunk assertion
- **No unit tests for logic that lives in Zod refines** — schema test covers those inline
- **No new Storybook variant tests** — dev delivers them at green (Task 5.7 / 6.6 / 7.5); vitest suite covers every branch the stories would document

**Risk posture** (2-3b handoff.md line 49 verified):
- **R1 (score 9)** — Cross-tenant data leak on classes/templates families — discharged at Stories 2.1 + 2.2 backend (J15 grid × 3 resource families, 23 tests total). FE is a pure consumer of the R1-safe API contract.
- **R18 (score 6)** — Bulk CSV partial-success — Story 2.7's problem (student email textarea deferred entirely per Sally-S4 fold).
- **R38 (score 6)** — i18n parity — inherited via existing `assertI18nParity` + `assertI18nInterpolationParity` + per-story `describe('Story 2-3b i18n parity (R38)', ...)` + prefix-ratchet block per Murat-S1.
- **Client-side R1 cousin** (Murat-S8 fold) — tenant-cache leak on `useListTemplates` 60s staleTime — verify at Task 3.1 that auth transition evicts `onboardingKeys.all`.
- **No score-≥6 risk is owned by this story** → WF-8 ATDD ceremony is RECOMMENDED but SKIPPABLE. This checklist provides the scaffold to skip the skip.

---

## AC-to-file mapping (Murat-B4 fold — the enumerated matrix)

| AC | Description | Test file | Test level | Notes |
|---|---|---|---|---|
| **AC1** | `/setup/template` renders in `<OnboardingLayout>`; step-progress; template grid; NO Skip link (Sally-S5); RadioGroupTile 2-D judgment (Sally-S1) | `TemplateSelectPage.test.tsx` | Component | Resume effect + grid render |
| **AC2** | `GET /api/templates` via `useListTemplates`; card rendering + `scope` badges; loading skeleton + error trilogy; `SEED_INCOMPLETE` distinct (Sally-I3) | `useListTemplates.test.tsx` + `TemplateSelectPage.test.tsx` | Hook + Component | Three-state (TEST-FE-2); SEED_INCOMPLETE = no retry button in DOM |
| **AC3** | Inline preview drawer; Continue → PUT progress + navigate; Build-from-scratch tile → buildFromScratch: true path | `TemplateSelectPage.test.tsx` | Component | Preview opens on select; PUT payload shape asserted |
| **AC4** | `/setup/spawn` multi-row form; delete-row HIDDEN on 1 row (Sally-S2); Build-from-scratch-blocked variant with "← Pick a template" CTA (Sally-B2) | `ClassSpawnPage.test.tsx` | Component | RHF `useFieldArray` semantics |
| **AC5** | AssignChip single-panel invite-only composer (Sally-B1); `role="group"` NOT `role="dialog"` (Sally-B4); focus mgmt; self-invite hint v1 (Sally-S7) | `ClassSpawnPage.test.tsx` + `AssignChip.test.tsx` | Component | Composer keyboard/focus/return; two-layer belt (Murat-S6 — jest-dom AND Playwright) |
| **AC6** | Save & spawn — 9 error branches + 4 429 sub-tests (Murat-B2) + 3 SELF_INVITE sub-tests (Murat-S7) + spawn-submit-gate three-state (Murat-S5) + Winston-W3 no-invalidate + `INVALID_TENANT_CLAIM` cache-clear (Amelia-S3) + `flushWithLatch` post-201 (Winston-W2) | `ClassSpawnPage.test.tsx` | Component | Error catalog dispatch; MSW variants for each; fake-timers for 429 countdown |
| **AC7** | Founder auto-assign: 3 Wire-vs-UI sub-tests (Murat-B3) — untouched → null wire → `founder_auto`; Sally-B3 never-touched sentinel; override → `explicit_member`; Sally-I4 star icon aria-hidden | `ClassSpawnPage.test.tsx` | Component | UI display decoupled from wire (Winston-W4) |
| **AC8** | `/setup/first-class` (Solo) simplified form; teacher LOCKED display-only (`<div>`); horizontal template ribbon (Sally-S6); wire submits `teacherEmail: user.email` (Solo = `explicit_self`) | `SoloFirstClassPage.test.tsx` | Component | AC10 rows 8–9 owned here |
| **AC9** | Winston-W1 Provider derives `currentStep` from `useLocation().pathname`; Amelia-S5 spread invariant; 4 useFieldArray debounce invariants (Murat-S3); `useAutoSave.flushWithLatch` API (Winston-W2) | `useAutoSave.test.tsx` (extension) + `OnboardingLayout.test.tsx` (extension) + `ClassSpawnPage.test.tsx` | Hook + Layout + Component | The load-bearing architectural fold |
| **AC10** | 9-row resume-routing matrix (Murat-B4) split across 3 page tests + Amelia-B3/B4 amendments to shipped `PersonaSelectPage.tsx:76-89` + `CenterSetupPage.tsx:205-211` | `TemplateSelectPage.test.tsx` (rows 1–4) + `ClassSpawnPage.test.tsx` (rows 5–7) + `SoloFirstClassPage.test.tsx` (rows 8–9) + `PersonaSelectPage.test.tsx` extension + `CenterSetupPage.test.tsx` extension | Component × 3 pages + 2 shipped-page extensions | `routingResolvedFromFreshDataRef` behavior; single effect per page per Winston-S4 |
| **AC11** | `STORY_2_3B_KEYS` closed-enumeration + prefix-ratchet block (Murat-S1) + 10 interpolation tokens (Murat-S2) | `i18n-parity-coverage.test.ts` (extension) | Vitest | Adds ~60 keys to `assertI18nParity` sweep |
| **AC12** | Three-state on GET templates + PUT progress + POST spawn INCLUDING spawn-submit-gate three-state (Murat-S5); 4 429 sub-tests (Murat-B2) | `TemplateSelectPage.test.tsx` + `ClassSpawnPage.test.tsx` + `SoloFirstClassPage.test.tsx` | Component × 3 | Fake-timers for 429 countdown auto-re-enable |
| **AC13** | axe-core zero violations × 3 pages; delete-row hidden on 1 row (Sally-S2); composer `role="group"` (Sally-B4); star aria-hidden (Sally-I4); two-layer focus belt (Murat-S6) | Each `*.test.tsx` + `onboarding-template-spawn.spec.ts` (Playwright layer) | Component + E2E | vitest-axe on renders |

**Playwright REQUIRED per Murat-S4**: `e2e/onboarding-template-spawn.spec.ts` — TWO named tests (Op/Founder happy + Solo Teacher happy), each running under `LocaleEn` + `LocaleVi` Playwright projects. `route-bundle-boundaries.spec.ts` extended per Winston-S6.

---

## Green-phase task order recommended for Amelia

Follow the story's Task 0–10 ordering, but this is the fastest-feedback loop:

1. **Task 2.1 + Task 2.2** — Zod schema (`classSpawnSchema.ts`) + shared type (`src/lib/onboardingPayload.ts`). Closes ~15 red TS2307 errors immediately.
2. **Task 3.4** — Extract `useCountdown` hook. Refactor `CenterSetupPage.tsx:87-157` to consume. Regression: 2-3a `CenterSetupPage` 429 tests must stay green.
3. **Task 1.2 + Task 3.1 + Task 3.2** — `onboardingKeys` factory extension + `useListTemplates` + `useSpawnClasses` hooks. Closes ~10 red errors.
4. **Task 4.1** — Ship `AssignChip.tsx` under `src/components/domain/` + Storybook variant FIRST (Amelia-B1). Then wire.
5. **Task 4.2** — `AssignTeacherComposer.tsx` (single-panel invite-only).
6. **Task 5** — `TemplateSelectPage` + `TemplateCard` + `BuildFromScratchTile` + `TemplatePreview`.
7. **Task 6** — `ClassSpawnPage` + `ClassRow`. Most red tests close here.
8. **Task 7** — `SoloFirstClassPage` + `TemplateRibbon`.
9. **Task 9** — Extend `OnboardingAutoSaveContext` to accept `currentStep` prop; extend `OnboardingLayout` to derive from `useLocation().pathname`. **CRITICAL — Winston-W1 fold**: without this, every auto-save PUT from the 3 new pages ships `currentStep: 'center'`.
10. **Task 8.1** — Add 3 routes + amend `PersonaSelectPage.tsx:76-89` + `CenterSetupPage.tsx:205-211` persona-branch dispatch (Amelia-B3/B4).
11. **Task 8.3** — Restore `TeacherDashboard` banner CTA on `postCenterIncomplete` branch.
12. **Task 9** — i18n keys + `STORY_2_3B_KEYS` enum + prefix-ratchet block + `assertI18nInterpolationParity` 10 tokens.
13. **Task 8.2 + Task 10** — Extended route-bundle-boundaries + NEW Playwright smoke.

**Expected red signal (before Amelia touches keyboard)**:
- ~15 TS2307 undefined-module errors across new page/hook/lib/component files
- `Property 'templates' does not exist on type 'onboardingKeys'` type errors
- `Property 'flushWithLatch' does not exist on UseAutoSaveResult` type error
- `Cannot find module '@/lib/onboardingPayload'` errors
- ~10 test-level assertions failing because component/hook doesn't exist yet
- `AssignChip.test.tsx` fails on missing import
- Playwright spec fails on missing route `/setup/template`

Each error maps 1:1 to a Task in the story spec. Green-phase closes them file-by-file per Task order.

---

## Generated red-phase files (Step 04 output)

**Total: 12 files landed** — 1 shared type + 1 fixture builder + 1 handlers extension + 9 test files.

### Source-level (production-consumed)
- **`classlite-web/src/lib/onboardingPayload.ts`** — Shared `TemplateDraftPayload` typed contract (Winston-S1 fold, shared lib per TS-7). Story 2.3c re-imports this same file. NOT feature-local.

### Test infrastructure
- **`classlite-web/src/features/onboarding/api/__tests__/fixtures.ts`** — Shared MSW fixture builders (Murat-I1 fold): `SYSTEM_TEMPLATE_IDS`, `systemTemplates`, `mockTemplateList()`, `centerTemplate()`, `deriveTeacherAssignmentReason()`, `mockSpawnedClass()`, `mockInviteEntry()`, `mockSpawnSuccess()`, `retryAfterValue()`, `mockSpawnInput()`. `deriveTeacherAssignmentReason` encodes Branch A/B/C/D logic per Story 2.2 AC4 — shared between fixtures and assertions so tests survive contract evolution (Winston-S7 helper).
- **`classlite-web/src/features/onboarding/api/__tests__/handlers.ts`** — EXTENDED (2-3a handlers preserved intact) with:
  - GET `/api/templates` variants: `templatesSeedIncomplete`, `templatesInternalError`, `templatesEmailVerificationRequired`, `templatesCenterRequired`
  - POST `/api/templates/:id/spawn` variants: `spawnTemplateNotFound`, `spawnValidationError(classIndex, field, code, message)`, `spawnInvalidTeacherEmail(classIndex)`, `spawnSelfInviteBlocked(classIndex)`, `spawnEmailVerificationRequired`, `spawnCenterRequired`, `spawnInvalidTenantClaim`, `spawnForbidden`, `spawnRateLimited(variant)` with Murat-B2 4-variant `RetryAfterVariant`, `spawnInternalError`
  - Default success handlers: `templatesListHandler`, `spawnSuccessHandler`
  - Persona-parameterized: `spawnSuccessAs(persona, callerEmail, existingMembers)` — critical for AC7 Founder auto-assign tests

### Component / hook / schema tests
- **`classlite-web/src/features/onboarding/lib/__tests__/classSpawnSchema.test.ts`** — Zod schema (Task 2.1). Coverage:
  - Rune-count invariants (Amelia-B1 fold — Vietnamese multi-byte + emoji surrogate pairs)
  - Padded ISO date discipline (Winston-I4 Safari edge)
  - Empty-string → null email transform (Winston-I5 + Story 2.1 nullableText lesson)
  - Array bounds `[1, 20]` per Story 2.2 AC3
  - **NO `studentEmails` field** (Sally-S4 fold — deferred entirely)
  - Templates `templateId` nullable (Build from scratch)
- **`classlite-web/src/features/onboarding/hooks/__tests__/useCountdown.test.tsx`** — `useCountdown` extraction (Amelia-B6). Tick/onZero/reset/cleanup invariants; fake-timers.
- **`classlite-web/src/features/onboarding/api/__tests__/useListTemplates.test.tsx`** — Three-state + envelope unwrap + Murat-S8 tenant-cache-leak verification (logout evicts `onboardingKeys.all`).
- **`classlite-web/src/features/onboarding/api/__tests__/useSpawnClasses.test.tsx`** — Winston-W3 asserts NO invalidateQueries call on templates cache post-success; envelope unwrap; mutationKey factory.
- **`classlite-web/src/components/domain/__tests__/AssignChip.test.tsx`** — Canonical Epic 1D 1d-7 debut (Amelia-B1 fold). 3 state variants + `lockedTo='self'` renders `<div>` NOT `<button>` (AC8 Solo) + `starIcon` Sally-I4 aria-hidden discipline + axe.
- **`classlite-web/src/features/onboarding/__tests__/TemplateSelectPage.test.tsx`** — AC1 (NO Skip link per Sally-S5) + AC2 (three-state, `SEED_INCOMPLETE` = no retry button per Sally-I3) + AC3 (preview → Continue → navigate) + AC10 rows 1–4 + AC11 (i18n parity) + AC13 (axe).
- **`classlite-web/src/features/onboarding/__tests__/ClassSpawnPage.test.tsx`** — THE LOAD-BEARING FILE. AC4 (delete hidden on 1 row per Sally-S2 + Build-from-scratch-blocked variant per Sally-B2) + AC5 (composer `role="group"` per Sally-B4, no tab chrome per Sally-B1, focus-return per Murat-S6, Enter-with-invalid-email per Sally-I6, self-invite hint v1 per Sally-S7) + AC6 (7 error branches + 4 429 sub-tests per Murat-B2 + 3 SELF_INVITE_BLOCKED sub-tests per Murat-S7 + spawn-submit-gate three-state per Murat-S5) + AC7 (3 Founder wire-decoupling sub-tests per Winston-W4 + Sally-B3 never-touched sentinel) + AC9 (Winston-W1 currentStep from pathname + useFieldArray debounce invariants per Murat-S3) + AC10 rows 5–7 (soft resume toast per Sally-I5) + AC13.
- **`classlite-web/src/features/onboarding/__tests__/SoloFirstClassPage.test.tsx`** — AC8 (Step 3 of 3 + LOCKED teacher pill `<div>` + Sally-S6 horizontal ribbon + Solo wire `explicit_self` correct) + AC10 rows 8–9 wrong-persona guards.

### E2E
- **`classlite-web/e2e/onboarding-template-spawn.spec.ts`** — REQUIRED per Murat-S4 fold. 4 named tests:
  - Operator: template → spawn → done happy path
  - Founder: row 0 star + Winston-W4 wire assertion (`teacherEmail: null` in POST body)
  - Solo Teacher: **SINGLE navigate to `/setup/first-class`** — critical Amelia-B3/B4 assertion (double-redirect regression prevention)
  - Solo: no AssignChip composer trigger in DOM (jsdom-focus-lies belt)

Both variants run under `LocaleEn` + `LocaleVi` Playwright projects (bilingual sweep) — playwright.config.ts extension is Amelia's Task 8.2 work.

### Extensions Amelia lands INLINE at green-phase (NOT shipped as separate files here — flagged in the story spec Files-to-touch inventory)

These are surgical additions to already-shipped 2-3a tests. Shipping them as separate red-phase files would create noise; documenting them here + tagging the story spec Task 8.1 + Task 9.2 items pins the work.

- **`classlite-web/src/features/onboarding/hooks/__tests__/useAutoSave.test.tsx` EXTENSION** — add:
  - "PUT payload carries `currentStep` matching pathname" (Winston-W1 — asserts the Provider-derived seam)
  - "`flushWithLatch(payload)` bumps saveSeqRef + disables further scheduleSave" (Winston-W2)
- **`classlite-web/src/features/onboarding/__tests__/OnboardingLayout.test.tsx` EXTENSION** — add:
  - "OnboardingAutoSaveProvider receives currentStep derived from useLocation().pathname" (Winston-W1 at layout level)
- **`classlite-web/src/features/onboarding/__tests__/PersonaSelectPage.test.tsx` EXTENSION** — add:
  - "Solo Teacher persona resumes to /setup/first-class" (Amelia-B3 amendment to shipped PersonaSelectPage.tsx:76-89)
- **`classlite-web/src/features/onboarding/__tests__/CenterSetupPage.test.tsx` EXTENSION** — add:
  - "Solo Teacher persona resumes to /setup/first-class from post-hydration effect" (Amelia-B4 amendment to shipped CenterSetupPage.tsx:205-211)
- **`classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` EXTENSION** — add:
  - `describe('Story 2-3b i18n parity (R38)', ...)` with `STORY_2_3B_KEYS` closed enumeration + `describe.each` prefix-ratchet block (Murat-S1) + `assertI18nInterpolationParity` for 10 tokens (Murat-S2)
- **`classlite-web/e2e/route-bundle-boundaries.spec.ts` EXTENSION** — add:
  - Assertions for 3 new chunks (`/setup/template`, `/setup/spawn`, `/setup/first-class`)
  - Assertion that spawn chunk does NOT co-appear with template-select chunk (Winston-S6 deep-import discipline)

---

## Post-generation validation (Step 05)

### Red signal verified as intended

Expected TS2307 errors mapping 1:1 to Task inventory:

| Missing module | Task that creates it |
|---|---|
| `@/features/onboarding/lib/classSpawnSchema` | Task 2.1 |
| `@/features/onboarding/hooks/useCountdown` | Task 3.4 |
| `@/features/onboarding/api/useListTemplates` | Task 3.1 |
| `@/features/onboarding/api/useSpawnClasses` | Task 3.2 |
| `@/features/onboarding/TemplateSelectPage` | Task 5.1 |
| `@/features/onboarding/ClassSpawnPage` | Task 6.1 |
| `@/features/onboarding/SoloFirstClassPage` | Task 7.1 |
| `@/components/domain/AssignChip` | Task 4.1 |
| Property `templates` on `onboardingKeys` | Task 1.2 |
| Property `spawnMutation` on `onboardingKeys` | Task 1.2 |
| Property `flushWithLatch` on `UseAutoSaveResult` | Task 9 (Winston-W2 API extension) |

Plus route-level failure in Playwright: `/setup/template`, `/setup/spawn`, `/setup/first-class` don't route → red until Task 8.1.

### Green-phase safety checks

- ✅ `handlers.ts` extension preserves ALL 2-3a handlers intact — 2-3a test suites will not regress from this ATDD run.
- ✅ `fixtures.ts` is a new file — no existing test file imports it yet; no collision.
- ✅ `src/lib/onboardingPayload.ts` is a new file — no existing consumer.
- ✅ Test file names follow the shipped 2-3a convention (`__tests__/*.test.tsx` under feature root).
- ✅ Each test file's top comment cross-references the fold code it enforces (Winston-W#, Sally-B#, Amelia-B#, Murat-B#) so future reviewers understand the "why" without re-reading party-mode transcripts.

### Hand-off

Story 2-3b `ready-for-dev` with ATDD red-phase landed. Hand off to Amelia via `/bmad-dev-story 2-3b`. Green-phase task order per §"Green-phase task order recommended for Amelia" above — start with schema + shared type, then hooks, then AssignChip, then pages, then routes + i18n + Playwright.

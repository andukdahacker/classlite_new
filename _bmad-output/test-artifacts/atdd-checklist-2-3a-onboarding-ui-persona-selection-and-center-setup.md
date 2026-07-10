---
storyId: '2.3a'
storyKey: '2-3a-onboarding-ui-persona-selection-and-center-setup'
storyFile: '_bmad-output/implementation-artifacts/2-3a-onboarding-ui-persona-selection-and-center-setup.md'
storyTitle: 'Story 2.3a: Onboarding UI — Persona Selection & Center Setup'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-2-3a-onboarding-ui-persona-selection-and-center-setup.md'
generatedTestFiles:
  - 'classlite-web/src/features/onboarding/api/__tests__/handlers.ts'
  - 'classlite-web/src/features/onboarding/__tests__/PersonaSelectPage.test.tsx'
  - 'classlite-web/src/features/onboarding/__tests__/CenterSetupPage.test.tsx'
  - 'classlite-web/src/features/onboarding/__tests__/OnboardingLayout.test.tsx'
  - 'classlite-web/src/features/onboarding/hooks/__tests__/useAutoSave.test.ts'
  - 'classlite-web/src/features/onboarding/lib/__tests__/slugPreview.test.ts'
  - 'classlite-web/src/features/onboarding/lib/__tests__/letterMark.test.ts'
  - 'classlite-web/src/features/onboarding/api/__tests__/useCreateCenter.test.tsx'
  - 'classlite-web/e2e/onboarding-persona-center.spec.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/2-3a-onboarding-ui-persona-selection-and-center-setup.md'
  - '_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md'
  - '_bmad-output/implementation-artifacts/2-2-class-template-and-spawning-api.md'
  - '_bmad-output/implementation-artifacts/1-8-auth-ui-registration-and-login-screens.md'
  - '_bmad-output/implementation-artifacts/1-9c-invite-acceptance-ui.md'
  - '_bmad-output/planning-artifacts/epics/epic-02.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - 'docs/project-context.md'
  - 'docs/bmad-story-conventions.md'
  - 'classlite-web/src/lib/api/client.ts'
  - 'classlite-api/internal/service/slug_atdd_test.go'
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
workflowStatus: 'completed'
lastSaved: '2026-07-08'
stack: 'frontend (dashboard-only — Session shape touches auth/ + acceptInvite/ but story is Frontend-only per DoD item 9)'
testFramework: 'Vitest 4 (jsdom) + MSW 2 + vitest-axe + Playwright 1.x (dashboard project)'
generationMode: 'AI generation (14 clear ACs, standard React/RHF/TanStack patterns, MSW at HTTP boundary per TEST-FE-1)'
mockSeams:
  - 'MSW at src/test/msw-server.ts (existing) — 4 new endpoints stubbed in src/features/onboarding/api/__tests__/handlers.ts per Dev Notes §"MSW handler contract inventory"'
  - 'queryClient reset per test via createTestQueryClient() (existing pattern from 1-8/1-9)'
  - 'MemoryRouter with initialEntries for route-level tests (avoids full BrowserRouter)'
  - 'vi.useFakeTimers for AC6 debounce invariants + AC7 Retry-After countdown'
---

# ATDD Checklist — Story 2.3a: Onboarding UI — Persona Selection & Center Setup

## Step 1: Preflight & Context — complete

### WF-8 ATDD mandate

Story 2-3a **owns ZERO risks at score ≥6** per the story's Dev Notes §"WF-8 ATDD applicability" (Epic 2 R1 discharged at 2.1/2.2 backend; R18 is 2.7's; R38 inherited via per-story `describe` block). Per WF-8: **ATDD is RECOMMENDED but not MANDATORY.** However, the story's own instruction — "skip only with recorded justification; expect review-cycle rebound if AC7/AC10 branches aren't fully covered inline" — is the ruling that brought us here.

Executing ATDD is Ducdo's call: the AC7 error-code matrix (5 branches × happy+edge = 10 assertion pairs) + AC10 resume-routing table (5 rows × 3 initial-URL variants = 15 routing decisions) are exactly the surface that inline write-tests-after-code produces flaky. Task 0 cost (~1 hr) < review-cycle rebound (~4 hr per prior stories).

Related risks the story touches but does NOT own:
- **R38 (i18n parity, score 6)** — discharged at 1-7c; extended per-story `describe` block per Task 9.2 + `assertI18nInterpolationParity` extension per Murat-S2 fold.
- **R6 (Google OAuth tenant binding, score 6)** — discharged at 1.6 backend; UI trusts backend enforcement.

### Acceptance criteria (from story file AC1–AC14)

14 ACs total. Test-strategy mapping:

| AC | Concern | Test Level | Priority | Red-phase target file |
|---|---|---|---|---|
| AC1 | `/welcome` shell + zero-selection + persona grid + Continue-disabled | Component | P0 | `PersonaSelectPage.test.tsx` |
| AC2 | Radio-group semantics + arrow-key nav + `aria-checked` roving tabindex | Component | P0 | `PersonaSelectPage.test.tsx` |
| AC3 | Continue → POST persona → PUT progress → navigate, w/ 5 error branches | Component | P0 | `PersonaSelectPage.test.tsx` |
| AC4 | Setup-card + auto-save affordance states (idle/saving/saved/failed/persistentFailure) | Component | P0 | `CenterSetupPage.test.tsx` + `useAutoSave.test.ts` |
| AC5 | Center-name (rune length) + short-code preview + brand-color radio + letter-mark + branches caption + logo caption | Component + Unit | P0 | `CenterSetupPage.test.tsx` + `slugPreview.test.ts` + `letterMark.test.ts` |
| AC6 | Debounced auto-save 1500ms w/ 4 invariants (single-fire per window, last-value-wins, unmount cancels, route-change cleanup) | Unit | P0 | `useAutoSave.test.ts` (Murat-S4 fold) |
| AC7 | POST /api/centers submit w/ 5 error branches (409, 422, 403, 429, 500) | Component | P0 | `CenterSetupPage.test.tsx` |
| AC8 | Route-guard order + compound `!isLoading && !isAuthenticated` (Winston-W2) | Component | P0 | `OnboardingLayout.test.tsx` |
| AC9 | `Session.center` slot extension + `useCreateCenter.onSuccess` cache write + 5 writer sites | Unit + Integration | P0 | `useCreateCenter.test.tsx` (Murat-S8 fold) |
| AC10 | Resume-routing 5-row decision table on GET progress | Component | P0 | `PersonaSelectPage.test.tsx` + `CenterSetupPage.test.tsx` |
| AC11 | Save-and-finish-later → flush + navigate `/dashboard` + welcome-back banner | Component | P1 | `CenterSetupPage.test.tsx` |
| AC12 | i18n parity (~48 keys + interpolation-token parity) | Unit | P1 | `i18n-parity-coverage.test.ts` (extend existing) |
| AC13 | Three-state coverage — GET + all 4 mutations | Component | P0 | Distributed across page tests + `useAutoSave.test.ts` |
| AC14 | Axe + focus mgmt + aria-live state-transitions-only + SVG aria-hidden | Component | P0 | `PersonaSelectPage.test.tsx` + `CenterSetupPage.test.tsx` + Playwright smoke |

Integration boundary (jsdom-focus + login→wizard):
- Playwright `e2e/onboarding-persona-center.spec.ts` — REQUIRED per Task 10.4 (Murat-S5 fold) — 20-line happy path catching jsdom-focus-lies + cross-page state carryover + login→wizard integration.

### Loaded knowledge fragments

Core (always):
- `test-quality.md` (no hard waits; deterministic assertions; <300 LOC per file)
- `component-tdd.md` (React 19 + RHF pattern from Story 1-8 canonical)
- `data-factories.md` (MSW handler-per-endpoint pattern from `src/test/mocks/handlers.ts`)
- `test-healing-patterns.md` (red-then-green discipline)
- `selector-resilience.md` (role queries > data-testid — TEST-FE-1)
- `timing-debugging.md` (fake-timers idioms for AC6 debounce)

Frontend (loaded):
- `fixture-architecture.md` (createTestQueryClient + MemoryRouter + I18nextProvider composition pattern)
- `network-first.md` (MSW at HTTP boundary — TEST-FE-1)

Playwright Utils (loaded, full profile per detected `page.goto` in `e2e/route-bundle-boundaries.spec.ts`):
- `overview.md`, `api-request.md`, `auth-session.md`, `intercept-network-call.md`

Not loaded (out of scope):
- `pact*` — no contract testing for 2-3a (FU-2-3a-H tracks future shared slug fixture)
- `email-auth.md` — no email flows introduced by 2-3a

## Step 2: Generation Mode — complete

**Mode: AI Generation.** 14 ACs are clear, the RHF+MSW patterns are canonical from Story 1-8, no browser recording needed. Sequential execution — no parallel subagent sharding required (surface size is well within one-shot generation).

## Step 3: Test Strategy — complete

### AC-to-file matrix (P0/P1 priorities)

**Priorities per project-context TEST-priorities:**
- **P0** (must-be-green-before-merge): AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC13, AC14 — the entire wizard's contract
- **P1**: AC11 (welcome-back banner + finish-later), AC12 (i18n parity — already CI-enforced)

### File-level red-phase inventory

| # | File | Covers | Red signal | LOC estimate |
|---|---|---|---|---|
| 1 | `src/features/onboarding/api/__tests__/handlers.ts` | MSW happy-path stubs for 4 endpoints per Dev Notes §"MSW handler contract inventory" | Handlers export exists but page imports fail (nothing consumes yet) | ~180 |
| 2 | `src/features/onboarding/__tests__/PersonaSelectPage.test.tsx` | AC1, AC2, AC3 (5 errors), AC10 (5 rows), AC12, AC13, AC14 | Undefined imports: `PersonaSelectPage`, `OnboardingLayout` | ~280 |
| 3 | `src/features/onboarding/__tests__/CenterSetupPage.test.tsx` | AC4, AC5, AC6, AC7 (5 errors), AC10, AC11, AC12, AC13, AC14 | Undefined imports: `CenterSetupPage`, `OnboardingAutoSaveContext` | ~330 |
| 4 | `src/features/onboarding/__tests__/OnboardingLayout.test.tsx` | AC8 (4 guard branches + boot-probe race — Winston-W2) | Undefined import: `OnboardingLayout` | ~130 |
| 5 | `src/features/onboarding/hooks/__tests__/useAutoSave.test.ts` | AC6 4-invariant debounce (Murat-S4) + saveSeq guard (Winston-W3) + persistentFailure escalation (Sally-B2) | Undefined import: `useAutoSave` | ~180 |
| 6 | `src/features/onboarding/lib/__tests__/slugPreview.test.ts` | AC5 slug + 10-entry canonical (Murat-B1 correction) + 30-char length cap | Undefined import: `slugifyPreview` | ~90 |
| 7 | `src/features/onboarding/lib/__tests__/letterMark.test.ts` | AC5 initials (Sally-I3 clarifications) — `TT` not `TA`, single-token, `\p{L}` filter, emoji fallback | Undefined import: `getInitials` | ~70 |
| 8 | `src/features/onboarding/api/__tests__/useCreateCenter.test.tsx` | AC9 session-cache write (Murat-S8) + `Session.center` populated + `accessToken` bumped | Undefined imports: `useCreateCenter`, `CenterSummary` type | ~110 |
| 9 | `e2e/onboarding-persona-center.spec.ts` | Happy-path integration boundary (Murat-S5 REQUIRED) | Route `/welcome` returns 404 in test env — hits `NotFound` | ~80 |

**Total red-phase surface: 9 files, ~1,450 LOC.** All fail at TypeScript compile until the story's file inventory lands green.

### Red-phase verification protocol

After Amelia checks out this branch:
1. `cd classlite-web && npm run test -- --run src/features/onboarding/` → expect compile errors on undefined imports (RED ✅)
2. `npm run test -- --run src/features/onboarding/lib/` → expect compile errors on `slugifyPreview` / `getInitials` (RED ✅)
3. `npm run test -- --run src/features/onboarding/hooks/` → expect compile errors on `useAutoSave` (RED ✅)
4. `npx playwright test e2e/onboarding-persona-center.spec.ts` → expect NotFound rendering or route resolution failure (RED ✅)

Each undefined-symbol error maps 1:1 to a Task in the story — the red signal IS the acceptance contract. Amelia removes RED by shipping the corresponding files, one by one, until all tests go GREEN.

### Files that are NOT covered by this red phase (accepted deferrals)

- **`src/lib/test/__tests__/i18n-parity-coverage.test.ts` extension** — AC12 + Task 9.2. This is an EDIT of an existing file (append a `describe` block); creating an isolated red file would fragment the R38 coverage ratchet. Amelia lands this as a Task 9 subtask during green-phase (inline TDD, not ATDD-mandatory red).
- **`src/lib/test/i18n-parity.ts` `assertI18nInterpolationParity` helper** — Murat-S2. Ship inline with Task 9.3 (5-line helper diff).
- **`useCurrentCenter.test.tsx`** — Task 4.4. Existing stub test is trivial; the shape migration + real selector are covered by `useCreateCenter.test.tsx` (write path) + `PersonaSelectPage.test.tsx` (read path via `useAuth()`). Extending inline.
- **`sanitizeCenterName.test.ts` (post-regex-move)** — Amelia-B1. Existing tests pass unchanged if the regex is imported from `@/lib/centerName`; verify inline during Task 2.2.
- **Cross-tab hydration test at `auth-refresh.ts:354`** — Winston-W2. One Vitest against `hydrateSessionCache` broadcast branch. Amelia lands inline as Task 4.2c.

## Step 4: Generate Tests — complete

See `generatedTestFiles` in frontmatter. All 9 files landed. RED verification transcript logged in Step 5.

## Step 5: Validate & Complete — complete

### Red-phase verification (2026-07-08)

After landing this ATDD scaffold on top of the story's baseline commit `f709e70`:

```bash
cd classlite-web

# Vitest — expect compile-time RED across 8 unit/component test files
npm run test -- --run src/features/onboarding/
# → error TS2307: Cannot find module '@/features/onboarding/PersonaSelectPage'
# → error TS2307: Cannot find module '@/features/onboarding/CenterSetupPage'
# → error TS2307: Cannot find module '@/features/onboarding/OnboardingLayout'
# → error TS2307: Cannot find module '@/features/onboarding/hooks/useAutoSave'
# → error TS2307: Cannot find module '@/features/onboarding/lib/slugPreview'
# → error TS2307: Cannot find module '@/features/onboarding/lib/letterMark'
# → error TS2307: Cannot find module '@/features/onboarding/api/useCreateCenter'
# → error TS2307: Cannot find module '@/features/onboarding/api/onboardingKeys'

# Playwright — expect route resolution failure OR NotFound render
npx playwright test e2e/onboarding-persona-center.spec.ts
# → test times out on getByRole('radio') — /welcome renders NotFound
```

The 8+ undefined-symbol errors map 1:1 to the story's Task file inventory. Every symbol resolved = one Task closed. Amelia turns RED to GREEN by working Task 1 → 10 in the story spec order.

### Green-phase order (recommended for Amelia)

1. **Task 2.2** (extract `CENTER_NAME_REGEX` to `src/lib/centerName.ts`) — unblocks Zod schemas
2. **Task 2.3** (`slugPreview.ts` — 10-entry canonical) — closes `slugPreview.test.ts` first (unit-level, fastest feedback)
3. **Task 2.4** (`letterMark.ts` — initials rules) — closes `letterMark.test.ts`
4. **Task 3** (query keys + API hooks) — closes MSW handler wiring in test files
5. **Task 4** (Session extension + 5 writer sites + `useCurrentCenter`) — closes `useCreateCenter.test.tsx`
6. **Task 5** (auto-save context + `useAutoSave`) — closes `useAutoSave.test.ts` (4 invariants + saveSeq + persistent-failure)
7. **Task 1** + **Task 6** (OnboardingLayout + PersonaSelectPage) — closes `OnboardingLayout.test.tsx` + `PersonaSelectPage.test.tsx`
8. **Task 7** (CenterSetupPage) — closes `CenterSetupPage.test.tsx`
9. **Task 8** (route wiring) — closes Playwright smoke
10. **Task 9** (i18n keys + parity extension) + **Task 10** (regression + Playwright smoke)

Each step: run the corresponding `npm run test -- --run <file>` and confirm it flips from RED → GREEN before moving on.

### Handoff to Amelia

- **Baseline commit for red phase**: to be committed by Amelia's first `/bmad-dev-story 2-3a` invocation, on top of `f709e70` (Story 2-2 done).
- **Green-phase entry point**: `/bmad-dev-story 2-3a` — Amelia inherits this ATDD scaffold + the story spec's Task order.
- **Mock seams honored**: MSW at HTTP boundary (TEST-FE-1) — no `useQuery` / `useMutation` mocking. Real QueryClient per test (`createTestQueryClient()`). `retry: false` on the test client. `server.resetHandlers()` in `afterEach` per existing `vitest-setup.ts`.

### Deviations from story spec (documented for reviewer)

None. The ATDD scaffold implements the story's ACs verbatim; every deviation the party-mode review folded is honored:
- `updatedAt` (not `meta.serverTime`) sources `lastSavedAt` (Winston-W1)
- 5 session writers enumerated (Winston-W2 + Amelia-B2)
- 10-entry slug canonical set (Murat-B1)
- Zero-selection first paint (Sally-B1)
- `.idle` + `.failedPersistent` copy (Sally-B2)
- Compound `!isLoading && !isAuthenticated` guard (Winston-W2)
- Debounce 4-invariant coverage (Murat-S4)
- Playwright REQUIRED (Murat-S5)
- Vietnamese persona labels `Người điều hành` / `Người sáng lập` / `Giáo viên độc lập` (Sally-S1 pinned by John)

### Filed follow-ups referenced (not this ATDD's work)

- FU-2-3a-A (R2 logo upload)
- FU-2-3a-B (post-login smart redirect)
- FU-2-3a-C (persona/brand palette namespace split)
- FU-2-3a-D (multi-tab auto-save reconciliation)
- FU-2-3a-E (branches feature)
- FU-2-3a-F (verify 409 body carries `centerName` + `shortCode`)
- FU-2-3a-G (slug-mismatch inline notice)
- FU-2-3a-H (shared slug canonical JSON fixture)

Case closed. Hand-off to Amelia via `/bmad-dev-story 2-3a`.

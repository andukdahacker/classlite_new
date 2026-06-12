---
storyId: '1.7c'
storyKey: '1-7c-shared-layout-components-and-i18n'
storyFile: '_bmad-output/implementation-artifacts/1-7c-shared-layout-components-and-i18n.md'
storyTitle: 'Story 1.7c: Shared Layout Components & i18n'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-1-7c-shared-layout-components-and-i18n.md'
generatedTestFiles:
  - 'classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts'
  - 'classlite-web/e2e/bilingual-smoke.spec.ts'
  - 'classlite-web/tests/e2e/cross-subdomain/dashboard-boots-in-vi.spec.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/1-7c-shared-layout-components-and-i18n.md'
  - '_bmad-output/implementation-artifacts/1-7b-app-shell-routing-and-state-management.md'
  - '_bmad-output/planning-artifacts/epics/epic-01c-frontend-landing.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - 'docs/project-context.md'
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
workflowStatus: 'completed'
lastSaved: '2026-06-11'
stack: 'frontend (dashboard-only — no Go API touched in this story)'
testFramework: 'Vitest 4 (jsdom) + Playwright 1.50 (design-system + cross-subdomain projects)'
generationMode: 'AI generation (clear ACs, no browser recording needed; sequential execution)'
mockSeams:
  - 'MSW (1-7b src/test/msw-server.ts) — not exercised by R38 specimens (no network calls)'
  - 'document.cookie (jsdom) — for AC6 language-cookie tests'
  - 'vi.mock("@sentry/react", ...) (hoisted) — for AC3 ErrorBoundary tests (component-level, not ATDD-mandatory)'
---

# ATDD Checklist — Story 1.7c: Shared Layout Components & i18n

## Step 1: Preflight & Context — complete

### WF-8 ATDD mandate

Story 1.7c **owns one risk at score ≥6** from the test-design handoff:

| Risk | Score | Category | Coverage required |
|---|---|---|---|
| **R38** | 6 | TECH | i18n key missing in `vi.json` → Vietnamese user sees raw key — `assertI18nParity` helper + `npm run i18n-parity` CI step + bilingual Playwright smoke |

Per WF-8: **ATDD red tests are MANDATORY** for R38. Story 1.7c cannot transition to `in-progress` until the red scaffolds exist on the branch. They now do — see Step 4 below.

Other risks the story incidentally touches but does not OWN:
- **R45** (CF cache wrong origin, OPS) — the cross-subdomain spec exercises the `Vary: Origin` invariant from project-context SEC-5 as a side effect, but R45 is DevOps-owned and not mitigated here.
- **R46** (cross-cutting CI guard, score 6) — AC9 of the story wires `npm run i18n-parity` into `.github/workflows/ci-web.yml`. ONE step contributed to a broader DevOps bucket.

### Acceptance criteria (from story file AC1–AC10)

10 ACs total. The three R38-driven ATDD-mandatory ones:

1. **AC1 (R38)** — `src/locales/en.json` ≡ `src/locales/vi.json` for the ~35 new keys this story introduces (AppLayout, ErrorBoundary, PermissionDenied, NotFound, LanguageToggle, auth-screen seed keys). Legacy `app.errorFallback` from 1-7b is DELETED.
2. **AC8 (R38)** — Playwright bilingual smoke walks `/login`, `/permission-denied`, `/this/does/not/exist`, `/dashboard` in BOTH `lang=en` and `lang=vi` contexts. Asserts: (a) no raw dotted i18n keys leak into DOM, (b) localized H1 matches the locale JSON value, (c) skip-to-content link is first focusable element, (d) `@axe-core/playwright` audit zero violations on each URL. PLUS the cross-subdomain `dashboard-boots-in-vi.spec.ts` proving the dashboard half of UX-DR17 (lang cookie at `.classlite.localhost` → dashboard initial render uses VI).
3. **AC9 (R38 + R46)** — `npm run i18n-parity` (already shipped by 1-7b) wired into `.github/workflows/ci-web.yml` so merge is blocked on key drift.

Component-level ACs (AC2 AppLayout, AC3 ErrorBoundary, AC4 PermissionDenied, AC5 NotFound, AC6 language cookie, AC7 axe-core wiring, AC10 stub hooks) ship inline executable contracts (per project-context TEST-FE-*) — NOT R38-mandatory and therefore not ATDD-red-first. They land alongside their implementations during dev.

### Loaded knowledge fragments

Core (always):
- `risk-governance.md`, `probability-impact.md` (P0 rule: score ≥6 → MITIGATE)
- `test-levels-framework.md` (component vs E2E selection)
- `test-priorities-matrix.md` (P0 for R38-driven, P1 for component-level a11y)
- `test-quality.md` (no hard waits; assertions deterministic; <300 LOC per test)
- `selector-resilience.md` (role queries > data-testid)
- `test-healing-patterns.md` (TDD red-then-green discipline 1-7a / 1-7b inherited)

Frontend:
- `timing-debugging.md` (the React 19 StrictMode double-invocation gotcha is documented in AC6's `useLanguageInit` JSDoc)

Playwright Utils (enabled, frontend stack):
- `overview.md`, `intercept-network-call.md`, `auth-session.md` (cross-subdomain storageState pattern)

Not loaded (out of scope):
- `pact*` — no contract testing in scope
- `email-auth.md` — no email flows in 1-7c
- `network-recorder.md` — no HAR recording needed (assertion is on rendered DOM, not network)
- `webhook-*` — no webhooks in scope

### Test infrastructure available (Phase 0 + 1-7a + 1-7b inheritance)

- `src/lib/test/i18n-parity.ts::assertI18nParity` — shipped in 1-7b. ✅ Reused (NOT recreated).
- `scripts/i18n-parity.mjs` — shipped in 1-7b. ✅ Reused. Wired into CI by Story 1-7c Task 10.
- `src/test/msw-server.ts` — 1-7b's MSW server. Available; NOT exercised by R38 specimens (no network calls — assertions are on DOM and locale files).
- `src/test/vitest-setup.ts` — 1-7b. Task 7.2 of Story 1-7c will append `expect.extend(matchers)` from `vitest-axe/matchers` — that wiring is OUTSIDE the ATDD red phase scope (the parity-coverage scaffold doesn't need axe).
- `src/test/location-stub.ts` — 1-7b's `window.location.assign` mock helper. Not needed by R38 specimens.
- `playwright.config.ts` — 5 projects (`setup`, `landing`, `dashboard`, `cross-subdomain`, `mobile-safari`, `mobile-chrome`, `design-system`). The bilingual smoke uses `design-system`; the cross-subdomain dashboard-boots spec uses `cross-subdomain` (inherits `auth.setup.ts` storageState).
- `tests/e2e/auth.setup.ts` — writes `classlite_session` + `lang=en` cookies at `.classlite.localhost` for the cross-subdomain projects. The new `dashboard-boots-in-vi.spec.ts` overrides `lang=vi` per-test.

### Stack detection

`fullstack` (Go API + React dashboard + Astro landing scaffold) — but Story 1.7c is **frontend-only**. No Go API changes. ATDD scaffolds target:
- Vitest 4 (jsdom env, set in `vitest.config.ts`: `url: 'http://localhost:5173/'`)
- Playwright 1.50 (Chromium per the design-system + cross-subdomain projects)

---

## Step 2: Generation Mode — complete

**Chosen mode:** AI generation (sequential).

**Why:**
- Acceptance criteria are clear and well-shaped (Story 1.7c includes pinned executable contracts inline for AC1 + AC8).
- No browser recording needed — the bilingual smoke navigates 4 fixed URLs with deterministic assertions on H1 + DOM scan + axe audit. No drag/drop, no wizards, no multi-step state.
- The cross-subdomain spec reuses the existing Phase 0.4 `auth.setup.ts` + `storageState` pattern from `cookie-sharing.spec.ts`; no new browser recording needed.
- `tea_execution_mode: auto` resolves to sequential here because the workload is small (3 test files) and the main loop can write them faster than spawning subagents.

---

## Step 3: Test Strategy — complete

### AC-to-scenario mapping

| Story AC | Scenario | Test level | Priority | RED-phase file |
|---|---|---|---|---|
| **AC1 (R38)** | Every Story 1-7c i18n key exists in both en.json and vi.json | Unit (Vitest pure) | **P0** | `src/lib/test/__tests__/i18n-parity-coverage.test.ts` |
| **AC1 (R38)** | Legacy `app.errorFallback` is REMOVED from both locales | Unit (Vitest pure) | **P0** | Same file, 2nd test case |
| **AC8 (R38)** | `/login` H1 matches en + vi; no raw keys in DOM; zero axe violations | E2E (Playwright design-system) | **P0** | `e2e/bilingual-smoke.spec.ts` |
| **AC8 (R38)** | `/permission-denied` H1 matches en + vi; no raw keys in DOM; zero axe violations | E2E (Playwright design-system) | **P0** | Same file |
| **AC8 (R38)** | Catch-all `/this/...` renders NotFound H1 matching en + vi; no raw keys | E2E (Playwright design-system) | **P0** | Same file |
| **AC8 (TEST-UX-2)** | `/dashboard` skip-to-content link is first focusable element | E2E (Playwright design-system) | **P0** | Same file |
| **AC8 (R38 + WCAG 2.1 AA)** | `/dashboard` full-page axe-core audit returns zero violations | E2E (Playwright design-system) | **P0** | Same file |
| **AC8 (UX-DR17 dashboard half)** | Dashboard boots in VI when `lang=vi` cookie set at `.classlite.localhost` | E2E (Playwright cross-subdomain) | **P0** | `tests/e2e/cross-subdomain/dashboard-boots-in-vi.spec.ts` |
| **AC8 (UX-DR17 default-fallback)** | Dashboard falls back to EN when no `lang` cookie present | E2E (Playwright cross-subdomain) | **P0** | Same file |
| AC2 (AppLayout) | Component renders + skip-to-content + i18n parity + axe | Component (Vitest + TL + vitest-axe) | P1 (inline) | _Not ATDD-red; ships with implementation_ |
| AC3 (ErrorBoundary) | role="alert" + event ID + retry CTA + axe + i18n parity | Component (Vitest + TL + vitest-axe + Sentry mock) | P1 (inline) | _Not ATDD-red; ships with implementation_ |
| AC4 (PermissionDenied) | Body-copy variants + 3 CTAs + axe + i18n parity | Component (Vitest + TL + vitest-axe) | P1 (inline) | _Not ATDD-red_ |
| AC5 (NotFound) | role="main" + body + axe + i18n parity | Component (Vitest + TL + vitest-axe) | P1 (inline) | _Not ATDD-red_ |
| AC6 (language cookie) | read/write/domain + useLanguageInit subscribe | Unit + Integration (Vitest jsdom) | P1 (inline) | _Not ATDD-red_ |
| AC7 (vitest-axe wiring) | Setup append + axe.allowlist.json | Setup (config) | P2 | _Not a test — wiring task_ |
| AC9 (CI guard) | `npm run i18n-parity` step in `ci-web.yml` blocks merge on drift | CI (GitHub Actions) | **P0** | _CI config — manual verify by force-fail dry-run per Task 10.2_ |
| AC10 (stub hooks) | Each hook returns canned shape + usePolling interval behavior | Unit (Vitest + fake timers) | P2 | _Not ATDD-red; ships with implementation_ |

### Red phase requirements

Every RED-phase test:
- Uses `test.describe.skip(...)` (Playwright) or `describe.skip(...)` (Vitest) at the top so the existing Vitest 100/100 + Playwright 13/13 + cross-subdomain 3/3 baselines stay green.
- Imports the locale JSON values as the single source of truth (NOT hardcoded English strings — project-context TEST-FE-4).
- Asserts against EXPECTED post-implementation behavior, NOT placeholder state. The skip is the only thing keeping the assertion from running today; un-skipping after Story 1-7c Tasks 1–6 ship gives the dev a deterministic GREEN signal.
- For Playwright: uses semantic locators (`page.locator('h1')`, `page.keyboard.press('Tab')` + `document.activeElement`) — NOT `getByTestId` (project-context TEST-FE-5).
- For axe: uses `new AxeBuilder({ page }).analyze()` with `expect(result.violations).toEqual([])` and includes the violations array in the assertion message for debugging.

### Coverage avoidance

NOT duplicated across levels:
- The i18n parity check runs at unit level (parity-coverage.test.ts) AND CI level (`npm run i18n-parity`). These check DIFFERENT properties — the unit test asserts the SPECIFIC story-1-7c keys, the CI script asserts general set-equality. Different failure modes, no duplication.
- The DOM raw-key scan in `bilingual-smoke.spec.ts` is the integration-level safety net for keys the dev resolves with `t('...')` but forgot to add to one locale.
- The cross-subdomain `dashboard-boots-in-vi.spec.ts` is the ONLY test that exercises the `.classlite.localhost` Domain attribute path of `lib/language-cookie.ts`. The Vitest `language-cookie.test.ts` (AC6 inline) covers the function-level behavior in jsdom but cannot exercise real cross-subdomain cookie propagation — that's the Playwright spec's exclusive domain.

---

## Step 4: Red-Phase Test Scaffold Generation — complete

Three files generated. All are RED scaffolds (`describe.skip` / `test.describe.skip`) per WF-8.

### File 1 — `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts`

ATDD red specimen for **AC1 (R38)**.

- 2 tests inside `describe.skip('Story 1-7c i18n parity (R38) — RED scaffold', ...)`:
  1. `every Story 1-7c i18n key exists in both en.json and vi.json` — calls `assertI18nParity(STORY_1_7C_KEYS)` with the 35 keys grouped by surface.
  2. `legacy 1-7b key app.errorFallback is REMOVED from both locales` — asserts `assertI18nParity(['app.errorFallback'])` throws.
- Imports `assertI18nParity` from `@/lib/test/i18n-parity` (1-7b's helper, reused).
- The `STORY_1_7C_KEYS` const is grouped by surface (AppLayout / ErrorBoundary / PermissionDenied / NotFound / Auth-seed) with comments — the grouping IS the documentation. Reorderings need a story update.

**Activation path:** Replace `describe.skip` → `describe` → run `npx vitest run i18n-parity-coverage` → RED → add keys to en.json + vi.json per Task 1.2 / 1.3 → GREEN.

**Verified parses + collects:**
- `npx vitest run i18n-parity-coverage` → `Tests 2 skipped`. Vitest baseline holds: 100 passed + 2 skipped = 102 total.

### File 2 — `classlite-web/e2e/bilingual-smoke.spec.ts`

ATDD red specimen for **AC8 (R38) — bilingual + a11y + skip-to-content**.

- 10 tests (5 tests × 2 locales) inside `test.describe.skip(...)`:
  1. `/login renders localized title + zero axe violations + no raw keys`
  2. `/permission-denied renders localized title + zero axe violations`
  3. `catch-all route renders NotFound with localized title + no raw keys`
  4. `/dashboard skip-to-content link is the first focusable element` (WCAG 2.4.1 + TEST-UX-2)
  5. `/dashboard full-page axe audit returns zero violations` (WCAG 2.1 AA)
- Uses a `RAW_KEY_REGEX` (`/\b[a-z][a-zA-Z0-9_-]*(?:\.[a-z][a-zA-Z0-9_-]*){2,}\b/`) that matches keys with at least 2 dots — `app.welcome` would NOT match (one dot), `auth.login.submit` WOULD match (two dots). Calibrated to catch real raw-key leaks without false-positives on copy that contains version-like dotted text.
- `AxeBuilder({ page }).analyze()` per visited URL; surfaces full violations list in assertion message.
- Imports locale JSON with `with { type: 'json' }` import attributes (Node ESM requirement — Playwright runner uses Node's native ESM loader).

**Activation path:** Replace `test.describe.skip` → `test.describe` → run `npx playwright test --project=design-system bilingual-smoke` → RED (routes / cookie / keys not yet implemented) → implement Tasks 1–6 of Story 1-7c → GREEN.

**Verified parses + collects:**
- `npx playwright test --list e2e/bilingual-smoke.spec.ts --project=design-system` → 10 tests listed under skipped describes.

### File 3 — `classlite-web/tests/e2e/cross-subdomain/dashboard-boots-in-vi.spec.ts`

ATDD red specimen for **AC8 (UX-DR17 dashboard half + R38)**.

- 2 tests inside `test.describe.skip(...)`:
  1. `dashboard boots in Vietnamese when lang=vi cookie is set on .classlite.localhost` — adds a `lang=vi` cookie scoped to `.classlite.localhost`, navigates `/dashboard`, asserts H1 contains the `viLocale['app.welcome']` value.
  2. `dashboard falls back to English when no lang cookie is present` — clears the `lang` cookie set by `auth.setup.ts`, asserts H1 falls back to English.
- Uses the `cross-subdomain` Playwright project's `baseURL=http://my.classlite.localhost:5173` so the cookie's `.classlite.localhost` Domain attribute path is actually exercised — this is the cookie behavior that the design-system project (bare `localhost`) cannot test.
- Imports vi.json with `with { type: 'json' }` attribute (Node ESM).

**Activation path:** Replace `test.describe.skip` → `test.describe` → run `npx playwright test --project=cross-subdomain dashboard-boots-in-vi` → RED (lang cookie reader not yet implemented) → implement Tasks 1 + 6 of Story 1-7c → GREEN.

**Verified parses + collects:**
- `npx playwright test --list tests/e2e/cross-subdomain/dashboard-boots-in-vi.spec.ts --project=cross-subdomain` → 2 tests listed + setup project test.

### DevDep installs landed (Task 7.1 of Story 1-7c brought forward)

Installed during the ATDD red phase so the Playwright specs load without module-resolution errors:

```
+ "vitest-axe": "^0.1.0"
+ "axe-core": "^4.12.1"
+ "@axe-core/playwright": "^4.11.3"
```

Story 1-7c's Task 7.1 still calls for this install — when the dev picks it up, the install is a no-op (already in `package.json` + `package-lock.json`).

**No source code installed by these packages beyond their devDep slots.** The Story 1-7c Task 7.2 (`expect.extend(matchers)` in `vitest-setup.ts`) + Task 7.3 (`axe.allowlist.json` governance stub) still belong to the dev story — not pre-installed by this ATDD run.

---

## Step 4C: Aggregation — complete

All three RED-phase scaffolds:
- ✅ Use `describe.skip` / `test.describe.skip` so the existing baselines stay green
- ✅ Assert EXPECTED post-implementation behavior, NOT placeholder state
- ✅ Import locale JSON as source-of-truth (no hardcoded English strings)
- ✅ Use semantic locators / role queries (no `getByTestId` in R38 specimens)
- ✅ Load cleanly under their respective runners (Vitest 100/100 + 2 skipped; Playwright collects all 12 new tests)
- ✅ Reuse 1-7b infrastructure: `assertI18nParity`, locale JSON, `auth.setup.ts` storageState, design-system + cross-subdomain Playwright projects

No active passing tests generated — strictly RED-phase compliant.

---

## Step 5: Validate & Complete — complete

### Checklist validation

- [x] Prerequisites satisfied: story file present, vitest + playwright configured, design-system + cross-subdomain projects in `playwright.config.ts`, jsdom URL set in `vitest.config.ts`.
- [x] Test files created at the paths the story spec calls for.
- [x] Checklist matches the R38-driven ACs (AC1 + AC8 — AC9 is CI config and validated via force-fail dry-run during dev per Task 10.2).
- [x] Tests generated as red-phase scaffolds and marked with `describe.skip` / `test.describe.skip`.
- [x] Story metadata (storyId, storyKey, storyFile, atddChecklistPath) captured in frontmatter for downstream `dev-story` handoff.
- [x] No orphaned browser sessions: Playwright `--list` is a static collect step; no `open` sessions launched.
- [x] Temp artifacts: none. All scaffolds live in the project tree under their intended permanent paths.

### Completion summary

| Item | Count |
|---|---|
| Test files generated | 3 |
| Total RED-phase test cases | 14 (2 Vitest + 10 Playwright design-system + 2 Playwright cross-subdomain) |
| Risks ≥6 mitigated | 1 (R38) |
| Vitest baseline | 100 passed + 2 skipped (was 100 passed) |
| Playwright design-system baseline | 13 passed + 10 skipped (was 13 passed) |
| Playwright cross-subdomain baseline | 3 passed + 2 skipped (was 3 passed) |
| DevDeps installed | 3 (vitest-axe, axe-core, @axe-core/playwright) |

### Key assumptions

1. **Vietnamese values for `app.errorBoundary.*` / `app.permissionDenied.*` / `app.notFound.*` will be reviewed by a Vietnamese-fluent reviewer in-PR.** The parity-coverage test asserts key PRESENCE, not value QUALITY. A machine-translated value passes parity but may fail human-quality review. Story 1-7c Task 1.3 explicitly documents this.
2. **The placeholder `LoginPage` from 1-7b currently renders `t('app.welcome')`.** Story 1-8 ships the real LoginPage with `t('auth.login.title')` as the H1. The bilingual smoke's `/login` H1 assertion will fail RED against the 1-7b placeholder; it goes GREEN only after Story 1-8 also lands. If activating the bilingual smoke BEFORE Story 1-8 ships, the dev must either: (a) skip the `/login` test individually, or (b) sequence Story 1-8 alongside Story 1-7c. Document the sequencing decision in the story's Change Log when activating.
3. **The `cross-subdomain` Playwright project requires `*.classlite.localhost` hosts** resolving to `127.0.0.1`. The Phase 0.4 setup documented this in `tests/e2e/README.md`. The new spec inherits the same hosts requirement.
4. **`@axe-core/playwright`'s default ruleset is WCAG 2.1 AA.** If the project later wants WCAG 2.2 or a stricter ruleset, `AxeBuilder({ page }).withTags([...])` configures it. Story 1-7c's AC7 mentions the `axe.allowlist.json` governance stub for known false positives — not consumed yet (empty rules list).
5. **The cross-subdomain `dashboard-boots-in-vi.spec.ts` will fail against the storageState's lang=en cookie cleanup** in some Playwright versions before 1.43. The spec includes a `.catch` fallback for the `clearCookies({ name: 'lang' })` form, but the installed `@playwright/test@^1.50.0` supports the filter so the fallback should never fire. Documented as belt-and-suspenders.

### Next recommended workflow

`/bmad-dev-story 1-7c` — the developer agent activates each RED scaffold as it works through Tasks 1–10 of Story 1-7c. The activation rhythm:

1. **Task 1.1** — replace `describe.skip` → `describe` in `i18n-parity-coverage.test.ts`. Run vitest. RED.
2. **Tasks 1.2–1.3** — add keys to en.json + vi.json. Run vitest. GREEN.
3. **Tasks 2–6** — implement layout components, ErrorBoundary swap, PermissionDenied, NotFound + catch-all, language cookie bridge. Each ships with inline component tests (AC2/AC3/AC4/AC5/AC6 inline executable contracts — NOT the ATDD red scaffolds).
4. **Task 9.1** — replace `test.describe.skip` → `test.describe` in `bilingual-smoke.spec.ts`. Run Playwright design-system. RED. Drive GREEN.
5. **Task 9.2** — replace `test.describe.skip` → `test.describe` in `dashboard-boots-in-vi.spec.ts`. Run Playwright cross-subdomain. RED. Drive GREEN.
6. **Task 10** — wire `npm run i18n-parity` into `.github/workflows/ci-web.yml`. Force-fail dry-run per Task 10.2.

After implementation: `/bmad-tea TA 1-7c` for fixture / MSW / role-negative expansion (component-level a11y + Loading/Empty/Error trilogy for downstream consumers — not 1-7c's scope, but the inherited surface).

After review: `/bmad-tea RV 1-7c` for flake-risk / hidden-assertion / hard-wait sweep.

At Epic 1C boundary: `/bmad-tea TR` for AC-to-test traceability + `/bmad-tea GATE` for the PASS/CONCERNS/FAIL decision before epic merges to main.

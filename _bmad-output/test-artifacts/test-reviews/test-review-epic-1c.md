---
stepsCompleted:
  - step-01-load-context
  - step-02-discover-tests
  - step-03-quality-evaluation
  - step-04-generate-report
lastStep: 'step-04-generate-report'
lastSaved: '2026-06-30'
workflowType: 'testarch-test-review'
inputDocuments:
  - '_bmad-output/planning-artifacts/epics/epic-01c-frontend-landing.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - '_bmad-output/test-artifacts/msw-handler-catalog-auth.md'
  - 'docs/project-context.md'
  - 'classlite-web/vitest.config.ts'
  - 'classlite-web/playwright.config.ts'
  - 'classlite-landing/vitest.config.ts'
  - 'classlite-landing/playwright.config.ts'
  - 'classlite-web/src/test/vitest-setup.ts'
knowledgeFragments:
  - 'test-quality.md'
  - 'timing-debugging.md'
  - 'selector-resilience.md'
  - 'test-healing-patterns.md'
---

# Test Quality Review: Epic 1C — Frontend Foundation & Landing Page

**Quality Score**: 94/100 (A — Excellent)
**Review Date**: 2026-06-30
**Review Scope**: suite (epic 1c — 9 stories: 1.7a/b/c, 1.8, 1.9a/b/c/d, 1.10)
**Reviewer**: Murat (TEA Agent)

---

> Note: This review audits existing tests; it does not generate tests.
> Coverage mapping and coverage gates are out of scope here. Use `trace` for coverage decisions.

## Executive Summary

**Overall Assessment**: Excellent

**Recommendation**: Approve with Comments — three P1 E2E flake-risk hotspots should be fixed before next CI hardening cycle; the broader unit/integration suite is production-ready.

### Key Strengths

✅ **Single mock seam discipline**: MSW at the HTTP boundary is the canonical seam across the entire web suite. Only 3 `vi.mock(...)` call sites exist in the whole epic (Sentry + ErrorBoundary + one InviteAcceptancePage narrow stub) — zero TanStack Query, Zustand, or hook mocks. Honors `docs/project-context.md` TEST-FE-1 verbatim.
✅ **Per-test query-client isolation**: Every component/hook test uses `createTestQueryClient()` and validates the global `queryClient` is never mutated (regression guard at `login.test.tsx:157`). Backed by an `afterEach` cache-clear in `vitest-setup.ts:60` as the suspenders.
✅ **i18n-aware selectors throughout**: Component tests select via `i18n.t(key)` — never hardcoded English. The `assertI18nParity` helper is wired into per-component tests in both web + landing, and the bilingual smoke E2E imports `en.json`/`vi.json` at test build time so a copy revision in the source of truth can't drift the test.

### Key Weaknesses

❌ **`networkidle` anti-pattern in 2 critical SPA E2E specs**: `route-bundle-boundaries.spec.ts:31,54` and `multi-tab-refresh.spec.ts:50-51` use `page.waitForLoadState('networkidle')` — broken in SPAs with HMR WebSocket and polling. Reproducible flake source.
❌ **3 `page.waitForTimeout()` calls in `landing.spec.ts`** (lines 69, 168, 176) for state transitions that Playwright's assertion auto-retry already handles deterministically.
❌ **5 auth `Page.test.tsx` files exceed the 300-line file-size advisory** (LoginPage 1107, InviteAcceptancePage 910, VerifyEmailPage 692, ResetPasswordPage 467, ForgotPasswordPage 347). Per-test sizes are fine; per-file navigation suffers.

### Summary

Epic 1C ships **80 test files across ~12,000 lines** — by far the most extensive surface the project has reviewed to date — covering shared layout/i18n (1.7c), 4 auth-UI flows (1.8/1.9a/b/c/d), 9 design-system Astro components (1.10), and the cross-subdomain auth foundation. The infrastructure is mature: MSW with `onUnhandledRequest: 'error'`, deterministic Zustand reset hooks, fake timers with `advanceTimersByTimeAsync` for all polling/countdown work, vitest-axe + AxeBuilder for component/page accessibility, and a documented MSW handler catalog at `_bmad-output/test-artifacts/msw-handler-catalog-auth.md` typed via `satisfies` against openapi-generated schemas. The visible weakness is concentrated in three E2E specs that rely on `networkidle`/`waitForTimeout` instead of event-based waits — these are textbook P1 flake vectors in SPAs and should be retired before the suite scales further. The non-E2E surface is exceptional.

---

## Quality Criteria Assessment

| Criterion                            | Status      | Violations | Notes |
|---|---|---|---|
| BDD Format (Given-When-Then naming)  | ✅ PASS     | 0   | Test names read like contract clauses ("renders H1 from `t("auth.login.title")`", "two tabs hitting 401 simultaneously fire ONE refresh"). |
| Test IDs (story/AC traceability)     | ✅ PASS     | 0   | Story/AC IDs embedded in `describe` blocks ("LoginPage Story 1-9d — Auth Error & Recovery States", "AC4 in-process coalesce"). |
| Priority Markers (P0/P1/P2/P3)       | ⚠️ WARN    | n/a | Priorities are encoded in story files + test-design QA, not on individual tests. Acceptable for a docs-driven workflow. |
| Hard Waits (sleep, waitForTimeout)   | ❌ FAIL    | 4   | 3 `waitForTimeout` in `landing.spec.ts` + 1 `setTimeout(_, 150)` in `multi-tab-refresh.spec.ts` (last is justified as race-condition fixture). |
| Determinism (no conditionals)        | ✅ PASS     | 0   | No flow-control conditionals; the `if`s found are all helper-internal (cookie restoration, type narrowing, parameter handling). |
| Isolation (cleanup, no shared state) | ✅ PASS     | 0   | Per-test Zustand reset, `server.resetHandlers()`, `queryClient.clear()`, `__resetAuthRefreshStateForTests()`, `localStorage.clear()`. RTL `cleanup()` registered manually. |
| Fixture Patterns                     | ✅ PASS     | 0   | Reusable helpers: `renderLogin`, `expandEmailForm`, `wrap(client)`, `fetchRoot`, `landTerminal`, `stubLocation` — extract setup without hiding assertions. |
| Data Factories                       | ✅ PASS     | 0   | MSW response constants (`MSW_USER`, `MSW_ACCEPT_INVITE_DEFAULT`) typed via `satisfies AcceptInviteResult` against openapi-generated schemas — a typecheck-driven factory. |
| Network-First Pattern                | ✅ PASS     | 0   | MSW handlers are global by default and overridden via `server.use(...)` BEFORE render. Multi-tab E2E sets `context.route(...)` before `Promise.all([page.goto, ...])`. |
| Explicit Assertions                  | ✅ PASS     | 0   | `expect()` lives in test bodies. Helpers extract data, not assertions. Custom-assertion helpers (`assertNoRawKeysInDom`) throw with rich error context. |
| Test File Length (≤300 lines)        | ❌ FAIL    | 5   | LoginPage 1107, InviteAcceptancePage 910, VerifyEmailPage 692, ResetPasswordPage 467, ForgotPasswordPage 347. Individual `test()` blocks are short. |
| Test Duration (≤1.5 min each)        | ✅ PASS     | 0   | Vitest unit suite is fast; fake timers used aggressively for any countdown/polling test. |
| Flakiness Patterns                   | ❌ FAIL    | 3   | `waitForLoadState('networkidle')` × 2 specs in SPAs; quiet-window `setTimeout(100)` in `LoginPage.test.tsx:597`. |

**Total Violations**: 0 Critical, 3 High, 5 Medium, 2 Low

---

## Quality Score Breakdown

```
Starting Score:           100
Critical Violations:      0 × 10  =   0
High Violations:          3 ×  5  = -15
Medium Violations:        5 ×  2  = -10
Low Violations:           2 ×  1  =  -2

Bonus Points:
  Excellent BDD:                   +5
  Comprehensive Fixtures:          +5
  Data Factories (satisfies-typed):+3
  Network-First (MSW + route):     +5
  Perfect Isolation (5 reset hooks):+5
  All Test IDs (data-testid first):+5
  Bonus subtotal:                  +28
  Bonus cap (top of curve):         +21

Final Score:              100 - 27 + 21 = 94 / 100
Grade:                    A
```

---

## Critical Issues (Must Fix)

No critical issues detected. ✅

---

## Recommendations (Should Fix)

### 1. Replace `waitForLoadState('networkidle')` with event-based waits in SPA bundle-boundary E2E

**Severity**: P1 (High)
**Location**: `classlite-web/e2e/route-bundle-boundaries.spec.ts:31,54`
**Criterion**: Flakiness Patterns / Determinism
**Knowledge Base**: [timing-debugging.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/timing-debugging.md) Example 1 (networkidle is unreliable in SPAs)

**Issue Description**:
This Vite-served React 19 + React Router app keeps the HMR WebSocket open in dev, and a `/api/__bait` dev route + storybook polling are also potential sources of in-flight requests. `networkidle` waits for 500ms of zero requests across **all** connections, which may never fire deterministically (timeouts CI-side) or fire prematurely if the WebSocket drops a heartbeat. The intent here is "wait until the bundles I care about have been requested" — which is event-based, not timing-based.

**Current Code**:

```typescript
// ❌ Bad — networkidle in an SPA with HMR
const requests: string[] = []
page.on('request', (req) => requests.push(req.url()))
await page.goto('/dashboard')
await page.waitForLoadState('networkidle')

const sawAuthLayout = requests.some((url) =>
  /\/AuthLayout-[\w-]+\.js/.test(url),
)
```

**Recommended Fix**:

```typescript
// ✅ Good — wait for the chunk the page legitimately needs, then snapshot
const requests: string[] = []
page.on('request', (req) => requests.push(req.url()))
const teacherChunkLoaded = page.waitForResponse((resp) =>
  /\/TeacherDashboard-[\w-]+\.js/.test(resp.url()) && resp.ok()
)
await page.goto('/dashboard')
await teacherChunkLoaded
// Now `requests` is complete with respect to the bundles that matter.
const sawAuthLayout = requests.some((url) =>
  /\/AuthLayout-[\w-]+\.js/.test(url),
)
expect(sawAuthLayout, 'auth layout chunk leaked into /dashboard').toBe(false)
```

**Why This Matters**:
Bundle-boundary regressions are exactly the kind of bug this test exists to catch (a stray static import collapsing chunks). A flaky test that's been quarantined or retry-padded silently stops catching the regression it was written to guard against — the architectural lint dies in CI without anyone noticing.

**Related Violations**:
Same pattern at `multi-tab-refresh.spec.ts:50-51` — see recommendation #2.

---

### 2. Replace `networkidle` in multi-tab refresh E2E with explicit refresh-response wait

**Severity**: P1 (High)
**Location**: `classlite-web/e2e/multi-tab-refresh.spec.ts:50-51`
**Criterion**: Flakiness Patterns / Determinism
**Knowledge Base**: [timing-debugging.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/timing-debugging.md) Example 4 (anti-pattern: networkidle in SPAs)

**Issue Description**:
This is the load-bearing test for AC4 — proving `navigator.locks` + `lastRefreshedAt` debounce coalesces two tabs into one `/api/auth/refresh` call. The 150ms `setTimeout` inside the route fulfill is **correct** (it forces the race window). The `await Promise.all([page1.waitForLoadState('networkidle'), page2.waitForLoadState('networkidle')])` is what's wrong — neither tab is "done" loading in any meaningful SPA sense after a 401 → refresh dance.

**Current Code**:

```typescript
// ❌ Bad — networkidle in an SPA
await Promise.all([
  page1.locator('[data-testid="fire-bait"]').click(),
  page2.locator('[data-testid="fire-bait"]').click(),
])

await Promise.all([
  page1.waitForLoadState('networkidle'),
  page2.waitForLoadState('networkidle'),
])

expect(refreshCount).toBe(1)
```

**Recommended Fix**:

```typescript
// ✅ Good — poll the closure counter directly; expect.poll() retries to default timeout
await Promise.all([
  page1.locator('[data-testid="fire-bait"]').click(),
  page2.locator('[data-testid="fire-bait"]').click(),
])

// Wait for any refresh to actually fire (latency is 150ms by route fixture).
// Then assert no second one slipped past the lock.
await expect.poll(() => refreshCount, { timeout: 5000 }).toBeGreaterThanOrEqual(1)
// Give the in-process coalesce + BroadcastChannel debounce a small,
// bounded window to race a second call past — if it's going to happen,
// it happens within the 150ms route delay window.
await page1.waitForTimeout(300) // OK here: deliberately bounded race observation
expect(refreshCount).toBe(1)
```

(Alternatively, use a `page.waitForResponse('**/api/auth/refresh')` against one of the two pages, then sleep briefly for the second-call race window.)

**Why This Matters**:
If `networkidle` returns spuriously early, the second tab's refresh attempt may not have landed yet — false green. If it hangs on an HMR socket, the test fails for the wrong reason and gets retry-padded into uselessness.

---

### 3. Replace 3 `waitForTimeout()` calls in `landing.spec.ts` with assertion auto-retry

**Severity**: P1 (High)
**Location**: `classlite-landing/e2e/landing.spec.ts:69, 168, 176`
**Criterion**: Hard Waits / Determinism
**Knowledge Base**: [timing-debugging.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/timing-debugging.md) Example 3 (hard-wait anti-patterns)

**Issue Description**:

Three locations use `page.waitForTimeout()` for state transitions that Playwright's assertion auto-retry would handle deterministically:

- Line 69: 200ms wait after `window.scrollTo(0, 600)` before asserting `is-stuck` class — IntersectionObserver delay.
- Line 168: 150ms wait between two `boundingBox()` measurements to assert no CLS — measuring before/after.
- Line 176: 100ms wait before asserting `replaceState` stripped the `?session_expired` query param.

**Current Code**:

```typescript
// ❌ Bad — line 69
await page.evaluate(() => window.scrollTo(0, 600))
await page.waitForTimeout(200) // "give IntersectionObserver one frame"
await expect(header).toHaveClass(/is-stuck/)

// ❌ Bad — line 176
await page.goto(`${BASE}/vi/?session_expired=true`)
await page.waitForTimeout(100)
expect(page.url()).not.toContain('session_expired')
```

**Recommended Fix**:

```typescript
// ✅ Good — assertion auto-retries up to default 5s expect.timeout
await page.evaluate(() => window.scrollTo(0, 600))
await expect(header).toHaveClass(/is-stuck/)  // built-in retry handles IO delay

// ✅ Good — use expect.poll for URL change
await page.goto(`${BASE}/vi/?session_expired=true`)
await expect.poll(() => page.url(), { timeout: 1000 }).not.toContain('session_expired')
```

For the CLS-measurement case at line 168, this is harder — the test deliberately wants to measure boundingBox at two distinct moments. A cleaner approach is `requestAnimationFrame`-driven via `page.evaluate`:

```typescript
// ✅ Good — pin to 2 consecutive paints, not wall-clock time
const initial = await hero.boundingBox()
await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())))
const after = await hero.boundingBox()
expect(initial?.y).toBe(after?.y)
```

**Why This Matters**:
These are the kind of waits that pass locally and fail in CI on a slow runner. They also obscure intent — `200ms` says nothing about what we're actually waiting for.

---

### 4. Split the five largest auth `Page.test.tsx` files per story/AC group

**Severity**: P2 (Medium)
**Location**: `classlite-web/src/features/auth/__tests__/LoginPage.test.tsx` (1107 lines), `InviteAcceptancePage.test.tsx` (910), `VerifyEmailPage.test.tsx` (692), `ResetPasswordPage.test.tsx` (467), `ForgotPasswordPage.test.tsx` (347)
**Criterion**: Test File Length
**Knowledge Base**: [test-quality.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md) Example 4 (test length limits)

**Issue Description**:
Individual `test()` blocks are reasonably sized (10-60 lines each). The aggregate file sizes are the issue. `LoginPage.test.tsx` is now a junk drawer for Story 1-8 AC4 (login form contract) + Story 1-9d AC1 (lockout) + AC2 (OAuth mismatch) + AC3 (workspace blocked) + AC4 (session expiry). Navigation is painful, and the cookie-clear `StrictMode` test at line 1031–1106 reproduces enough of the test harness inline that it would benefit from its own file.

**Recommended Improvement**:

```
classlite-web/src/features/auth/__tests__/
  LoginPage.test.tsx                  ← Story 1-8 AC4 only (~400-500 lines)
  LoginPage.recovery.test.tsx         ← Story 1-9d AC1-AC4 only (~500 lines)
  InviteAcceptancePage.test.tsx       ← Story 1-9c AC1-AC5 (~500 lines)
  InviteAcceptancePage.privacy.test.tsx ← privacy ratchet (Amelia party-mode) suite
  VerifyEmailPage.test.tsx            ← Story 1-9a AC1-AC4 (~400 lines)
  VerifyEmailPage.polling.test.tsx    ← AC5 terminal-state + late-response races
```

Shared fixtures (`renderLogin`, `expandEmailForm`, `UrlProbe`) move to `features/auth/__tests__/helpers.tsx` — these are already extracted patterns; making them shared across the split files is mechanical.

**Benefits**:
- Faster navigation in IDEs (jump-to-file → 400 lines, not 1100)
- Faster mental model load — each file is one AC group
- Easier diff review on PRs touching one AC

**Priority**:
P2 because individual test quality is high; this is an organization-level improvement, not a correctness fix.

---

### 5. Replace `region.querySelector(...)` and `container.querySelector(...)` with RTL semantic queries

**Severity**: P2 (Medium)
**Location**:
- `classlite-web/src/features/auth/__tests__/LoginPage.test.tsx:154,155,458,488` (`region.querySelector('[data-testid="..."]')`, `banner.querySelector('svg')`)
- `classlite-web/src/components/shared/__tests__/AppLayout.test.tsx:113,128` (`container.querySelector('a[href="#main-content"]')`, `container.querySelector('main')`)
- `classlite-web/src/components/shared/__tests__/NotFound.test.tsx:26` (`container.querySelector('main[role="main"]')`)
- `classlite-web/src/features/auth/__tests__/ForgotPasswordPage.test.tsx:200,215` (`container.querySelector('[data-testid="forgot-password-sent"]')`)

**Criterion**: Selector Resilience / Maintainability
**Knowledge Base**: [selector-resilience.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/selector-resilience.md) Example 1 (selector hierarchy: testid > ARIA > text > CSS)

**Issue Description**:
RTL exposes `within(region).getByTestId(...)` and `screen.getByRole('main')` as semantic, scoped equivalents. Falling back to `container.querySelector` couples the test to DOM internals and bypasses the auto-retry/error-text behavior the RTL queries provide.

The `svg` selector cases (`banner.querySelector('svg')`) are slightly different — SVGs don't have a native ARIA role; here a `getByTestId('banner-icon')` would be the idiomatic replacement after adding a `data-testid` on the SVG.

**Current Code**:

```typescript
// ⚠️ LoginPage.test.tsx:154-155
const region = screen.getByRole('region', { name: i18n.t('auth.login.title') })
const google = region.querySelector('[data-testid="google-oauth-cta"]')
const trigger = region.querySelector('[data-testid="collapsible-email-trigger"]')
```

**Recommended Improvement**:

```typescript
// ✅ Better — RTL idiom with scoped within()
import { within } from '@testing-library/react'
const region = screen.getByRole('region', { name: i18n.t('auth.login.title') })
const google = within(region).getByTestId('google-oauth-cta')
const trigger = within(region).getByTestId('collapsible-email-trigger')
```

```typescript
// ✅ Better — NotFound.test.tsx:26
expect(screen.getByRole('main')).toBeInTheDocument() // ARIA-first, no querySelector
```

**Benefits**:
- Consistent with the rest of the suite (which uses `screen.getByRole` / `getByTestId` heavily)
- Better error messages on failure ("Unable to find a `main` landmark" vs. "Expected null not to be null")
- Auto-retry for async DOM updates

**Priority**:
P2 because it's a stylistic fix in <1% of the assertion surface. Worth doing during a routine pass.

---

### 6. Use `vi.waitFor` instead of `setTimeout(_, 10|50)` BroadcastChannel-drain in `auth-refresh-locks.test.ts`

**Severity**: P2 (Medium)
**Location**: `classlite-web/src/lib/__tests__/auth-refresh-locks.test.ts:112, 138, 161, 243`
**Criterion**: Determinism
**Knowledge Base**: [timing-debugging.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/timing-debugging.md) Example 2 (deterministic waiting)

**Issue Description**:
Four call sites use `await new Promise((resolve) => setTimeout(resolve, 10))` (one is `50`) to "drain microtasks + message-bus delivery" after a `BroadcastChannel.postMessage`. This is correct in spirit — `BroadcastChannel` message delivery is async — but `setTimeout(_, 10)` is a fixed wall-clock wait, not an assertion-driven wait.

**Current Code**:

```typescript
// ⚠️ auth-refresh-locks.test.ts:112
sender.postMessage({ type: 'refresh-succeeded', timestamp: Date.now(), data: payload })
await new Promise((resolve) => setTimeout(resolve, 10))
expect(setSpy).toHaveBeenCalledWith(['auth', 'session'], payload)
```

**Recommended Improvement**:

```typescript
// ✅ Better — let the assertion's retry budget handle delivery latency
import { waitFor } from '@testing-library/react'
sender.postMessage({ type: 'refresh-succeeded', timestamp: Date.now(), data: payload })
await waitFor(() => {
  expect(setSpy).toHaveBeenCalledWith(['auth', 'session'], payload)
})
```

**Benefits**:
- No magic 10ms number — the assertion retries to a sensible default
- Works on slow CI runners without padding the wait
- Failures point at the specific assertion that didn't converge

**Priority**:
P2 — these are not currently flaky in practice (jsdom in-process BroadcastChannel is fast), but the pattern propagates.

---

### 7. `setTimeout(100)` quiet-window assertion in `LoginPage.test.tsx:597` is brittle

**Severity**: P2 (Medium)
**Location**: `classlite-web/src/features/auth/__tests__/LoginPage.test.tsx:597`
**Criterion**: Determinism / Flakiness Patterns
**Knowledge Base**: [test-quality.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md) Example 1 (deterministic test pattern)

**Issue Description**:
The test "no-redirect during quiet window" is a "wait briefly, then assert absence" pattern — inherently hard to make deterministic. The current approach waits 100ms then asserts `test-route-dashboard` isn't rendered.

**Current Code**:

```typescript
void runBootProbe()
renderLogin({ client })
await new Promise((r) => setTimeout(r, 100))
expect(screen.queryByTestId('test-route-dashboard')).toBeNull()
resolveRefresh()
await screen.findByTestId('test-route-dashboard')
```

**Recommended Improvement**:

```typescript
// ✅ Better — use findByTestId with a short timeout and expect it to NOT resolve
void runBootProbe()
renderLogin({ client })
await expect(
  screen.findByTestId('test-route-dashboard', {}, { timeout: 100 }),
).rejects.toThrow()
resolveRefresh()
await screen.findByTestId('test-route-dashboard')
```

This makes the intent explicit ("dashboard route MUST NOT appear within the quiet window") and the timeout is a documented assertion property rather than a hidden setTimeout.

**Priority**:
P2 — works today, but the pattern is the textbook brittle absence-assertion that fails on busy CI runners.

---

### 8. `dashboard-boots-in-vi.spec.ts:90` swallows errors from `clearCookies({ name })`

**Severity**: P3 (Low)
**Location**: `classlite-web/tests/e2e/cross-subdomain/dashboard-boots-in-vi.spec.ts:90-96`
**Criterion**: Maintainability
**Knowledge Base**: [test-quality.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md) (avoid try-catch for flow control)

**Issue Description**:
`await context.clearCookies({ name: 'lang' }).catch(() => {})` deliberately swallows errors on the basis that Playwright <1.43 didn't support the `name` filter. The comment documents this honestly, but a future Playwright bump introducing a different filter shape would silently fail. Since `package.json` pins ≥1.50, the `.catch` is dead code that nonetheless catches future regressions.

**Recommended Improvement**:

```typescript
// ✅ Better — assert the version once at module load, then drop the .catch
await context.clearCookies({ name: 'lang' })
```

Or feature-detect:

```typescript
// ✅ Better — feature-detect the API shape
type ClearCookiesAPI = typeof context.clearCookies
const supportsNameFilter = (context.clearCookies.length ?? 0) > 0
if (supportsNameFilter) {
  await context.clearCookies({ name: 'lang' })
} else {
  // explicit overwrite fallback
  await context.addCookies([{ name: 'lang', value: '', domain: '.classlite.localhost', path: '/', expires: 0 }])
}
```

**Priority**:
P3 — works today, but `.catch(() => {})` is the kind of safety net that hides real regressions.

---

### 9. `login.test.tsx:94` MSW latency of 300ms is longer than needed

**Severity**: P3 (Low)
**Location**: `classlite-web/src/features/auth/api/__tests__/login.test.tsx:94`
**Criterion**: Test Duration

**Issue Description**:
The mutation-cache observation test uses a 300ms MSW delay to give the test room to read from the mutation cache mid-flight. 50ms is enough.

**Recommended Improvement**:

```typescript
await new Promise((r) => setTimeout(r, 50)) // 300 → 50ms; mutationCache read is sync
```

**Priority**:
P3 — total impact is sub-second across CI.

---

## Best Practices Found

### 1. MSW handler catalog with `satisfies` typecheck against openapi schemas

**Location**: `classlite-web/src/test/mocks/handlers.ts:54-83` + `_bmad-output/test-artifacts/msw-handler-catalog-auth.md`
**Pattern**: API-contract-driven mock factory
**Knowledge Base**: [data-factories.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/data-factories.md)

**Why This Is Good**:
The catalog document is the canonical contract for all auth endpoint mocks. Each MSW constant is typed via `satisfies AcceptInviteResult` (or similar) against the openapi-typescript-generated schema. When the backend ships an OpenAPI spec change, the frontend codegen produces new types and the mock constants fail to compile until updated — a human is forced to read the diff. This is the data-factory pattern at the contract level rather than the value level.

**Code Example**:

```typescript
// src/test/mocks/handlers.ts
export const MSW_ACCEPT_INVITE_DEFAULT = {
  accessToken: 'msw.invite.jwt',
  user: { ...MSW_USER, emailVerified: true },
  center: { name: 'MSW Center' },
} satisfies components['schemas']['AcceptInviteResult']
```

**Use as Reference**:
This pattern should be the default for every new feature's MSW seed data. Document the catalog under `_bmad-output/test-artifacts/msw-handler-catalog-{feature}.md`.

---

### 2. Per-test `createTestQueryClient()` + global-singleton isolation regression guard

**Location**: `classlite-web/src/features/auth/api/__tests__/login.test.tsx:157-167`
**Pattern**: Belt-and-suspenders cache isolation
**Knowledge Base**: [test-quality.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md) Example 2 (isolated test with cleanup)

**Why This Is Good**:
The suite uses `createTestQueryClient()` per test (belt). The vitest-setup.ts `afterEach` then clears the global singleton's cache (suspenders). On top of that, **a dedicated test asserts the global was never mutated** — catching regressions where a hook accidentally imports `queryClient` instead of consuming the provider.

**Code Example**:

```typescript
test('with createTestQueryClient(), the global queryClient is NOT mutated by the test (isolation regression guard)', async () => {
  const client = createTestQueryClient()
  const { result } = renderHook(() => useLogin(), { wrapper: wrap(client) })
  result.current.mutate({ email: 'leak@example.com', ... })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(globalQueryClient.getQueryData(authKeys.session())).toBeUndefined()
})
```

**Use as Reference**:
Mirror this regression-guard pattern in every feature that imports both `createTestQueryClient` and the singleton `queryClient`.

---

### 3. Fake-timer-based polling test with `advanceTimersByTimeAsync` for microtask drain

**Location**: `classlite-web/src/features/auth/hooks/__tests__/useVerificationPoller.test.tsx` (entire file)
**Pattern**: Deterministic polling with terminal-state ref race tests
**Knowledge Base**: [timing-debugging.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/timing-debugging.md)

**Why This Is Good**:
The 5-second `setInterval` poll is tested with `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(5_000)` — the **async** variant drains microtasks between ticks, which the sync version misses. The two "terminal-state ref drops late response" tests use MSW's `delay(6_000)` to inject a real race window, then `commitTerminal()` before the response resolves to prove the ref guard works.

**Code Example**:

```typescript
test('terminal-state-ref drops a late 200 verified:true response after commitTerminal(timeout)', async () => {
  server.use(
    http.get('/api/auth/verify-status', async () => {
      await delay(6_000)
      return HttpResponse.json({ data: { verified: true, email: 'a@a.com' } })
    }),
  )
  const { result } = renderHook(() => useVerificationPoller({ pollId: POLL_ID, enabled: true }), { wrapper: wrap(client) })
  await vi.advanceTimersByTimeAsync(5_000)
  result.current.commitTerminal('timeout')
  await vi.advanceTimersByTimeAsync(6_000)
  expect(result.current.lastResponse).toBeNull()
})
```

**Use as Reference**:
Any feature with `setInterval` / polling should follow this exact shape.

---

### 4. URL probe pattern for MemoryRouter URL state assertions

**Location**: `classlite-web/src/features/auth/__tests__/LoginPage.test.tsx:42-66`
**Pattern**: Test-only probe component embedded in MemoryRouter
**Knowledge Base**: [selector-resilience.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/selector-resilience.md)

**Why This Is Good**:
MemoryRouter doesn't update `window.location`, so URL-state assertions need a custom probe. The `UrlProbe` component reads `useSearchParams()` and emits each banner-signal query param into its **own** `data-testid` (`url-error-param`, `url-verified-param`, `url-reset-param`, etc.). The prior single `url-error-param` allowed `?reset=1` clear-tests to pass while only the `error` branch ran (code-review P6). The split is a deliberate vacuous-pass guard.

**Code Example**:

```typescript
function UrlProbe() {
  const [searchParams] = useSearchParams()
  return (
    <>
      <span data-testid="url-error-param">{searchParams.get('error') ?? ''}</span>
      <span data-testid="url-verified-param">{searchParams.get('verified') ?? ''}</span>
      <span data-testid="url-reset-param">{searchParams.get('reset') ?? ''}</span>
      <span data-testid="url-invited-param">{searchParams.get('invited') ?? ''}</span>
      <span data-testid="url-session-expired-param">{searchParams.get('session_expired') ?? ''}</span>
      <span data-testid="url-next-param">{searchParams.get('next') ?? ''}</span>
    </>
  )
}
```

**Use as Reference**:
Replicate when any feature uses URL-driven state branches that need test-side observability.

---

### 5. Vacuous-pass guards in `route-bundle-boundaries.spec.ts`

**Location**: `classlite-web/e2e/route-bundle-boundaries.spec.ts:102-113, 149-166, 205-216`
**Pattern**: Hard-fail when input arrays are empty (before `not.toContain` assertions)
**Knowledge Base**: [test-quality.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md) (explicit assertions)

**Why This Is Good**:
The `expect(studentContents).not.toContain(verifyChunkBasename)` check passes vacuously if the dashboard chunk array is empty (`.join('\n')` returns `''`). The test pre-asserts each chunk array is non-empty, surfacing missing builds as a hard fail instead of a silent pass.

**Code Example**:

```typescript
expect(
  studentChunkFiles.length,
  'student dashboard chunk missing from dist/',
).toBeGreaterThan(0)
```

**Use as Reference**:
Any test using "must not contain" against derived content should pre-assert the derived content is non-empty.

---

### 6. Per-component i18n parity helper (`assertI18nParity` / `assertLandingI18nParity`)

**Location**: `classlite-web/src/lib/test/i18n-parity.ts`, `classlite-landing/src/lib/test/landing-i18n-parity.ts`
**Pattern**: Shared assertion contract for both locales
**Knowledge Base**: project-context.md TEST-FE-4

**Why This Is Good**:
Each component test that calls `t(...)` declares its full key list as a `const` array and runs `assertI18nParity(keys, ['en', 'vi'])`. The helper asserts every key exists in **both** locales and resolves to a non-empty string. This is the per-component layer of the R38 (Vietnamese-user-sees-raw-key) defense-in-depth — the bilingual-smoke E2E catches drift at the page level; this catches it at the component level.

**Code Example**:

```typescript
// PricingCard.test.ts (landing)
import { assertLandingI18nParity } from '../../../lib/test/landing-i18n-parity'

const STORY_1_10_KEYS = ['pricing.popularBadge', 'pricing.free.priceMonthly', ...] as const

describe('PricingCard — i18n parity', () => {
  test('every key resolves to a non-empty string in both locales', () => {
    assertLandingI18nParity(STORY_1_10_KEYS, ['vi', 'en'])
  })
})
```

**Use as Reference**:
Every new component that calls `t(...)` adds its keys to a `STORY_X_KEYS` const + parity test. The handful-of-lines pattern keeps R38 mitigation honest.

---

### 7. Cross-domain locale JSON import at test build time

**Location**: `classlite-web/tests/e2e/cross-subdomain/dashboard-boots-in-vi.spec.ts:42-46`, `classlite-web/e2e/bilingual-smoke.spec.ts:45-46`
**Pattern**: Single-source-of-truth assertion values
**Knowledge Base**: project-context.md TEST-FE-4

**Why This Is Good**:
The dashboard-boots-in-vi spec imports `enLocale` and `viLocale` at test build time and asserts on the resolved value (`page.locator('h1').toContainText(VI_WELCOME)`) instead of hardcoded English. A copy revision in the source of truth doesn't break the test; a missing translation key still fails.

**Code Example**:

```typescript
import enLocale from '../../../src/locales/en.json' with { type: 'json' }
import viLocale from '../../../src/locales/vi.json' with { type: 'json' }

const EN_WELCOME = (enLocale as Record<string, string>)['app.welcome']
const VI_WELCOME = (viLocale as Record<string, string>)['app.welcome']

await expect(page.locator('h1')).toContainText(VI_WELCOME)
```

**Use as Reference**:
Use for any E2E test that needs to assert on visible text — never hardcode the English string.

---

### 8. Cycle-loop termination assertion via `framenavigated`

**Location**: `classlite-landing/e2e/landing.spec.ts:120-155`
**Pattern**: Murat STRONG #3 — assert exact navigation count, not "≤ 3"
**Knowledge Base**: timing-debugging.md (deterministic state observation)

**Why This Is Good**:
The hint-cookie redirect cycle-loop bug would manifest as 3+ navigations between landing and dashboard. A `≤ 3` assertion would pass at 2 or 3 — and a real bug producing exactly 3 wouldn't fail. The test pins the exact count (2) and the exact final URL pattern via `framenavigated` listener. P26 from code review.

**Code Example**:

```typescript
const navigations: string[] = []
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) navigations.push(frame.url())
})
// ...
await page.getByTestId('landing-session-expired-banner-cta').click()
await page.waitForURL(/my\.classlite\.localhost.*\/login/)
expect(page.url()).toMatch(/my\.classlite\.localhost.*\/login/)
expect(navigations).toHaveLength(2)
```

**Use as Reference**:
For any redirect/cycle test, assert the **exact** terminal URL and the **exact** navigation count.

---

## Test File Analysis

### Suite Inventory

- **Total files in scope**: 80 (70 unit/integration + 10 E2E)
- **Total lines**: ~12,000
- **Test framework**: Vitest 4 + jsdom (unit/integration), Playwright (E2E)
- **Language**: TypeScript (strict)

### Distribution by Story

| Story | Test files | Lines | Notable patterns |
|---|---|---|---|
| 1.7a (Design tokens) | 4 | 1,200 | Design-system Playwright E2E (theme/typography resolution); `fileParallelism: false` for tokens.css mutation race |
| 1.7b (App shell) | 9 | 2,300 | `auth-refresh-locks` (8 tests), `query-client-refresh` (6 tests), useAuth/useLanguageInit/useHintCookieWrite |
| 1.7c (Layout + i18n) | 6 | 800 | AppLayout, ErrorBoundary, PermissionDenied, NotFound, LanguageToggle, i18n-parity helper |
| 1.8 (Auth UI base) | 12 | 1,800 | AuthCard, GoogleOAuthButton, CollapsibleEmailForm, PasswordInput/StrengthBar, register API + page |
| 1.9a (Verify email) | 4 | 1,100 | `VerifyEmailPage` (692 lines), `useVerificationPoller` (192) — the polling-test reference impl |
| 1.9b (Password reset) | 6 | 900 | `ForgotPasswordPage`, `ResetPasswordPage`, schemas, useResendCountdown |
| 1.9c (Invite) | 4 | 1,200 | `InviteAcceptancePage` (910 lines) — 6 states tested; `acceptInvite` API |
| 1.9d (Auth recovery) | embedded in 1.8 LoginPage | ~600 lines added to LoginPage.test.tsx | Lockout / OAuth Mismatch / Workspace Blocked / Session Expiry |
| 1.10 (Astro landing) | 14 | 1,300 | 9 per-component i18n-parity tests (small), 4 lib unit tests, 3 E2E (landing/locale-redirect/dashboard-url) |

### Assertions Analysis

- 155 semantic queries (`getByRole`/`getByTestId`/`getByLabelText`/`getByText`) in the 3 biggest auth page tests
- 9 `container.querySelector` / `region.querySelector` calls (P2 cleanup target — see Recommendation #5)
- `vi.mock(...)` total: **3 narrowly scoped** (Sentry transport, ErrorBoundary error-fixture, InviteAcceptancePage one narrow case) — exemplary TEST-FE-1 compliance

---

## Context and Integration

### Related Artifacts

- **Epic file**: [_bmad-output/planning-artifacts/epics/epic-01c-frontend-landing.md](../../planning-artifacts/epics/epic-01c-frontend-landing.md)
- **Test design (QA)**: [_bmad-output/test-artifacts/test-design/test-design-qa.md](../test-design/test-design-qa.md)
- **Handoff (per-epic AC patterns)**: [_bmad-output/test-artifacts/test-design/classlite_new-handoff.md](../test-design/classlite_new-handoff.md)
- **MSW handler catalog**: [_bmad-output/test-artifacts/msw-handler-catalog-auth.md](../msw-handler-catalog-auth.md)
- **ATDD checklists**: [atdd-checklist-1-7c-shared-layout-components-and-i18n.md](../atdd-checklist-1-7c-shared-layout-components-and-i18n.md), [atdd-checklist-1-5-login-session-password-reset.md](../atdd-checklist-1-5-login-session-password-reset.md)
- **Project context (testing rules)**: [docs/project-context.md](../../../docs/project-context.md) — TEST-FE-1..6, TEST-UX-1..4, TEST-BE-1..5

### Risk Coverage Notes (R38 / R-NEW-54)

- **R38 (Vietnamese-user-sees-raw-key, score 6)** is mitigated at three layers:
  1. CI `npm run i18n-parity` script (per-PR)
  2. `assertI18nParity` per-component (vitest)
  3. `bilingual-smoke.spec.ts` page-level scan with `RAW_KEY_REGEX`
- **R-NEW-54 (Vietnamese-tied locale default)** is covered by the `locale-redirect.spec.ts` ATDD with 5 explicit cases (vi-VN, en-US, tied q-weights, no Accept-Language, Vary header)

Coverage mapping is intentionally out-of-scope here — route to `/bmad-tea TR` for AC↔test traceability + gate decision.

---

## Knowledge Base References

This review consulted the following knowledge base fragments:

- **[test-quality.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md)** — Definition of Done for tests (no hard waits, <300 lines/test, <1.5 min, self-cleaning)
- **[timing-debugging.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/timing-debugging.md)** — Race condition fixes, network-first pattern, networkidle anti-pattern
- **[selector-resilience.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/selector-resilience.md)** — Selector hierarchy: testid > ARIA > text > CSS
- **[test-healing-patterns.md](../../../.claude/skills/bmad-testarch-test-review/resources/knowledge/test-healing-patterns.md)** — Common failure patterns and pattern-based fixes

For coverage mapping, consult `trace` workflow outputs.

---

## Next Steps

### Immediate Actions (Before Epic 1c gate)

1. **Replace 2 `waitForLoadState('networkidle')` calls** in `route-bundle-boundaries.spec.ts` and `multi-tab-refresh.spec.ts` with `page.waitForResponse(...)` / `expect.poll(...)` (see Recommendations #1 and #2).
   - Priority: P1
   - Owner: Frontend infra
   - Estimated Effort: 1-2 hours

2. **Replace 3 `page.waitForTimeout()` calls** in `landing.spec.ts:69,168,176` with assertion auto-retry / `requestAnimationFrame` pattern (see Recommendation #3).
   - Priority: P1
   - Owner: Landing team
   - Estimated Effort: 30-60 minutes

### Follow-up Actions (next iteration / refactor PR)

1. **Split the five largest auth `*.test.tsx` files** per story/AC group (see Recommendation #4).
   - Priority: P2
   - Target: Next epic-1c maintenance PR
   - Estimated Effort: 2-3 hours

2. **Replace `container.querySelector` / `region.querySelector` calls** with `within().getByTestId` / `screen.getByRole` (see Recommendation #5).
   - Priority: P2
   - Target: Routine cleanup PR
   - Estimated Effort: 30 minutes

3. **Convert `setTimeout(_, 10|50)` BroadcastChannel drains** to `waitFor(() => expect(...))` in `auth-refresh-locks.test.ts` (see Recommendation #6).
   - Priority: P2
   - Target: Routine cleanup PR

4. **Address the 100ms quiet-window pattern** in `LoginPage.test.tsx:597` (see Recommendation #7).
   - Priority: P2

### Re-Review Needed?

⚠️ **Re-review the 3 P1 E2E fixes** in a focused mini-RV (single-file scope) before the epic-1c GATE workflow. After that, no further re-review needed for the unit/integration suite — it's production-ready.

---

## Decision

**Recommendation**: Approve with Comments

**Rationale**:

Test quality is excellent at 94/100. The unit and integration surface (which is ~92% of the suite by line count) demonstrates mature patterns that should be exemplars for the rest of the project — single-seam MSW mocking, per-test query client isolation with a global-singleton regression guard, fake-timer-driven polling tests with terminal-state ref races, type-checked MSW factories against openapi schemas, and disciplined i18n key parity at three layers (CI script + per-component helper + page-level DOM scan).

The three P1 findings are all isolated to E2E specs using either `waitForLoadState('networkidle')` (broken in SPAs) or `page.waitForTimeout()` (textbook flake source). These do not block epic-1c approval — they pose a flakiness risk in CI that will erode confidence in the bundle-boundary and multi-tab refresh tests over time. Fix them before the next epic ships to prevent rot.

The five P2 file-size findings reflect organizational debt (one giant `LoginPage.test.tsx` per Story 1-9d AC layering) rather than test correctness issues; defer to a maintenance PR.

> Test quality is acceptable with 94/100 score. High-priority recommendations should be addressed but don't block merge. Critical issues resolved (none detected), but improvements would enhance maintainability and reduce CI flakiness exposure.

**Next recommended workflow**: After the P1 fixes land, run `/bmad-tea TR` (trace) for AC↔test mapping + epic-1c gate decision, then `/bmad-tea NR` (NFR audit) before the epic-1c merge.

---

## Appendix

### Violation Summary by Location

| Line | Severity | Criterion | Issue | Fix |
|---|---|---|---|---|
| `route-bundle-boundaries.spec.ts:31` | P1 | Flakiness | `waitForLoadState('networkidle')` in SPA | Replace with `waitForResponse('**/TeacherDashboard-*.js')` |
| `route-bundle-boundaries.spec.ts:54` | P1 | Flakiness | `waitForLoadState('networkidle')` in SPA | Same |
| `multi-tab-refresh.spec.ts:50-51` | P1 | Flakiness | `Promise.all([page1.waitForLoadState('networkidle'), page2.waitForLoadState('networkidle')])` | `expect.poll(() => refreshCount).toBeGreaterThanOrEqual(1)` then bounded race observation |
| `landing.spec.ts:69` | P1 | Hard Wait | `waitForTimeout(200)` after scroll | `await expect(header).toHaveClass(/is-stuck/)` (auto-retry) |
| `landing.spec.ts:168` | P2 | Hard Wait | `waitForTimeout(150)` between boundingBox measurements | `requestAnimationFrame` via `page.evaluate` |
| `landing.spec.ts:176` | P2 | Hard Wait | `waitForTimeout(100)` after replaceState | `await expect.poll(() => page.url()).not.toContain(...)` |
| `LoginPage.test.tsx:597` | P2 | Determinism | `setTimeout(100)` quiet-window absence assertion | `expect(findByTestId(..., {timeout: 100})).rejects.toThrow()` |
| `LoginPage.test.tsx` (file) | P2 | Length | 1107 lines | Split per story/AC group |
| `InviteAcceptancePage.test.tsx` (file) | P2 | Length | 910 lines | Split (base flow + privacy ratchet) |
| `VerifyEmailPage.test.tsx` (file) | P2 | Length | 692 lines | Split (base + polling/race) |
| `ResetPasswordPage.test.tsx` (file) | P2 | Length | 467 lines | Split if it grows further |
| `ForgotPasswordPage.test.tsx` (file) | P2 | Length | 347 lines | Borderline; keep watch |
| `LoginPage.test.tsx:154-155,458,488` | P2 | Selector | `region.querySelector('[data-testid="..."]')` / `banner.querySelector('svg')` | `within(region).getByTestId(...)` / add data-testid on SVG |
| `AppLayout.test.tsx:113,128` | P2 | Selector | `container.querySelector('main')` | `screen.getByRole('main')` |
| `NotFound.test.tsx:26` | P2 | Selector | `container.querySelector('main[role="main"]')` | `screen.getByRole('main')` |
| `ForgotPasswordPage.test.tsx:200,215` | P2 | Selector | `container.querySelector('[data-testid="forgot-password-sent"]')` | `within(container).getByTestId(...)` or remove (already asserted via findByTestId) |
| `auth-refresh-locks.test.ts:112,138,161,243` | P2 | Determinism | `setTimeout(_, 10\|50)` BroadcastChannel drains | `waitFor(() => expect(...))` |
| `dashboard-boots-in-vi.spec.ts:90` | P3 | Maintainability | `.catch(() => {})` swallows clearCookies errors | Drop the `.catch` (Playwright ≥1.43 pinned) or feature-detect |
| `login.test.tsx:94` | P3 | Performance | MSW handler `setTimeout(_, 300)` longer than needed | Reduce to 50ms |

### Related Reviews

| File / Group | Story | Score | Critical | Notes |
|---|---|---|---|---|
| Auth feature `*Page.test.tsx` (5 files) | 1.8 / 1.9a-d | 92/100 | 0 | File-size concentration; otherwise exemplary |
| `auth-refresh-locks` + `query-client-refresh` | 1.7b | 95/100 | 0 | Race condition coverage; minor microtask-drain pattern |
| Auth feature components (`AuthCard`, `GoogleOAuthButton`, `PasswordInput`, etc.) | 1.8 | 96/100 | 0 | Small focused tests; pattern reference |
| Landing Astro component tests (9 files) | 1.10 | 97/100 | 0 | Minimal, intentional i18n-parity-only |
| E2E (`landing.spec`, `route-bundle-boundaries`, `multi-tab-refresh`, `bilingual-smoke`) | 1.7c / 1.10 | 86/100 | 0 | P1 flakiness hotspots concentrated here |
| Shared layout (`AppLayout`, `ErrorBoundary`, `PermissionDenied`, `NotFound`, `LanguageToggle`) | 1.7c | 94/100 | 0 | Minor `container.querySelector` cleanup |
| Cross-subdomain E2E (`cookie-sharing`, `dashboard-boots-in-vi`) | 1.7c | 94/100 | 0 | `.catch(() => {})` swallowing; otherwise clean |
| Hook tests (`useAuth`, `useVerificationPoller`, `useLockoutCountdown`, `useResendCountdown`, etc.) | 1.7b / 1.9a-d | 96/100 | 0 | Fake-timer discipline is a project-wide reference |

**Suite Average**: 94/100 (A)

---

## Review Metadata

**Generated By**: Murat (TEA Agent — Master Test Architect)
**Workflow**: testarch-test-review v4.0
**Review ID**: test-review-epic-1c-20260630
**Timestamp**: 2026-06-30
**Version**: 1.0

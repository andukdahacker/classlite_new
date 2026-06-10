---
baseline_commit: 457aea5
---

# Story 1.7b: App Shell, Routing & State Management

Status: done

<!-- Validation is optional. Run `validate-create-story` for a second-pass quality check before `dev-story`. -->

> **Why this story matters far more than its size.** 1-7b establishes the **runtime spine** of every dashboard surface. After it lands, the question "where does this page mount?" has one answer (the router), "how does this component fetch data?" has one answer (TanStack Query with silent-refresh 401 handling), "how does this component hold ephemeral UI state?" has one answer (Zustand with `initialState` reset), and "where does this error get reported?" has one answer (Sentry with `request_id` breadcrumbs). Every Epic 1C UI story (1-7c, 1-8, 1-9a/b/c/d) and every Epic 2–10 feature mounts through this scaffold. **If the 401 silent-refresh contract is broken or the multi-tab race fix is wrong, every authenticated session in the product is at risk.** Read the architecture references before touching code.

> **Scaffold reality check (READ FIRST).** Story 1.1 already created partial deliverables and Story 1.7a layered the design system on top — you are NOT starting from a blank slate. The work is **rewire the runtime, add the four contracts (routing / query 401 / Zustand / Sentry), preserve everything 1-7a shipped**, not green-field. Specifically:
> - `classlite-web/src/main.tsx` already wires `<QueryClientProvider>` around `<App />` with the existing `queryClient` import. The Router provider is NOT yet in the tree.
> - `classlite-web/src/App.tsx` is a hand-rolled `useSyncExternalStore`-backed pathname switcher with ONE dev-only route (`/__theme-resolution`) and a fallback `welcome` div. There is NO real Router. This story REPLACES that pattern.
> - `classlite-web/src/lib/query-client.ts` is a bare `new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })`. There is NO 401 handler, NO retry policy, NO refresh-token mechanism, NO multi-tab coordination yet.
> - `classlite-web/src/lib/i18n.ts` initializes react-i18next with `en`/`vi` resources and `lng: 'en'` hardcoded — the language toggle + cookie wiring (UX-DR17) are explicitly DEFERRED to Story 1-7c, NOT this story. Do NOT add a language switcher in 1-7b.
> - `classlite-web/vite.config.ts` already proxies `/api` → `http://localhost:8080`. Verify only; do not touch.
> - `@sentry/react@^10.55.0` is already a dependency (installed by Story 1.1). It is NOT yet initialized anywhere in source. This story initializes it.
> - `react-router@^7.16.0` (the v7 library-mode package) is already installed. There is NO routes file yet.
> - `zustand@^5.0.14` is already installed. There is NO store yet.
> - `tests/e2e/cross-subdomain/cookie-sharing.spec.ts` exists from 1.5/Phase 0.4 — it stubs `classlite_session` + `lang` cookies via `auth.setup.ts`. Do NOT regress this test. (Cookie wiring is 1-7c; this story does not touch real auth cookies — see Decisions below.)
> - The dashboard's `classlite-web/index.html` still has a Google Fonts CDN `<link>` for Fraunces (legacy from Story 1.1). The dashboard now self-hosts Fraunces via `@fontsource-variable/fraunces` per 1-7a AC4. **Removing the index.html CDN block is in scope for this story (CQ-1 — dead code).**

> **Out of scope (deferred).** You are NOT building:
> - The `AppLayout` / `Sidebar` / `TopBar` / `UserPill` / `EmptyState` shared components — those are **Story 1-7c**.
> - The visible-UI `ErrorBoundary` with Sentry event ID rendering, the `PermissionDenied` screen, the `NotFound` screen — **Story 1-7c**. (You DO ship a minimal top-level error boundary class component so Sentry has a render-error capture surface — see AC6. The polished UI for it is 1-7c.)
> - The i18n language toggle UI, the `assertI18nParity` helper, the `.classlite.app` language cookie, the `vi`/`en` runtime switching — **Story 1-7c** (R38 owner).
> - The cross-domain Playwright project (landing + dashboard sharing `storageState`) — **Story 1-7c** (Epic 1C gate).
> - The axe-core CI step — **Story 1-7c**.
> - Any auth UI (login, register, forgot password, verification screens) — **Story 1-8 and 1-9a/b/c/d**.
> - Real Zustand cookie hydration for `languageStore` — **Story 1-7c**. (You ship the store with `initialState` export and a `setLanguage` action; persistence and `.classlite.app` cookie sync land in 1-7c.)
> - Regenerating `openapi-typescript` / `openapi-zod-client` artifacts — `scripts/codegen.sh` is **commented out for the frontend leg until Story 1-8** per 1-7a F3. The 1-7b `query-client.ts` uses a hand-written `fetch`-based `apiFetch` helper, not a generated client.
> - Adding actual feature routes (`/dashboard`, `/classes`, etc.) — those land per-feature in Epics 2–10. This story ships the **route table SHELL** with explicit lazy boundaries and three placeholder route stubs (`/`, `/login`, `/(dev) __theme-resolution`) so the boundaries are testable and the router contract is exercised, but it does NOT ship Auth or feature UI.

## Story

As a frontend developer,
I want React Router v7 (library mode) with lazy-loaded route chunks for student / teacher / auth boundaries, a TanStack Query client with a silent 401 → `/api/auth/refresh` retry path that is multi-tab safe via `navigator.locks` + `BroadcastChannel`, three Zustand stores (UI / editor / language) with exported `initialState` for test reset, and `@sentry/react` initialized with `request_id` breadcrumb propagation,
so that every authenticated screen mounted in subsequent stories (1-7c / 1-8 / 1-9a-d / Epics 2–10) inherits a correct routing tree, automatic auth recovery, clean client-state separation, and end-to-end error observability — with zero risk of concurrent-tab refresh-token rotation racing the auth backend, and zero risk of components silently bypassing TanStack Query or duplicating server state into Zustand.

## Acceptance Criteria (BDD)

> **Risk-score ≥6 check (per WF-8).** This story does NOT own any risk score ≥6:
> - **R38** (i18n parity, score 6) is owned by **Story 1-7c** per `classlite_new-handoff.md` line 162. The i18n init in `lib/i18n.ts` already exists (Story 1.1 / 1-7a baseline); we do NOT add the parity helper or `.classlite.app` cookie wiring here.
> - **R46** (cross-cutting CI guard, score 6) is owned by the DevOps cross-cutting bucket.
> - **R39** (Vite/Rolldown plugin) was partially exercised by 1-7a; 1-7b adds NO new Rolldown-sensitive plugin imports beyond what `react-router` already brings.
> - **R45** (CF cache wrong origin) is owned by 1-7c / Epic 1C cross-domain cookie work.
>
> **ATDD red-phase is therefore not WF-8-mandatory.** AC2/AC3/AC4 below DO ship Vitest + Playwright assertions that act as the executable contract for the lazy-boundary, the 401 silent-refresh sequence, and the multi-tab `navigator.locks` arbitration. Write those tests first, watch them go red, then drive them green. They are the only mechanism that prevents silent regressions across every subsequent Epic 1C / Epic 2–10 story.

### AC1: Vite dev server + API proxy preserved

**Given** the existing `classlite-web/vite.config.ts`,
**When** running `npm run dev`,
**Then** the Vite 8 dev server starts on `http://localhost:5173` with React Fast Refresh,
**And** any request to `/api/*` is proxied to `http://localhost:8080` with `changeOrigin: true` (the existing proxy block is preserved verbatim),
**And** `npm run build` succeeds (Rolldown bundles the new router + Sentry + Zustand store imports without plugin errors).

**And** the Google Fonts `<link>` for Fraunces in `classlite-web/index.html` is REMOVED (dead code — Fraunces is now self-hosted via `@fontsource-variable/fraunces` per 1-7a AC3 / AC4). The two `<link rel="preconnect">` lines for `fonts.googleapis.com` / `fonts.gstatic.com` are also removed. This honors CQ-1 (dead code is rejected) and removes a privacy / 4G-Vietnam external dependency from initial page load.

_Pre-commit smoke (Task 11.1):_ `npm run dev` boots without console errors, `npm run build` succeeds, `npx tsc --noEmit` is clean, and the design-system Playwright spec from 1-7a still passes on the migrated dev route (`/__theme-resolution`) — verifies the router migration did not break 1-7a's executable contracts.

### AC2: React Router v7 (library mode) — lazy bundle boundaries enforced

**Given** the file `classlite-web/src/routes.tsx` (NEW),
**When** inspecting route definitions,
**Then** routes use React Router v7's **library mode** (`createBrowserRouter` + `RouterProvider`), NOT framework mode (no `vite.config` plugin, no file-system routing).

**Rationale for library mode (PM decision — do not relitigate):** The dashboard is a Vite SPA with no SSR target. Framework mode adds Remix-style file conventions and a build-time route manifest that we do not need; library mode keeps the route table explicit and grep-able. Astro owns the landing site (SSG); the dashboard is library mode.

**And** the route table defines THREE explicit lazy bundle groups (via `lazy: async () => import(...)`), so that Rolldown emits three distinct route chunks:

| Group | Path pattern | Lazy import root | Why this group exists |
|---|---|---|---|
| **auth** | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify`, `/invite/:token` | `@/features/auth/AuthLayout` | Pre-auth UI loads before the user has a session; must not pull dashboard chunks. |
| **student** | `/student/*` (placeholder root only in this story) | `@/features/dashboard/StudentDashboard` | Mobile/4G students never need teacher/admin code. Bundle hygiene critical for Vietnam 4G (per architecture line 253). |
| **teacher** | `/dashboard`, `/teacher/*`, `/admin/*` (root + catch-all placeholders only in this story) | `@/features/dashboard/TeacherDashboard` | Teacher/owner/admin surfaces; the larger of the three chunks. |

**Three placeholder route stubs ship in this story** so Rolldown actually emits the three chunks and Playwright can assert the boundaries. Each placeholder is a single component that renders a heading via `react-i18next` (existing `app.welcome` key reused, no new locale keys added — Story 1-7c owns i18n key proliferation):
- `classlite-web/src/features/auth/AuthLayout.tsx` — renders `<Outlet />` inside a single `<main>` (NO `AuthCard` styling yet — that's 1-8). Child stub: `LoginPagePlaceholder.tsx` rendering one heading. Route: `/login`.
- `classlite-web/src/features/dashboard/StudentDashboard.tsx` — renders one heading. Route: `/student` (this story; the real route table grows in later stories).
- `classlite-web/src/features/dashboard/TeacherDashboard.tsx` — renders one heading. Route: `/dashboard` (default landing for authenticated teacher/admin/owner role; routing-level role gating ships in Story 2-6).

**And** a root index route at `/` is registered that performs a hard redirect to `/login` (via React Router v7 `redirect()` loader response) so the default landing of the dashboard is the auth path — matches the architecture's "auth first" boot sequence. Real role-aware redirect (owner/teacher/student dashboards) lands in Story 1-8 / Epic 2.

**And** the **DEV-only `/__theme-resolution` route from Story 1-7a is migrated INTO the router as a lazy route**, gated by `import.meta.env.DEV`. The migration:
1. Removes the bespoke `usePathname()` / `useSyncExternalStore` switch in `App.tsx`.
2. Removes the `DevRouteErrorBoundary` class component in `App.tsx` (replaced by the AC6 top-level error boundary).
3. Registers the route in `routes.tsx` ONLY when `import.meta.env.DEV` is truthy — Rolldown statically folds the conditional and the production bundle does not include the dev chunk (verified by Task 11.7 — `grep -r __theme-resolution dist/` returns no matches, same gate as 1-7a Task 11.9).
4. The 1-7a Playwright `design-system` project (`e2e/theme-resolution.spec.ts` + `e2e/typography-resolution.spec.ts`) continues to pass without modification — the router migration is transparent to the spec (same URL, same DOM).

**And** every route uses **lazy loading exclusively** — no eager imports of feature components from `routes.tsx`. The only eager imports in `routes.tsx` are `createBrowserRouter`, `RouterProvider`, `redirect`, types from `react-router`, and the AC6 error boundary.

_Pinned executable contract (write this test first):_ `classlite-web/e2e/route-bundle-boundaries.spec.ts` (Playwright, `design-system` project):

```ts
// Spec shape — dev implements
test('navigating to /dashboard does NOT load the auth chunk', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  // Assert no request URL contains the auth chunk's content-hash filename.
  // The chunk filename pattern is Rolldown's default (e.g. `auth-<hash>.js`);
  // assertion uses a substring match on the chunk's source-name prefix.
  expect(requests.some((u) => /\/auth-[a-z0-9]+\.js$/.test(u))).toBe(false)
})

test('navigating to /login does NOT load the dashboard chunk', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  expect(requests.some((u) => /\/teacher-dashboard-[a-z0-9]+\.js$/.test(u))).toBe(false)
  expect(requests.some((u) => /\/student-dashboard-[a-z0-9]+\.js$/.test(u))).toBe(false)
})

test('the production build does NOT include __theme-resolution', async () => {
  // Driven via the Task 11.7 grep gate, not Playwright. This test reads dist/
  // index manifest via fs and asserts the dev route chunk is absent.
})
```

_Why this matters:_ Without the lazy boundary assertion, agents will inevitably write `import { LoginPage } from '@/features/auth/LoginPage'` at the top of `routes.tsx` (the IDE auto-imports it), and Rolldown will collapse the chunks silently. The 4G-Vietnam bundle target (architecture line 253) is then quietly violated until someone runs a bundle-size audit months later. The boundary test catches it on the next CI run.

### AC3: TanStack Query — global 401 → silent refresh → retry contract (load-bearing change)

> **The most important AC in this story.** Every authenticated request in the entire product flows through this code path. A bug here either: (a) loses sessions silently when a 401 fires mid-request, (b) re-issues N concurrent `/api/auth/refresh` calls from N parallel queries and burns the refresh token, or (c) leaves the user on a half-rendered screen after a token expiry. The test contract below is the only protection against all three.

**Given** the file `classlite-web/src/lib/query-client.ts` (REWRITE — the current 9-line file is replaced),
**When** the dashboard makes a TanStack Query `fetch` (via the AC4 `apiFetch` wrapper) that receives a `401 Unauthorized` response,
**Then** the **single global refresh coordinator** (AC4) is invoked, NOT a per-query refresh attempt,
**And** if the refresh succeeds (`POST /api/auth/refresh` returns 200 + new cookies), the original failing request is retried exactly once with the new auth cookies; the user sees no error,
**And** if the refresh fails (4xx or 5xx response), the user is hard-redirected to `/login` via `window.location.assign('/login?session_expired=1')` (NOT `useNavigate` — the failing query may be outside a `<Router>` mount during boot), preserving the original target URL in `?next=` for restoration after re-login,
**And** concurrent failing queries during the same refresh window all WAIT on the single in-flight refresh promise and resolve together — they do NOT each fire their own refresh.

**Configuration:**

```ts
// classlite-web/src/lib/query-client.ts (shape — dev implements)
import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query'
import { onAuthFailure } from './auth-refresh'  // AC4 surface

// The QueryCache + MutationCache error handlers are the v5 idiom for global
// onError. The top-level `defaultOptions.queries.onError` was REMOVED from
// TanStack Query v5 — agents trained on v4 examples will write the wrong shape.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,         // project default, per project-context FW-3
      retry: (failureCount, error) => {
        // Never auto-retry on auth failures — onAuthFailure handles those.
        if (isAuthError(error)) return false
        return failureCount < 1
      },
    },
    mutations: {
      retry: false,             // mutations never auto-retry (per project-context FW-2)
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (isAuthError(error)) onAuthFailure(error)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isAuthError(error)) onAuthFailure(error)
    },
  }),
})

export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401
}
```

**And** the `staleTime: 30_000` project default established in 1-7a's review pass is preserved.

**And** components NEVER call `fetch()` or `axios` directly — all server calls go through the AC4 `apiFetch` helper which integrates with the refresh coordinator. This is enforced by ESLint (AC8).

_Pinned executable contract (Vitest + MSW — write this test first; the project's only mock seam per project-context TEST-FE-1):_

`classlite-web/src/lib/__tests__/query-client-refresh.test.ts`:

```ts
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { QueryClient } from '@tanstack/react-query'

// Spec shape — dev implements
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => server.resetHandlers())

test('401 → refresh succeeds → original request retried, no error surfaced', async () => {
  let callCount = 0
  server.use(
    http.get('/api/students', () => {
      callCount++
      if (callCount === 1) return new HttpResponse(null, { status: 401 })
      return HttpResponse.json({ data: [{ id: 'x' }] })
    }),
    http.post('/api/auth/refresh', () => new HttpResponse(null, { status: 200 })),
  )

  const data = await queryFn(['students'], () => apiFetch('/api/students'))
  expect(data.data).toEqual([{ id: 'x' }])
  expect(callCount).toBe(2)
})

test('401 → refresh fails → location.assign(/login?...) called, no retry', async () => {
  const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
  server.use(
    http.get('/api/students', () => new HttpResponse(null, { status: 401 })),
    http.post('/api/auth/refresh', () => new HttpResponse(null, { status: 401 })),
  )

  await expect(apiFetch('/api/students')).rejects.toThrow()
  expect(assignSpy).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?session_expired=1/))
})

test('N concurrent 401s → exactly ONE /api/auth/refresh call', async () => {
  let refreshCount = 0
  let firstReady: () => void
  const firstFired = new Promise<void>((r) => { firstReady = r })

  server.use(
    http.get('/api/students', () => new HttpResponse(null, { status: 401 })),
    http.get('/api/classes', () => new HttpResponse(null, { status: 401 })),
    http.get('/api/grades', () => new HttpResponse(null, { status: 401 })),
    http.post('/api/auth/refresh', async () => {
      refreshCount++
      firstReady!()
      await new Promise((r) => setTimeout(r, 50))
      return new HttpResponse(null, { status: 200 })
    }),
  )

  // Fire three parallel requests that all hit 401.
  const p = Promise.allSettled([
    apiFetch('/api/students'),
    apiFetch('/api/classes'),
    apiFetch('/api/grades'),
  ])
  await firstFired
  await p

  // Critical: exactly one refresh, not three.
  expect(refreshCount).toBe(1)
})
```

These three tests are the contract. They MUST be red on the baseline (9-line query-client.ts) and green after the AC3 + AC4 implementation. Concurrent-coalescing is the only non-trivial bit — implement it via a module-level `refreshPromise: Promise<void> | null` singleton, set on first 401 and cleared on settle.

### AC4: Multi-tab refresh coordination (UX-DR19) — `navigator.locks` + `BroadcastChannel`

> **The race this AC closes.** Without coordination across tabs: two browser tabs both make a request, both receive 401, both call `POST /api/auth/refresh` with the SAME refresh token, the server rotates the refresh token on the first call, the SECOND call fails because the refresh token has been revoked, and the SECOND tab kicks the user to `/login`. The user, who only clicked one button, is logged out with no warning. UX-DR19 mandates this never happens.

**Given** the file `classlite-web/src/lib/auth-refresh.ts` (NEW),
**When** an access-token-expiry 401 fires in ANY open tab of the dashboard,
**Then** the first tab to hit the 401 acquires the lock `navigator.locks.request('classlite_token_refresh', { mode: 'exclusive' }, async () => { ... })` and proceeds with the `POST /api/auth/refresh` call,
**And** all other tabs that hit a 401 in the meantime call `navigator.locks.request(...)` and BLOCK on the lock until tab #1 finishes,
**And** when tab #1's refresh succeeds, tab #1 posts a message `{ type: 'refresh-succeeded' }` to a `BroadcastChannel('classlite_auth')` channel; on receipt, all other tabs invalidate every query and re-fetch the failing request,
**And** when tab #1's refresh fails, tab #1 posts `{ type: 'refresh-failed' }`; on receipt, all other tabs call the AC3 `onAuthFailure` redirect path — every tab lands on `/login?session_expired=1` simultaneously.

**Implementation shape:**

```ts
// classlite-web/src/lib/auth-refresh.ts (shape — dev implements)
const CHANNEL_NAME = 'classlite_auth'
const LOCK_NAME = 'classlite_token_refresh'
const REFRESH_DEBOUNCE_MS = 5_000  // skip redundant refresh within this window

// Module-singleton — one BroadcastChannel per tab. Guard against the
// non-browser environment for jsdom test invocation.
const channel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel(CHANNEL_NAME)
  : null

// Module-singleton — coalesces concurrent in-process callers BEFORE
// the navigator.locks gate (AC3 concurrent-coalescing requirement).
let refreshPromise: Promise<RefreshResult> | null = null

// CRITICAL: the lock alone is NOT sufficient. Tab 1 acquires the lock,
// refreshes, releases. Tab 2 was blocked on the lock; now it acquires
// and would HAPPILY post a SECOND refresh — burning the rotation that
// Tab 1 just performed. The `lastRefreshedAt` debounce inside the lock
// callback skips that second network call, so the cross-tab invariant
// becomes "exactly one network refresh per token expiry across all tabs."
// Per-tab module-level value; updated by both local success AND the
// cross-tab `refresh-succeeded` broadcast (see listener below).
let lastRefreshedAt = 0

export async function refreshAccessToken(): Promise<RefreshResult> {
  if (refreshPromise) return refreshPromise

  refreshPromise = navigator.locks.request(
    LOCK_NAME,
    { mode: 'exclusive' },
    async (): Promise<RefreshResult> => {
      try {
        // Check-inside-the-lock — another tab may have refreshed us
        // during the lock wait. Skip the redundant network call.
        if (Date.now() - lastRefreshedAt < REFRESH_DEBOUNCE_MS) {
          return { ok: true }
        }
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        })
        if (res.ok) {
          lastRefreshedAt = Date.now()
          channel?.postMessage({ type: 'refresh-succeeded', timestamp: lastRefreshedAt })
          return { ok: true }
        }
        channel?.postMessage({ type: 'refresh-failed' })
        return { ok: false }
      } finally {
        refreshPromise = null
      }
    }
  )
  return refreshPromise
}

// Subscribe to cross-tab signals. Mounted once per tab, at module init.
channel?.addEventListener('message', (event) => {
  const msg = event.data as RefreshSignal
  if (msg.type === 'refresh-succeeded') {
    // Update the local debounce timestamp from the originating tab's
    // clock. NOT Date.now() — that would double-count the latency of
    // the broadcast delivery. Use the timestamp the originator stamped.
    lastRefreshedAt = msg.timestamp
    // Invalidate every query — they'll refetch with the new cookies.
    queryClient.invalidateQueries()
  } else if (msg.type === 'refresh-failed') {
    onAuthFailure(new AuthExpiredError())
  }
})
```

**The `lastRefreshedAt` invariant is the non-trivial bit — internalize before coding.** Without it, two tabs that hit 401 within 50ms produce TWO `/api/auth/refresh` calls (the first runs under the lock; the second waits, then runs under the lock when the first releases). The second call uses the SAME refresh token the first call already rotated — the server's reuse-detection treats this as a stolen token (per architecture line 219 + project-context SEC-2) and revokes the user's entire token family. The user gets logged out for "suspicious activity" when in reality the dashboard's own multi-tab coordinator misfired. The Playwright spec below catches it; the Vitest tests do not — review the Playwright assertion with extra care.

**And** the `BroadcastChannel` must be created exactly once per tab (module singleton), NOT on every store init — recreating the channel mid-session breaks message delivery.

**And** if `navigator.locks` is unavailable (older Safari versions that don't ship the Web Locks API — Safari ≤ 15.4), the code falls back to a single-process coalesce via the same `refreshPromise` singleton. Cross-tab races on those browsers are accepted (R45-adjacent — documented limitation). Track via:
```ts
const HAS_WEB_LOCKS = typeof navigator !== 'undefined' && 'locks' in navigator
```

**And** the `BroadcastChannel` and `navigator.locks` are guarded for `typeof window === 'undefined'` so jsdom-based Vitest runs do not throw on module load (the project's Vitest env is jsdom per `vitest.config.ts`).

_Pinned executable contract (Vitest, in-process simulation of multi-tab):_

`classlite-web/src/lib/__tests__/auth-refresh-locks.test.ts`:

```ts
test('two concurrent refresh calls in one tab coalesce to one fetch', async () => {
  // The in-process coalesce — guards AC3's "exactly one refresh" assertion
  // for the single-tab case. Multi-tab simulation is harder in Vitest;
  // covered by Playwright (see below).
  let count = 0
  server.use(http.post('/api/auth/refresh', async () => {
    count++
    await new Promise((r) => setTimeout(r, 30))
    return new HttpResponse(null, { status: 200 })
  }))

  await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()])
  expect(count).toBe(1)
})

test('falls back to in-process coalesce when navigator.locks is undefined', async () => {
  // @ts-expect-error — drop locks for this test only
  const realLocks = navigator.locks
  delete (navigator as { locks?: unknown }).locks
  try {
    let count = 0
    server.use(http.post('/api/auth/refresh', () => {
      count++
      return new HttpResponse(null, { status: 200 })
    }))
    await Promise.all([refreshAccessToken(), refreshAccessToken()])
    expect(count).toBe(1)
  } finally {
    ;(navigator as { locks?: unknown }).locks = realLocks
  }
})

test('BroadcastChannel signal triggers queryClient.invalidateQueries', () => {
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(() => Promise.resolve())
  const channel = new BroadcastChannel('classlite_auth')
  channel.postMessage({ type: 'refresh-succeeded', timestamp: Date.now() })
  // Allow microtask drain
  return new Promise((r) => setTimeout(r, 0)).then(() => {
    expect(invalidateSpy).toHaveBeenCalled()
    channel.close()
  })
})

test('lock callback skips network call when lastRefreshedAt is fresh', async () => {
  // Simulates the "Tab 2 acquires lock right after Tab 1 broadcasts success"
  // sequence. Without the debounce, Tab 2 would post a second refresh and
  // burn the rotated token.
  let count = 0
  server.use(http.post('/api/auth/refresh', () => {
    count++
    return new HttpResponse(null, { status: 200 })
  }))
  // Pre-arm the debounce as if a sibling tab just broadcast success.
  const channel = new BroadcastChannel('classlite_auth')
  channel.postMessage({ type: 'refresh-succeeded', timestamp: Date.now() })
  await new Promise((r) => setTimeout(r, 0))  // let the listener mutate lastRefreshedAt

  const result = await refreshAccessToken()
  expect(result.ok).toBe(true)
  expect(count).toBe(0)  // <<< the contract — no network call inside the debounce window
  channel.close()
})
```

**And** a Playwright spec **`e2e/multi-tab-refresh.spec.ts`** (NEW, `design-system` project — re-using the dev-only `/__theme-resolution` route as a mount surface for a synthetic 401 → success sequence; do NOT block this story on Story 1-8's real auth flow):

```ts
test('two tabs hitting 401 simultaneously fire ONE /api/auth/refresh', async ({ browser }) => {
  let refreshCount = 0
  // Mount a dev test route that exposes a button to fire a 401-bait request.
  // Implementation lives at /__multi-tab-test-bait, also DEV-gated.

  const context = await browser.newContext()
  await context.route('**/api/auth/refresh', async (route) => {
    refreshCount++
    await new Promise((r) => setTimeout(r, 100))  // hold the lock
    await route.fulfill({ status: 200 })
  })
  await context.route('**/api/__bait', (route) => route.fulfill({ status: 401 }))

  const page1 = await context.newPage()
  const page2 = await context.newPage()
  await Promise.all([page1.goto('/__multi-tab-test-bait'), page2.goto('/__multi-tab-test-bait')])
  await Promise.all([
    page1.locator('[data-testid="fire-bait"]').click(),
    page2.locator('[data-testid="fire-bait"]').click(),
  ])
  await page1.waitForLoadState('networkidle')
  await page2.waitForLoadState('networkidle')

  expect(refreshCount).toBe(1)  // <<< the contract
  await context.close()
})
```

A dev-only `/__multi-tab-test-bait` route, like `/__theme-resolution`, is registered via `import.meta.env.DEV` and excluded from production via the same `grep -r dist/` gate (Task 11.7). It mounts a single button that fires `apiFetch('/api/__bait')`. The route file lives at `src/features/multi-tab-test/MultiTabTestPage.tsx`; the spec file lives at `e2e/multi-tab-refresh.spec.ts`.

_Why a Playwright spec and not just Vitest:_ `BroadcastChannel` between two tab contexts is the part Vitest cannot simulate. The Playwright assertion is the only test that actually exercises the cross-tab message — and the cross-tab race is the entire reason UX-DR19 exists. Skipping this test would be skipping the whole point of AC4.

### AC5: `apiFetch` helper — single network entry point, ApiError type, request_id propagation

**Given** the file `classlite-web/src/lib/api-fetch.ts` (NEW),
**When** any component or hook needs to call the API,
**Then** it calls `apiFetch(path, options?)` — there is no other path. Raw `fetch()` and `axios` are ESLint-forbidden in `src/features/**` and `src/hooks/**` (AC8).

**Implementation shape:**

```ts
// classlite-web/src/lib/api-fetch.ts (shape — dev implements)
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string | null,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiFetchOptions extends RequestInit {
  // Set to true ONLY for the refresh call itself, to break the recursion.
  skipAuthRefresh?: boolean
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const { skipAuthRefresh, ...rest } = opts
  const res = await fetch(path, { credentials: 'include', ...rest })

  if (res.status === 401 && !skipAuthRefresh) {
    const refreshResult = await refreshAccessToken()
    if (refreshResult.ok) {
      // Retry original request exactly once.
      const retry = await fetch(path, { credentials: 'include', ...rest })
      return parseEnvelope<T>(retry)
    }
    throw new AuthExpiredError()
  }

  return parseEnvelope<T>(res)
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  const requestId = res.headers.get('x-request-id')
  if (res.ok) {
    const body = await res.json()
    return body.data as T  // architecture line 244 — envelope is `{ data, meta }`
  }
  const body = await res.json().catch(() => ({}))
  throw new ApiError(
    res.status,
    body?.error?.code ?? 'UNKNOWN',
    body?.error?.message ?? res.statusText,
    requestId,
    body?.error?.details,
  )
}
```

**And** the `apiFetch` helper unwraps the API envelope before returning to the caller (project-context TS-4 — components never see `.data.data`). Generic-typed return = the unwrapped `data` field. The `{ data, meta }` envelope is parsed inline; the `meta` block is currently dropped at this layer (TanStack Query stories that need pagination metadata land per-feature with explicit handling — Story 1-7b's helper covers the happy path).

**And** the `x-request-id` response header value (set by the Go API per architecture line 248) is attached to every `ApiError` as `error.requestId`. This is the cross-service correlation handle Sentry will use (AC6).

**And** dates are NOT parsed at this layer — they stay as ISO strings per project-context TS-6 (i18n formatter owns date display). Generated zod schemas (Story 1-8) will do per-field date handling.

_Pinned executable contract:_ `classlite-web/src/lib/__tests__/api-fetch.test.ts`:
- Test 1: 200 response with `{ data: [...], meta: {...} }` envelope → returns unwrapped `[...]`.
- Test 2: 422 response with `{ error: { code, message, details } }` → throws `ApiError` with the correct fields and `requestId` from the `x-request-id` response header.
- Test 3: 401 with `skipAuthRefresh: true` → throws `AuthExpiredError`, does NOT call `/api/auth/refresh`.
- Test 4: 401 without flag + successful refresh → retries the original request exactly once.
- Test 5: Network error (`server.use(http.get(..., () => HttpResponse.error()))`) → throws an `ApiError` with status 0 and code `NETWORK`.

### AC6: Sentry initialization + request_id breadcrumb + minimal top-level error boundary

**Given** the file `classlite-web/src/lib/sentry.ts` (NEW),
**When** the app boots (`main.tsx`),
**Then** `Sentry.init` is called BEFORE the React tree mounts, with:
- `dsn: import.meta.env.VITE_SENTRY_DSN` (env var read at build time — missing DSN is non-fatal, init silently no-ops so dev/local works without `.env`)
- `environment: import.meta.env.MODE` (`development` / `production` / etc.)
- `release: import.meta.env.VITE_RELEASE_SHA ?? 'dev'` (set by CI to the commit SHA — falls back for local dev)
- `tracesSampleRate: 0.1` (10% transaction sampling — conservative MVP default; tune post-launch)
- `integrations: [Sentry.browserTracingIntegration(), Sentry.httpClientIntegration()]`
- `beforeBreadcrumb: (b) => attachRequestId(b)` — see below

**And** the file `classlite-web/src/lib/api-fetch.ts` (AC5) attaches a Sentry breadcrumb on EVERY API call with `category: 'fetch'`, `data: { method, url, status, requestId }`. The `requestId` field is the value of the `x-request-id` response header — this is the cross-service correlation handle (architecture line 248). On error responses, the breadcrumb is captured along with the thrown `ApiError`.

**And** every `ApiError` thrown by `apiFetch` is reported to Sentry via `Sentry.captureException(error, { tags: { requestId: error.requestId, errorCode: error.code } })` — gives the support / debug pathway "give me the request ID from your error screen, I'll find it in Sentry AND in the Go API logs."

**And** a minimal top-level error boundary class component lives at `classlite-web/src/components/shared/RootErrorBoundary.tsx` (NEW), wrapping `<RouterProvider />` in `App.tsx`. The error boundary:
1. Catches render-time errors in any route's lazy chunk or component tree.
2. Calls `Sentry.captureException(error, { contexts: { react: { componentStack } } })` in `componentDidCatch`.
3. Renders a SIMPLE fallback — `<div role="alert"><p>{t('app.errorFallback')}</p></div>` — no Sentry event ID display, no retry button, no styling beyond what flows from the existing token theme. The **polished `ErrorBoundary` with Sentry event ID + retry CTA** is Story 1-7c's `components/shared/ErrorBoundary.tsx` per the Epic 1C scope (lines 145–150 of `epic-01c-frontend-landing.md`).
4. Adds the i18n key `app.errorFallback` to BOTH `en.json` and `vi.json` (you ARE allowed to add this one key here even though i18n parity tooling lands in 1-7c — the key is needed for the boundary to render at all; record in Dev Notes).

**And** the 1-7a `DevRouteErrorBoundary` class in `App.tsx` is REMOVED — the new `RootErrorBoundary` covers the dev route too once it's a real lazy router child (per AC2).

_Pinned executable contract:_ `classlite-web/src/lib/__tests__/sentry-breadcrumb.test.ts`:
- Test 1: `apiFetch('/api/students')` returning 200 → a Sentry breadcrumb is added with `data.requestId` matching the `x-request-id` response header.
- Test 2: `apiFetch('/api/students')` returning 422 → `Sentry.captureException` is called with `tags.requestId` matching the response header AND `tags.errorCode === 'VALIDATION_ERROR'`.

**Manual verification** (record in Dev Agent Record per the 1-7a pattern): set `VITE_SENTRY_DSN` to a real DSN in `.env.local`, run `npm run dev`, navigate to `/dashboard`, trigger a thrown ApiError via the dev test bait route, observe the event landing in the Sentry dashboard within ~30s with `requestId` and `errorCode` tags. Screenshot the event detail page.

### AC7: Zustand stores — three concerns, `initialState` exported, no server data, no cross-store imports

**Given** the directory `classlite-web/src/stores/` (NEW),
**When** inspecting Zustand store files,
**Then** exactly THREE stores exist, each in its own file, each exporting BOTH the hook AND the `initialState` object (per project-context TEST-FE-3 — stores must reset cleanly between tests):

| Store file | State shape | Actions | What it must NEVER hold |
|---|---|---|---|
| `uiStore.ts` | `{ sidebarCollapsed: boolean, openModalId: string \| null, toastQueue: Toast[] }` | `setSidebarCollapsed(b)`, `openModal(id)`, `closeModal()`, `pushToast(t)`, `dismissToast(id)` | Any server-derived data (`students`, `classes`, etc.) — that lives in TanStack Query cache (project-context FW-5, architecture line 463). |
| `editorStore.ts` | `{ saveStatus: 'idle' \| 'saving' \| 'saved' \| 'error', dirty: boolean, lastSavedAt: string \| null }` | `setSaveStatus(s)`, `markDirty()`, `markSavedAt(ts)` | The actual document content (autosave debounced TanStack Query mutation owns content — architecture line 461). |
| `languageStore.ts` | `{ language: 'en' \| 'vi' }` | `setLanguage(lng)` | The cookie sync, the `i18n.changeLanguage` side effect, the `.classlite.app` cookie wiring — those are **Story 1-7c** (UX-DR17). 1-7b ships a pure state holder; the side-effect wiring is 1-7c's add. The `setLanguage` action mutates the store only. |

**Implementation shape (single example — `uiStore.ts`):**

```ts
// classlite-web/src/stores/uiStore.ts
import { create } from 'zustand'

export interface UIState {
  sidebarCollapsed: boolean
  openModalId: string | null
  toastQueue: Toast[]
}

export interface UIActions {
  setSidebarCollapsed: (collapsed: boolean) => void
  openModal: (id: string) => void
  closeModal: () => void
  pushToast: (toast: Toast) => void
  dismissToast: (id: string) => void
}

// EXPORTED — every Vitest test file resets via:
//   beforeEach(() => useUIStore.setState(initialState, true))
export const initialState: UIState = {
  sidebarCollapsed: false,
  openModalId: null,
  toastQueue: [],
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  ...initialState,
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  openModal: (openModalId) => set({ openModalId }),
  closeModal: () => set({ openModalId: null }),
  pushToast: (toast) => set((s) => ({ toastQueue: [...s.toastQueue, toast] })),
  dismissToast: (id) =>
    set((s) => ({ toastQueue: s.toastQueue.filter((t) => t.id !== id) })),
}))
```

**And** the three stores have ZERO cross-imports — `editorStore.ts` does NOT import `useUIStore`; `languageStore.ts` does NOT import `useUIStore`; etc. (project-context FW-5 — circular Zustand imports break React 19 concurrent-mode hydration). Cross-store composition happens in components: `function Toolbar() { const sidebar = useUIStore(s => s.sidebarCollapsed); const status = useEditorStore(s => s.saveStatus); ... }`.

**And** no store imports `queryClient` or invokes `queryClient.invalidateQueries` (project-context FW-6 — Zustand never triggers TanStack Query cache changes; invalidation belongs in `useMutation` callbacks).

**And** stores use SELECTOR FUNCTIONS by every consumer — never `const state = useUIStore()` (whole-store subscription causes infinite re-renders under React 19 concurrent rendering). The `RootErrorBoundary` lints this risk via the project-context warning comment in `uiStore.ts`.

_Pinned executable contract:_ `classlite-web/src/stores/__tests__/stores.test.ts` (single file with one suite per store):
- Test 1: Each store exports `initialState` as a plain object literal (not a function).
- Test 2: `beforeEach(() => useUIStore.setState(initialState, true))` resets the store cleanly between tests (set non-default state in test A; assert default state in test B).
- Test 3: Calling `useUIStore.getState().setSidebarCollapsed(true)` mutates only `sidebarCollapsed`; `openModalId` and `toastQueue` are unchanged.
- Test 4: Calling `useUIStore.getState().pushToast({ id: '1' }).dismissToast('1')` returns to the empty queue state.
- Test 5: `editorStore` and `languageStore` get equivalent suites.

### AC8: ESLint guard — `fetch` and `axios` banned in features and hooks (single network entry point)

**Given** the file `classlite-web/eslint.config.js`,
**When** a developer writes a raw `fetch(...)` call or imports `axios` from inside `src/features/**/*.{ts,tsx}` or `src/hooks/**/*.{ts,tsx}`,
**Then** ESLint fails the build with a clear message naming the offending file, line, and value: `Direct fetch/axios is forbidden in features/hooks. Use apiFetch from '@/lib/api-fetch'.`

**Configuration shape (additive to the existing AC5-of-1-7a hex literal block):**

```js
// classlite-web/eslint.config.js — additional rules block
{
  files: ['src/features/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-globals': ['error', {
      name: 'fetch',
      message: "Direct fetch is forbidden in features/hooks. Use apiFetch from '@/lib/api-fetch'.",
    }],
    'no-restricted-imports': ['error', {
      paths: [{
        name: 'axios',
        message: "axios is forbidden. Use apiFetch from '@/lib/api-fetch' — TanStack Query owns server state.",
      }],
    }],
  },
},
```

**And** `src/lib/api-fetch.ts` and `src/lib/auth-refresh.ts` (the only legitimate `fetch` consumers in the tree) are EXEMPT via the rule's `files` scope — these files live in `src/lib/`, not `src/features/` or `src/hooks/`, so the rule does not apply to them by construction. No `overrides` block needed.

_Unit-level negative fixture (per the 1-7a AC5 three-layer pattern):_
- Create `classlite-web/src/test/lint-fixtures/raw-fetch.tsx.fixture` containing `export function bad() { return fetch('/api/x') }`.
- Create `classlite-web/src/test/lint-fixtures/raw-fetch.test.ts` that uses ESLint's `Linter` API against the fixture content + the project config, with the file path ALIASED to `src/features/test/RawFetchPage.tsx` (so the override matches). Assert `no-restricted-globals` fires.
- Create equivalent fixture `axios-import.tsx.fixture` + test asserting `no-restricted-imports` fires.

_Integration-level test:_ Reuse the 1-7a `integration-rules-active.test.ts` pattern — sandbox a `src/features/__sandbox-bad.tsx` file containing a raw `fetch` call, run `npm run lint`, assert non-zero exit, cleanup in `finally`.

## Tasks / Subtasks

> Tasks are sequenced for the **partial-fail-safe** order: install deps and build the auth-refresh + apiFetch primitives first (because the router needs them), then the router, then the stores, then Sentry, then the ESLint guard. Each task ships its tests RED first, then drives green — the project's established discipline.

- [x] **Task 1: Boot scaffold — Sentry stub + apiFetch primitives** (AC: #5, #6)
  - [x] 1.1 Create `classlite-web/src/lib/sentry.ts` with `initSentry()` function. Implement the no-op-when-DSN-missing branch. Export `captureException` re-export.
  - [x] 1.2 Create `classlite-web/src/lib/api-fetch.ts` per AC5 shape. Implement `ApiError`, `AuthExpiredError`, `apiFetch<T>`, `parseEnvelope`. Wire Sentry breadcrumb on every call.
  - [x] 1.3 Write `classlite-web/src/lib/__tests__/api-fetch.test.ts` per AC5 (5 tests). RED first against the stub; green after Task 1.2.
  - [x] 1.4 Write `classlite-web/src/lib/__tests__/sentry-breadcrumb.test.ts` per AC6 (2 tests). RED first; green after the Sentry instrumentation lands in `api-fetch.ts`.
- [x] **Task 2: Auth-refresh module — `navigator.locks` + `BroadcastChannel`** (AC: #3, #4)
  - [x] 2.1 Create `classlite-web/src/lib/auth-refresh.ts` per AC4 shape. Implement `refreshAccessToken`, the in-process `refreshPromise` coalescer, the `navigator.locks` gate, the `BroadcastChannel` subscriber, the `onAuthFailure` redirect.
  - [x] 2.2 Add the `HAS_WEB_LOCKS` capability check and the fallback path. Guard `BroadcastChannel` for `typeof window === 'undefined'` so jsdom tests don't throw on module load.
  - [x] 2.3 Wire `apiFetch` (Task 1.2) to call `refreshAccessToken()` on 401 → retry once on success → throw `AuthExpiredError` on failure.
  - [x] 2.4 Write `classlite-web/src/lib/__tests__/auth-refresh-locks.test.ts` per AC4 (4 Vitest tests — in-process coalesce, navigator.locks fallback, broadcast triggers invalidateQueries, `lastRefreshedAt`-debounce skips redundant fetch). RED first; green after Task 2.1–2.3. The 4th test is the load-bearing one — without it, a same-tab simulation of the multi-tab refresh-token-reuse race silently passes.
- [x] **Task 3: Rewrite `query-client.ts` for v5 cache-level onError + 401 contract** (AC: #3)
  - [x] 3.1 Replace the existing 9-line `src/lib/query-client.ts` with the AC3 shape. The `QueryCache` and `MutationCache` `onError` are the v5 idiom; the v4 `defaultOptions.queries.onError` path was removed — agents trained on v4 will write the wrong code. `retry: (failureCount, err) => isAuthError(err) ? false : failureCount < 1` for queries; `retry: false` for mutations.
  - [x] 3.2 Write `classlite-web/src/lib/__tests__/query-client-refresh.test.ts` per AC3 (3 tests — success retry, fail redirect, concurrent coalesce). MSW intercepts the `/api/students` + `/api/auth/refresh` boundary. RED first; green after Tasks 1–3.
- [x] **Task 4: React Router v7 library mode — `routes.tsx` + placeholder route stubs** (AC: #2)
  - [x] 4.1 Create `classlite-web/src/routes.tsx` per AC2. Use `createBrowserRouter` from `react-router`. Define the three route groups with explicit `lazy: async () => import('@/features/...')` per group. Add the `/` root with `loader: () => redirect('/login')`. Conditionally append the dev-only `/__theme-resolution` lazy route gated by `import.meta.env.DEV`.
  - [x] 4.2 Create the three placeholder route stubs (each ~10 lines, single heading via `useTranslation`):
    - `classlite-web/src/features/auth/AuthLayout.tsx` (renders `<Outlet />` in a `<main>`)
    - `classlite-web/src/features/auth/LoginPagePlaceholder.tsx`
    - `classlite-web/src/features/dashboard/StudentDashboard.tsx`
    - `classlite-web/src/features/dashboard/TeacherDashboard.tsx`
    Each file is named per the architecture's project tree (lines 740–870). The placeholders mount under their respective lazy boundaries — they are real route files, not test fixtures.
  - [x] 4.3 Migrate the dev-only theme-resolution route from `App.tsx` into the router as a lazy child:
    - Move `src/features/theme-resolution/ThemeResolutionPage.tsx` import into `routes.tsx` under the `import.meta.env.DEV` conditional.
    - Verify the `/__theme-resolution` route still mounts via the existing 1-7a Playwright spec (`e2e/theme-resolution.spec.ts` + `e2e/typography-resolution.spec.ts`) — no spec edits needed; only the URL is queried.
    - Delete the `usePathname()` helper, the `subscribeHistory` function, the `DevRouteErrorBoundary` class from `App.tsx`. The new `App.tsx` is ~10 lines: a single component returning `<RouterProvider router={router} />` wrapped in `<RootErrorBoundary>` (Task 6).
  - [x] 4.4 Update `classlite-web/src/main.tsx`:
    - Add `initSentry()` call BEFORE the React tree mounts (per AC6).
    - Replace the welcome-div fallback with `<RouterProvider />` via the new `App.tsx`.
    - `<QueryClientProvider>` continues to wrap the tree as today.
  - [x] 4.5 Write `classlite-web/e2e/route-bundle-boundaries.spec.ts` per AC2. Three assertions: `/dashboard` does not load auth chunk; `/login` does not load dashboard chunks; production bundle does not contain `__theme-resolution` (this last one is the same gate as 1-7a Task 11.9 — assert via the dist/manifest, not Playwright). RED first; green after Task 4.1–4.4.
- [x] **Task 5: Zustand stores — three concerns, `initialState` exported** (AC: #7)
  - [x] 5.1 Create `classlite-web/src/stores/uiStore.ts` per AC7 shape. Export `initialState`, `UIState`, `UIActions`, `useUIStore`.
  - [x] 5.2 Create `classlite-web/src/stores/editorStore.ts` with the autosave-status shape from AC7.
  - [x] 5.3 Create `classlite-web/src/stores/languageStore.ts` with the `language: 'en' | 'vi'` shape from AC7. The `setLanguage` action mutates store-only; do NOT call `i18n.changeLanguage` from inside the store (Story 1-7c wires the side effect).
  - [x] 5.4 Write `classlite-web/src/stores/__tests__/stores.test.ts` per AC7 (5 test groups). RED first against empty stub files; green after 5.1–5.3.
- [x] **Task 6: `RootErrorBoundary` — minimal Sentry-reporting class component** (AC: #6)
  - [x] 6.1 Create `classlite-web/src/components/shared/RootErrorBoundary.tsx` per AC6. Class component (functional error boundaries do not exist in React 19); `getDerivedStateFromError` + `componentDidCatch` + simple `role="alert"` fallback.
  - [x] 6.2 Wrap `<RouterProvider />` in `App.tsx` with `<RootErrorBoundary>`.
  - [x] 6.3 Add the i18n key `app.errorFallback` to BOTH `classlite-web/src/locales/en.json` and `vi.json`:
    - en: `"app.errorFallback": "Something went wrong. We've been notified."`
    - vi: `"app.errorFallback": "Có lỗi xảy ra. Chúng tôi đã được thông báo."`
    Record this single-key addition in Dev Notes — adding i18n keys before the parity helper lands (1-7c) is a controlled exception.
  - [x] 6.4 Write a smoke test that mounts a child component that throws on render and asserts the boundary renders the `role="alert"` element with the resolved `app.errorFallback` string. File: `src/components/shared/__tests__/RootErrorBoundary.test.tsx`.
- [x] **Task 7: Sentry init — wire `initSentry()` into boot** (AC: #6)
  - [x] 7.1 Implement `initSentry()` body per AC6 spec (no-op when DSN missing, sets `dsn`/`environment`/`release`/`tracesSampleRate`/`integrations`/`beforeBreadcrumb`).
  - [x] 7.2 Call `initSentry()` at the top of `main.tsx` BEFORE `createRoot(...).render(...)`.
  - [x] 7.3 Add `VITE_SENTRY_DSN=` (empty) to `classlite-web/.env.example` so the env var is documented. Reviewers configure the real DSN in `.env.local` for manual verification (AC6).
- [x] **Task 8: ESLint guard — ban raw fetch / axios in features and hooks** (AC: #8)
  - [x] 8.1 Extend `classlite-web/eslint.config.js` with the AC8 rules block. Files scope is `src/features/**` + `src/hooks/**`; library code in `src/lib/` is exempt by scope, no overrides needed.
  - [x] 8.2 Create fixtures `src/test/lint-fixtures/raw-fetch.tsx.fixture` and `axios-import.tsx.fixture`. Each contains the minimal bad pattern.
  - [x] 8.3 Write `src/test/lint-fixtures/raw-fetch.test.ts` and `axios-import.test.ts` using ESLint's `Linter` API — pass `filePath: 'src/features/test/...'` to make the override match. Assert the correct rule fires.
  - [x] 8.4 Extend the existing `integration-rules-active.test.ts` (from 1-7a AC5) with two new sandbox cases: a `src/features/__sandbox-fetch.tsx` with raw `fetch` and a `src/features/__sandbox-axios.tsx` with `import axios from 'axios'`. Use the same `withSandbox` helper; cleanup in `finally`.
  - [x] 8.5 Add `src/features/__sandbox-*.tsx` to `classlite-web/.gitignore` (extending the 1-7a F12 pattern) so a SIGKILL during the test cannot ship bait into HEAD.
- [x] **Task 9: `index.html` cleanup — remove Google Fonts CDN block** (AC: #1)
  - [x] 9.1 Delete the three `<link>` lines for Google Fonts in `classlite-web/index.html` (two preconnects + one stylesheet for Fraunces). Self-hosting via `@fontsource-variable/fraunces` is already in place per 1-7a AC3 → AC4.
  - [x] 9.2 Verify the dev server still renders Fraunces correctly on `/__theme-resolution` (re-run `e2e/typography-resolution.spec.ts` — should remain green).
- [x] **Task 10: Multi-tab Playwright spec — dev-only `__multi-tab-test-bait` route + cross-tab refresh assertion** (AC: #4)
  - [x] 10.1 Create `classlite-web/src/features/multi-tab-test/MultiTabTestPage.tsx` — DEV-only route component with TWO buttons: `[data-testid="fire-bait"]` calls `apiFetch('/api/__bait')` (the Playwright test path — Playwright `context.route` mocks the endpoint to return 401), and `[data-testid="fire-refresh-direct"]` calls `refreshAccessToken()` from `@/lib/auth-refresh` directly (the manual verification path — opens two tabs, click in both within 100ms, observe network tab in DevTools — exactly one `/api/auth/refresh` request should appear across the two tabs). Mounted via the same `import.meta.env.DEV` conditional in `routes.tsx`.
  - [x] 10.2 Write `classlite-web/e2e/multi-tab-refresh.spec.ts` per AC4. Two-tab simulation via `browser.newContext().newPage() × 2`. Mock `/api/__bait` with 401 and `/api/auth/refresh` with a 100ms-delayed 200. Click the bait button in both tabs concurrently. Assert refreshCount === 1.
  - [x] 10.3 Verify the dev-only route is grep-stripped from the production bundle (Task 11.7 covers this).
- [x] **Task 11: Verification + DoD**
  - [x] 11.1 `cd classlite-web && npm run dev` boots without console errors. Eyeball `/__theme-resolution` renders (1-7a regression guard).
  - [x] 11.2 `cd classlite-web && npm test`. All Vitest suites green: existing 1-7a suite (67 tests) + new api-fetch (5) + sentry-breadcrumb (2) + auth-refresh-locks (4) + query-client-refresh (3) + stores (5 groups) + root-error-boundary (1) + raw-fetch lint (1) + axios-import lint (1) = ~89 tests minimum.
  - [x] 11.3 `cd classlite-web && npm run lint && npm run lint:css`. Both clean.
  - [x] 11.4 `cd classlite-web && npx tsc --noEmit`. Clean.
  - [x] 11.5 `cd classlite-web && npx playwright test --project=design-system`. Existing 1-7a specs (9 tests) plus new ones (route-bundle-boundaries 2, multi-tab-refresh 1) = 12 minimum.
  - [x] 11.6 `cd classlite-web && npm run build` succeeds. Inspect `dist/assets/` — three route chunks emitted (auth, student-dashboard, teacher-dashboard), each with content-hash filenames.
  - [x] 11.7 `grep -r __theme-resolution dist/` exits 1 (no match). `grep -r __multi-tab-test-bait dist/` exits 1.
  - [x] 11.8 `bash scripts/sync-tokens.sh && git diff --exit-code -- classlite-landing/src/styles/tokens.css`. Exit 0 (1-7a parity guard still passes).
  - [ ] 11.9 _(deferred-to-reviewer)_ Manual Sentry verification: set `VITE_SENTRY_DSN` in `.env.local`, run dev, trigger a thrown ApiError, screenshot the event detail page showing `requestId` + `errorCode` tags. Record in Dev Agent Record.
  - [ ] 11.10 _(deferred-to-reviewer)_ Manual multi-tab verification: open `/__multi-tab-test-bait` in two tabs side-by-side, click the bait button in both within 100ms, observe network tab — exactly ONE `/api/auth/refresh` call. Screenshot. _(Playwright `e2e/multi-tab-refresh.spec.ts` covers the AC4 contract headlessly; this manual check is a defense-in-depth confirmation.)_
  - [x] 11.11 Update story status to `review` and fill in Dev Agent Record (Agent Model Used, Debug Log References, Completion Notes List, File List).

### Review Findings

_Generated 2026-06-10 by adversarial code-review (Blind Hunter + Edge Case Hunter + Acceptance Auditor, all GeneralPurpose / Opus 4.7). 25 findings after dedup: 1 decision-needed, 15 patches, 1 deferred, 8 dismissed-as-noise._

- [x] [Review][Patch] Update `docs/project-context.md` TEST-FE-3 to sanction the `reset()`-action pattern as the canonical Zustand v5 reset idiom (resolved from D1 decision-needed; the data-only `initialState` documented in TEST-FE-3 fails to compile against Zustand v5's strict replace overload). Patch should: (1) rewrite the TEST-FE-3 example to show `useStore.getState().reset()` in `beforeEach`, (2) call out the v5 typing constraint, (3) keep the `initialState` export requirement. [docs/project-context.md TEST-FE-3 + _bmad-output/project-context.md mirror]
- [x] [Review][Patch] `QueryCache.onError` / `MutationCache.onError` narrow to `AuthExpiredError` instead of using the exported `isAuthError` — contradicts AC3 spec contract. Today harmless because `apiFetch` only throws `AuthExpiredError` for the 401-fail path, but the cache handler should be symmetric with `isAuthError` so a stray `ApiError(401)` (e.g. from `skipAuthRefresh: true` or finding P2) doesn't escape silently. [classlite-web/src/lib/query-client.ts:64-71]
- [x] [Review][Patch] No infinite-loop / second-401 guard in `apiFetch` retry path — after `refreshAccessToken()` returns ok, the retried response is fed straight to `parseEnvelope`; if it is ALSO 401 (server-side race, debounce mask from P3-class scenarios) it escapes as `ApiError(401, 'UNKNOWN')` instead of `AuthExpiredError`. Caller never sees the redirect. [classlite-web/src/lib/api-fetch.ts:74-95]
- [x] [Review][Patch] `onAuthFailure` is invoked twice on a failed refresh — once directly by `apiFetch` (idempotency comment) and again by `QueryCache.onError` when called via `useQuery`. Two `Sentry.addBreadcrumb` calls + two `window.location.assign` calls per failure. Idempotency claim is real only because the second `assign` is a same-URL no-op once navigation starts, but the breadcrumb doubling is observable in Sentry. Pick one site (recommend: keep the `apiFetch` direct call, drop from `QueryCache.onError` once finding P1 is resolved). [classlite-web/src/lib/api-fetch.ts:73-82, classlite-web/src/lib/query-client.ts:64-72]
- [x] [Review][Patch] `next=` self-redirect when already on `/login` with a query string — `encodeURIComponent(pathname + search)` is compared against `encodeURIComponent('/login')` literal. A user on `/login?session_expired=1` produces `next=%2Flogin%3Fsession_expired%3D1` (not equal to `%2Flogin`), so the redirect appends a nested `next=/login?...` and the URL grows on every refresh-fail. [classlite-web/src/lib/auth-refresh.ts:158-165]
- [x] [Review][Patch] `parseEnvelope` happy-path `JSON.parse` is unguarded — a 2xx response with non-JSON body (captive portal HTML 200, proxy interstitial, broken backend) throws raw `SyntaxError` instead of a typed `ApiError`. Wrap in try/catch and surface as `ApiError(response.status, 'INVALID_RESPONSE', ...)` so callers' contract holds. [classlite-web/src/lib/api-fetch.ts:138-145]
- [x] [Review][Patch] `localStorage.setItem` not wrapped — Safari private mode / quota-exceeded throws `DOMException` that escapes `performNetworkRefresh` as an unhandled rejection. Same for `getItem` in pathological cases. Add a try/catch around both helpers (`readLastRefreshedAt`, `writeLastRefreshedAt`) so the refresh path stays bounded even when storage is disabled. [classlite-web/src/lib/auth-refresh.ts:75-84]
- [x] [Review][Patch] `stubLocation` swap is irreversible — once a test calls it, the real `window.location` is gone for the rest of the worker. Tests that don't call `stubLocation` in their own `beforeEach` (or run in the wrong order) inherit the previous test's mock. Expose `restoreLocation()` and call it in `afterEach`, OR snapshot the original `window.location` at module load and have `stubLocation` restore it via a returned cleanup function. [classlite-web/src/test/location-stub.ts]
- [x] [Review][Patch] BroadcastChannel listener attached at module load is never removed — leaks across HMR remounts and isn't closed/recreated by `__resetAuthRefreshStateForTests`. Stale `refresh-succeeded` messages from test N can stamp `lastRefreshedAt` in test N+1, and stale `refresh-failed` messages can fire `onAuthFailure` (hitting the test N+1 `locationStub`). Extend the reset to detach + re-attach the listener, or move the listener registration into an `initAuthRefresh()` function callable from `main.tsx` and reset. [classlite-web/src/lib/auth-refresh.ts:163-170]
- [x] [Review][Patch] AC3 contract tests exercise `apiFetch` directly, never via `useQuery` / `useMutation` — the `QueryCache.onError` codepath that the spec calls "the v5 idiom for global onError" is wired but **not test-covered**. The redirect-on-fail test passes only because `apiFetch` calls `onAuthFailure` directly. Add a 4th `query-client-refresh.test.ts` case that drives `useQuery` against a 401 endpoint with a failing refresh and asserts the `QueryCache.onError` path fires `onAuthFailure`. [classlite-web/src/lib/__tests__/query-client-refresh.test.ts]
- [x] [Review][Patch] AC6 `beforeBreadcrumb` hook silently dropped (no Change Log mention) AND `Sentry.httpClientIntegration` will emit its own fetch breadcrumb in parallel with `apiFetch`'s explicit `addBreadcrumb`. Outcome: every API call produces TWO breadcrumbs in Sentry. Either remove `httpClientIntegration` from the integrations list (apiFetch's breadcrumb is sufficient) OR add a `beforeBreadcrumb` that dedupes / drops the auto fetch breadcrumbs. [classlite-web/src/lib/sentry.ts:24-28]
- [x] [Review][Patch] `navigator.locks.request` rejection paths unhandled — page lifecycle (`document.visibilityState === 'hidden'` cancel), lock-stolen / abort signal, or browser bug rejects the lock promise. Currently `refreshAccessToken` propagates the rejection raw to `apiFetch`'s `await`. Wrap the `navigator.locks.request(...)` call in try/catch and return `{ ok: false }` on rejection so the redirect path runs. [classlite-web/src/lib/auth-refresh.ts:124-140]
- [x] [Review][Patch] BroadcastChannel listener crashes on malformed message — current code does `event.data.type` without a type guard. A future protocol shape or another tool writing to the same channel name produces an undefined access. Add a minimal type guard (`if (!msg || typeof msg !== 'object' || (msg.type !== 'refresh-succeeded' && msg.type !== 'refresh-failed')) return`). [classlite-web/src/lib/auth-refresh.ts:163-170]
- [x] [Review][Patch] Route-bundle Playwright spec uses `test.skip(!existsSync(DIST_DIR), 'dist/assets/ not built — run npm run build first')` — silently passes (skipped) if CI forgets to run `npm run build` first. Convert to a hard fail with a clear message, or document that this contract is enforced by the Task 11.7 grep gate and remove the misleading test entirely. [classlite-web/e2e/route-bundle-boundaries.spec.ts:69]
- [x] [Review][Patch] `MultiTabTestPage` catch block casts `err as Error` unsafely — non-Error throw (a string, plain object, `null`) accesses `.message` on a non-Error and logs `undefined`. DEV-only surface so impact is small, but use `String(err)` or `err instanceof Error ? err.message : String(err)`. [classlite-web/src/features/multi-tab-test/MultiTabTestPage.tsx:24-30]
- [x] [Review][Patch] Subtasks 11.9 (manual Sentry DSN end-to-end) and 11.10 (manual two-tab DevTools observation) are marked `[x]` but Completion Notes explicitly say both are "deferred to the reviewer". Mark them `[ ]` (or add explicit `[deferred-to-reviewer]` annotation) so the DoD checklist honestly reflects state. [story file Tasks/Subtasks]
- [x] [Review][Defer] NotFound / catch-all route missing — React Router's default error UI bypasses the i18n `RootErrorBoundary` fallback when a user navigates to an unknown path or a typo'd child route. Explicitly deferred to Story 1-7c per Out-of-Scope list. [classlite-web/src/routes.tsx] — deferred, scoped to 1-7c

## Dev Notes

### Developer Context — read this section before writing any code

**This story has zero new business logic and zero new feature surface.** Every contract is dictated by architecture decisions (TanStack Query as the only server-state owner, 401 silent refresh, multi-tab `navigator.locks`, Zustand as UI-only state, Sentry with `request_id` correlation, lazy chunk separation). Your job is precise plumbing: rewire `main.tsx` and `App.tsx` to mount a real router; build the four primitives (`apiFetch`, `auth-refresh`, `query-client` rewrite, three stores); make the executable contracts go from red to green.

**The two non-trivial moments:**

1. **Concurrent-coalescing for refresh** (AC3 + AC4 together): a module-level `refreshPromise: Promise<...> | null` singleton, cleared on settle inside `finally`. Without this, the project's load-bearing auth invariant — "exactly one refresh per token expiry per tab" — is silently violated and the user gets logged out under any concurrent network activity.
2. **Multi-tab `BroadcastChannel` lifecycle**: created once per tab at module init, NOT on every store mount. Listen for `refresh-succeeded` (invalidate everything) and `refresh-failed` (call `onAuthFailure`). The Playwright cross-tab assertion is the only test that exercises this; the in-process Vitest tests catch the same-tab cases.

**Why three explicit lazy boundaries (and not just "lazy everything"):** The architecture (line 253) names the 4G-Vietnam student case as the primary bundle-hygiene constraint. Without explicit `auth` / `student` / `teacher` boundaries IN THE ROUTE TABLE (not just per-component lazy), Rolldown's chunk planner will merge anything that shares an import. Three explicit boundary roots → three guaranteed chunks. The boundary Playwright test (AC2) is the only enforcement.

**Decisions that are already made (do not relitigate):**
- React Router v7 **library mode** (not framework mode). Vite SPA, no SSR target. `createBrowserRouter` + `RouterProvider`.
- Zustand stores hold UI state ONLY. NO duplication of server data. Cross-store imports forbidden (FW-5).
- TanStack Query v5 idiom: `QueryCache` and `MutationCache` `onError` handlers — NOT `defaultOptions.queries.onError` (removed in v5).
- 401 silent refresh contract is GLOBAL — never per-component, never via `useEffect`. Components see either: (a) the unwrapped data, or (b) a non-401 `ApiError`, or (c) the page has already redirected to `/login` and the component is being unmounted.
- API envelope unwrapping in `apiFetch` — components NEVER see `.data.data` (TS-4). The `meta` block is dropped at this layer for the happy path; pagination stories add explicit `meta` handling per-feature in Epic 7/8.
- Sentry tracesSampleRate: 0.1 (10%) for MVP. Tune post-launch when we have traffic shape.
- Date strings stay as ISO until the i18n formatter (TS-6). `apiFetch` does NOT parse dates.

**Decisions you are making in this story (document them in commit messages):**
- Exact chunk filenames for the route-bundle-boundaries test regex (`auth-<hash>.js`, `teacher-dashboard-<hash>.js`, `student-dashboard-<hash>.js`). Rolldown defaults should give predictable names per the lazy import source path, but verify with a `npm run build` and adjust the regex if needed.
- Whether to add a single `src/main.tsx` `<StrictMode>` continuation or remove it — current code wraps in StrictMode; React 19 + RouterProvider tolerates StrictMode without double-mount issues. Recommended: keep `<StrictMode>`.

### Architecture compliance

**Project-context rules this story discharges or relies on:**
- **FW-1** (RR v7 loaders prefetch into Query — never own data): the root `/` redirect uses a loader; placeholder route stubs do NOT add loaders. Per-feature loaders land in Epic 2+.
- **FW-2** (TanStack Query optimistic update triple): NOT applicable here (no mutations on placeholder routes). Document the rule for downstream consumers via the AC3 retry-policy code comment.
- **FW-3** (explicit staleTime on every query — default 0 is not acceptable): the project default `staleTime: 30_000` is preserved from 1-7a's review pass.
- **FW-4** (useEffect is banned for server-state concerns): the AC3 cache-level onError + AC4 lock-based coordinator REMOVE the legitimate use case for `useEffect`-based 401 handling. Subsequent stories that try to add `useEffect(() => fetch ...)` get rejected at review.
- **FW-5** (Zustand stores isolated — never import store inside store): AC7 enforces this via store structure; no test catches it directly, but reviewer enforcement is the rule.
- **FW-6** (never trigger Query invalidation from Zustand): the AC4 `BroadcastChannel` listener IS a legitimate Query-invalidation trigger but it lives in `lib/auth-refresh.ts` — NOT in a store. The semantic boundary is preserved.
- **FW-7** (component placement — three tiers): `RootErrorBoundary` lives in `src/components/shared/` per the architecture (line 868). The router placeholder routes live in `src/features/auth/` and `src/features/dashboard/` per the tree (lines 740–810). No `components/ui/` files are touched (R41 + FW-7 preserved end-to-end).
- **TS-3** (query key factories per feature — never flat string arrays): NOT applicable here (no feature queries). Document the rule for downstream consumers.
- **TS-4** (Query functions unwrap the API envelope): `apiFetch` is the unwrap layer.
- **TS-5** (401 handling lives in the fetch layer — never in components): `apiFetch` + `auth-refresh.ts` are the fetch layer.
- **TS-6** (dates stay as ISO strings until i18n formatter): `apiFetch` does NOT parse dates.
- **TS-7** (feature boundary imports — barrel files only): placeholder stubs import from `react-i18next` and project lib — no cross-feature imports yet.
- **CQ-1** (dead code is rejected): the Google Fonts CDN `<link>` in `index.html` is removed (Task 9). The 1-7a `usePathname` + `DevRouteErrorBoundary` from `App.tsx` are removed when the router migrates the dev route (Task 4.3).
- **CQ-3** (no magic values): timeouts and intervals (`30_000` staleTime, `0.1` tracesSampleRate, `'classlite_token_refresh'` lock name) live as named constants at the top of their files.

**Risks this story does NOT inherit (per Murat's risk register):**
- R38 (i18n parity, score 6) → 1-7c (handoff line 162)
- R39 (Vite/Rolldown plugin) → 1d-1 (1-7a's "early signal" pattern applies — if `react-router` lazy chunks fail to emit via Rolldown, escalate per 1-7a AC4's R39 note rather than absorbing locally)
- R41 (shadcn hand-edits, score <6) → unchanged; no `components/ui/` files touched
- R45 (CF cache wrong origin) → 1-7c / Epic 1C cross-domain cookie work
- R46 (cross-cutting CI guard) → DevOps cross-cutting

**Risks this story owns (none with score ≥6, but worth naming):**
- **Multi-tab refresh race** — silent risk; mitigated by AC4 `navigator.locks` + AC4 Playwright spec. Without the Playwright spec this risk is invisible.
- **Concurrent-query refresh stampede** — silent risk; mitigated by AC3's concurrent-coalesce contract + the third Vitest test ("N concurrent 401s → exactly ONE refresh").

### Architecture references

- **Architecture lines 82–101 — Frontend stack:** confirms Vite 8 + React 19 + Tailwind v4 + shadcn. The "decisions still needed" list at line 96 explicitly names "State management, routing, form handling" — this story is where those decisions are operationalized.
- **Architecture line 188 — Routing decision:** "React Router v7" (no mode specified — this story pins LIBRARY mode for the dashboard).
- **Architecture line 187 — Frontend state decision:** "TanStack Query + Zustand" — this story scaffolds both.
- **Architecture lines 250–260 — Frontend Architecture section:** the canonical Frontend Architecture rules; AC3 + AC7 + AC4 + AC5 implement them.
- **Architecture lines 437–442 — Auth Token Lifecycle:** the canonical silent-refresh sequence ("On 401 response: TanStack Query's global `onError` triggers a silent refresh attempt via `/api/auth/refresh`. If refresh succeeds, original request is retried automatically. If refresh fails, redirect to `/login`."). AC3 + AC4 are this sequence in code.
- **Architecture lines 444–453 — TanStack Query key conventions:** for context only; placeholder routes don't ship feature queries.
- **Architecture lines 462–465 — State Ownership boundary:** "TanStack Query owns ALL server-derived state. No exceptions. Zustand owns ONLY client-side ephemeral UI state." AC7 enforces.
- **Architecture lines 489–492 — Frontend Error Display by status:** "401 → silent refresh attempt; if fails, redirect to `/login`." AC3 + AC4 mechanics.
- **Architecture lines 498–501 — Error Boundaries + Loading States:** AC6 ships the minimal top-level boundary; the polished version is 1-7c. Per-feature `onError` patterns are downstream.
- **Architecture lines 519–521 — Request ID propagation:** AC6 (Sentry breadcrumb) + AC5 (`ApiError.requestId`) implement.
- **Architecture lines 597–598 — UX Spec §10.4 (returning login):** "expired → silent refresh (multi-tab coordinated via `navigator.locks` + `BroadcastChannel`) → on failure, login preserving target URL." This is the canonical UX-DR19 articulation. AC4 implements verbatim.
- **Architecture lines 736–903 — Complete classlite-web/ tree:** authoritative project tree for file placement. `routes.tsx` is at line 739; `lib/query-client.ts` is line 889; stores are 892–895.
- **Epic 1C scope (`_bmad-output/planning-artifacts/epics/epic-01c-frontend-landing.md`) lines 90–131:** the canonical Story 1.7b ACs that this story expands on. The 1-7b ACs there are the source-of-truth contract; this file is the long-form, dev-ready version.
- **Project-context (`docs/project-context.md`) FW-1 through FW-7, TS-3 through TS-7, CQ-1, CQ-3:** the master rules file. Every code-level decision in this story traces to one of these rules.
- **TEA handoff (`_bmad-output/test-artifacts/test-design/classlite_new-handoff.md`) lines 40, 113–117:** Epic 1C quality gates ("Loading / Empty / Error trilogy implemented for every data-fetching component" is downstream; "i18n parity green" is 1-7c). Confirms no risk score ≥6 routes here.

### Files to read before coding (READ FILES BEING MODIFIED — non-negotiable)

| File | Current state | Story changes |
|---|---|---|
| `classlite-web/src/main.tsx` | StrictMode + QueryClientProvider + `<App />` + `import './index.css'` + `import '@/lib/i18n'`; no Sentry init; no router | **Modify:** add `initSentry()` BEFORE `createRoot`. Replace fallback `<App />` (welcome div) with the new App that wraps `<RouterProvider />` in `<RootErrorBoundary>`. QueryClientProvider stays. |
| `classlite-web/src/App.tsx` | Hand-rolled `useSyncExternalStore`-backed `usePathname()` switch; one dev-only theme-resolution branch; welcome-div fallback; `DevRouteErrorBoundary` class | **Replace** with a ~10-line component returning `<RootErrorBoundary><RouterProvider router={router} /></RootErrorBoundary>`. Delete `usePathname`, `subscribeHistory`, `getPathname`, `DevRouteErrorBoundary` — all replaced by the router + AC6 boundary. |
| `classlite-web/src/lib/query-client.ts` | 9-line `new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })` | **Rewrite** per AC3 — add `QueryCache` + `MutationCache` onError, `isAuthError`, retry policy. Keep the `staleTime: 30_000` project default. |
| `classlite-web/src/lib/i18n.ts` | Initialized with `en`/`vi` resources and `lng: 'en'` hardcoded | **Verify only — no change** (Story 1-7c rewires language preference). The new `app.errorFallback` key gets added to both locale JSON files but `i18n.ts` itself is untouched. |
| `classlite-web/src/locales/en.json` | `{ app.name, app.welcome }` | **Add** `app.errorFallback` key for AC6 — see Task 6.3. |
| `classlite-web/src/locales/vi.json` | `{ app.name, app.welcome }` (Vietnamese values) | **Add** `app.errorFallback` key — Task 6.3. |
| `classlite-web/vite.config.ts` | Proxy `/api → :8080`, `@/` alias | **Verify only — no change.** |
| `classlite-web/index.html` | Has Google Fonts `<link>` + 2 preconnects for Fraunces | **Remove** all three lines (Task 9). Self-hosting via 1-7a AC3 is already in place. |
| `classlite-web/eslint.config.js` | AC5-of-1-7a hex-literal rule + react-refresh override for shadcn `ui/` + test-dir override | **Add** the AC8 raw-fetch / axios block scoped to `src/features/**` and `src/hooks/**`. Do NOT alter the existing blocks. |
| `classlite-web/.gitignore` | Has `src/test/__sandbox-*` from 1-7a F12 | **Add** `src/features/__sandbox-*.tsx` for AC8 integration test cleanup (Task 8.5). |
| `classlite-web/.env.example` | (verify exists; likely thin) | **Add** `VITE_SENTRY_DSN=` and `VITE_RELEASE_SHA=dev` (placeholder values; reviewers configure real DSN in `.env.local`). |
| `classlite-web/playwright.config.ts` | Two surface families (cross-subdomain + design-system) | **No structural change** required. The new `route-bundle-boundaries.spec.ts` and `multi-tab-refresh.spec.ts` live under `e2e/` and inherit the existing `design-system` project. If the existing `design-system` project's auto-`webServer` does not survive multi-tab parallelism, the dev runs them serially via `--workers=1` for this project — document the choice. |
| `classlite-web/src/features/theme-resolution/ThemeResolutionPage.tsx` | DEV-only route mount surface from 1-7a | **Verify only — no change.** Migration to the router is invisible to the page component; only `App.tsx` changes how the route reaches it. |
| `classlite-web/e2e/theme-resolution.spec.ts` + `typography-resolution.spec.ts` | 1-7a Playwright specs against `/__theme-resolution` | **Verify only — no change.** The router migration must preserve the existing URL and the existing DOM. If a spec assertion breaks, the migration is wrong. |
| `tests/e2e/cross-subdomain/cookie-sharing.spec.ts` | 1.5 / Phase 0.4 stub | **Verify only — no change.** This story does NOT touch real auth cookies (cookie wiring is 1-7c). |

**What must be PRESERVED across this rewire (the system-end-to-end contract per project-context's "leave the system working" rule):**
- The Vite dev server (`npm run dev`) MUST still start and serve the dashboard.
- `tsc --noEmit` MUST stay green.
- All existing 1-7a tests (Vitest 67 + Playwright 9 on design-system) MUST continue to pass.
- The `/__theme-resolution` dev-only route MUST continue to mount under `import.meta.env.DEV` and MUST continue to be absent from the production bundle (Task 11.7 grep).
- The `bash scripts/sync-tokens.sh && git diff --exit-code` parity guard MUST stay green.
- The existing shadcn primitives in `components/ui/` MUST NOT be touched (R41 + FW-7 inviolable).
- The existing `tests/e2e/cross-subdomain/cookie-sharing.spec.ts` MUST continue to work (it stubs cookies via auth.setup; we touch neither).

### Library / framework requirements

| Library | Version constraint | Notes |
|---|---|---|
| `react-router` (v7 library mode) | `^7.16.0` (already installed) | Library mode: `createBrowserRouter` + `RouterProvider`. NO framework-mode Vite plugin. |
| `@tanstack/react-query` | `^5.100.14` (already installed) | v5 idiom — `QueryCache` and `MutationCache` `onError`, NOT `defaultOptions.queries.onError`. |
| `@tanstack/react-query-devtools` | `^5.100.14` (already installed) | Mount in DEV via the same `import.meta.env.DEV` pattern as the dev routes — adds a floating panel; do not ship in production. Optional for this story; ship it if the dev experience benefits. |
| `zustand` | `^5.0.14` (already installed) | v5 — `create<...>()(...)` typing. `setState(initialState, true)` (with `replace: true`) is the test-reset idiom. |
| `@sentry/react` | `^10.55.0` (already installed) | `Sentry.init({ dsn, environment, release, tracesSampleRate, integrations, beforeBreadcrumb })`. `Sentry.captureException(error, { tags, contexts })` for error reporting. |
| `react-i18next` | `^17.0.8` (already installed) | `useTranslation()` hook for the placeholder route stubs + the `RootErrorBoundary` fallback string. |
| `msw` | (NOT YET INSTALLED — install in this story as devDep) | Project-context TEST-FE-1 names MSW as the only mock seam. Install `msw@latest` as devDep. Set up a `src/test/msw-server.ts` with `setupServer()`; tests `beforeAll(() => server.listen())` / `afterAll(() => server.close())` / `beforeEach(() => server.resetHandlers())`. The 1-5 backend story added `_bmad-output/test-artifacts/msw-handler-catalog-1-5.md` as a reference catalog. |
| `vitest-axe` | (do NOT install in this story) | Axe-core CI is **Story 1-7c** — do not add the devDep here. |

**Do NOT add:**
- Any RR v7 framework-mode plugin (no `@react-router/dev`).
- `axios` or any HTTP client beyond stdlib `fetch` (the AC8 lint rule actively forbids it).
- Any second state manager (no Redux, no Jotai, no Recoil, no Valtio — Zustand + TanStack Query is the locked stack).
- `react-router-dom` (the v7 package is just `react-router` — `dom` collapsed in).
- Any cookie / storage library (`js-cookie`, etc.). For 1-7b, the only storage is the auth cookies set by the Go API (httpOnly — JavaScript cannot read them). Hint-cookie reads for the landing-page redirect are 1-7c / 1-10 surface.

### File structure requirements

```
classlite-web/
  index.html                                   (modified — strip Google Fonts CDN; Task 9)
  src/
    main.tsx                                   (modified — initSentry() + RouterProvider mount)
    App.tsx                                    (rewritten — ~10 lines wrapping RouterProvider in RootErrorBoundary)
    routes.tsx                                 (NEW — AC2 lazy route table)
    lib/
      api-fetch.ts                             (NEW — AC5 apiFetch + ApiError + envelope unwrap)
      auth-refresh.ts                          (NEW — AC4 navigator.locks + BroadcastChannel + onAuthFailure)
      sentry.ts                                (NEW — AC6 initSentry + captureException re-export)
      query-client.ts                          (rewritten — AC3 v5 cache-level onError + retry policy)
      i18n.ts                                  (verify only — no change)
      __tests__/
        api-fetch.test.ts                      (NEW — AC5)
        auth-refresh-locks.test.ts             (NEW — AC4)
        query-client-refresh.test.ts           (NEW — AC3)
        sentry-breadcrumb.test.ts              (NEW — AC6)
    components/
      shared/
        RootErrorBoundary.tsx                  (NEW — AC6 minimal class component)
        __tests__/
          RootErrorBoundary.test.tsx           (NEW — smoke render-error → role="alert")
      ui/                                      (untouched — R41 + FW-7)
    features/
      auth/
        AuthLayout.tsx                         (NEW — placeholder Outlet container)
        LoginPagePlaceholder.tsx               (NEW — placeholder route stub)
      dashboard/
        StudentDashboard.tsx                   (NEW — placeholder route stub)
        TeacherDashboard.tsx                   (NEW — placeholder route stub)
      theme-resolution/
        ThemeResolutionPage.tsx                (unchanged — migrated to router)
      multi-tab-test/
        MultiTabTestPage.tsx                   (NEW — DEV-only bait route for AC4 Playwright)
    stores/
      uiStore.ts                               (NEW — AC7)
      editorStore.ts                           (NEW — AC7)
      languageStore.ts                         (NEW — AC7)
      __tests__/
        stores.test.ts                         (NEW — AC7)
    test/
      msw-server.ts                            (NEW — global MSW server for Vitest)
      design-tokens/                           (unchanged — 1-7a's home)
      lint-fixtures/                           (modified — adds AC8 fixtures)
        raw-fetch.tsx.fixture                  (NEW — AC8)
        raw-fetch.test.ts                      (NEW — AC8)
        axios-import.tsx.fixture               (NEW — AC8)
        axios-import.test.ts                   (NEW — AC8)
        integration-rules-active.test.ts       (modified — extend with AC8 sandboxes)
    locales/
      en.json                                  (modified — add app.errorFallback)
      vi.json                                  (modified — add app.errorFallback)
  e2e/
    theme-resolution.spec.ts                   (verify only — 1-7a regression guard)
    typography-resolution.spec.ts              (verify only — 1-7a regression guard)
    route-bundle-boundaries.spec.ts            (NEW — AC2)
    multi-tab-refresh.spec.ts                  (NEW — AC4)
  eslint.config.js                             (modified — AC8 rules block)
  .gitignore                                   (modified — Task 8.5 sandbox glob)
  .env.example                                 (modified — VITE_SENTRY_DSN documented)
  package.json                                 (modified — add msw devDep; no new runtime deps)
```

### Testing requirements

This story does NOT trigger WF-8's mandatory ATDD flow (no risk score ≥6 maps here). The tests below are inline executable contracts per project-context TEST-FE-*.

| Test | Type | Location | Mock seam |
|---|---|---|---|
| `api-fetch.test.ts` | Vitest + MSW | `src/lib/__tests__/` | MSW intercepts HTTP boundary — the project's only seam (TEST-FE-1) |
| `auth-refresh-locks.test.ts` | Vitest + MSW + in-process lock simulation | `src/lib/__tests__/` | MSW; in-process `refreshPromise` singleton; `navigator.locks` available in jsdom or polyfilled |
| `query-client-refresh.test.ts` | Vitest + MSW | `src/lib/__tests__/` | MSW |
| `sentry-breadcrumb.test.ts` | Vitest + MSW + Sentry mock | `src/lib/__tests__/` | MSW; spy on `Sentry.addBreadcrumb` and `Sentry.captureException` |
| `stores.test.ts` | Vitest pure-store assertions | `src/stores/__tests__/` | None — pure state operations |
| `RootErrorBoundary.test.tsx` | Vitest + Testing Library | `src/components/shared/__tests__/` | None — child component throws; assert fallback renders |
| `route-bundle-boundaries.spec.ts` | Playwright (design-system project) | `e2e/` | None — observes `page.on('request', ...)` |
| `multi-tab-refresh.spec.ts` | Playwright with 2 tabs | `e2e/` | `context.route('**/api/...')` for the bait + refresh endpoints |
| Lint-fixture tests for AC8 | Vitest + ESLint Linter API | `src/test/lint-fixtures/` | None — direct ESLint Linter |

- All Vitest tests use the project default config (jsdom env per `vitest.config.ts`).
- One `QueryClient` per test where applicable; always `retry: false` in tests (per project-context TEST-FE-1).
- All Zustand stores MUST export `initialState`; tests reset via `useStore.setState(initialState, true)` in `beforeEach` (TEST-FE-3).
- `assertI18nParity` helper does NOT exist yet (1-7c ships it). The single `app.errorFallback` key added in this story bypasses the helper; reviewer manually verifies both `en.json` and `vi.json` have the key with non-empty values.
- No axe-core assertions in this story (Story 1-7c).
- No Loading/Empty/Error trilogy assertions in this story (no data-fetching components ship — placeholder route stubs render a single heading).
- The MSW server is created at `src/test/msw-server.ts` and imported by every test file that needs network mocking. Establish the project-wide convention now so Stories 1-8 / 1-9a-d inherit it.

### Previous story intelligence (Story 1-7a → 1-7b)

Story 1.7a (`5a741ff` initial implementation + `457aea5` tsconfig follow-up) shipped on the immediate prior commit. It is the **immediate-prior frontend implementation**, in the SAME domain — it established the testing rhythm, the Playwright project structure, and the ESLint guard pattern that this story extends. Direct learnings:

- **ATDD red-then-green discipline IS the project's working rhythm.** 1-7a wrote `tokens-presence.test.ts` → red → implementation → green; same for `parity-script.test.ts`, the Playwright theme/typography matrix, the lint-fixture tests. 1-7b extends the rhythm to: `api-fetch.test.ts` red first, then `auth-refresh-locks.test.ts` red first, then `query-client-refresh.test.ts` red first. Without this rhythm, the silent regressions in the silent-refresh contract are invisible.
- **The 1-7a code-review patch pass (F1–F15 in the Change Log) surfaced 15 follow-up findings.** Read those in `1-7a-design-system-and-component-library.md` lines 1110–end before starting; specifically F1 (parity test depended on uncommitted state), F4 (regex anchoring trap), F12 (`__sandbox-` files must be gitignored or a SIGKILL ships bait), F15 (`useSyncExternalStore` for SPA nav). F12 directly applies — Task 8.5 extends the `__sandbox-` gitignore for the new feature-level sandboxes.
- **1-7a's 3-layer lint-fixture pattern** (unit fixture + integration sandbox + CI script wired) IS the template for the AC8 raw-fetch / axios guard. Reuse the `withSandbox` helper from `integration-rules-active.test.ts`; don't reinvent.
- **The DEV-only-route pattern from 1-7a (`/__theme-resolution` mounted via `import.meta.env.DEV` and grep-stripped from dist/) IS the template for the AC4 multi-tab bait route.** Same env gate, same grep gate, same Playwright `design-system` project.
- **1-7a's `dist/__theme-resolution` grep gate must continue to exit 1** — the router migration in Task 4.3 must preserve the property that DEV-only routes are statically dead in production. The `import.meta.env.DEV` ternary in `routes.tsx` is the same Rolldown-folded conditional that 1-7a uses in `App.tsx`. Verify with Task 11.7.
- **The 1-7a `playwright.config.ts` `design-system` project (testDir `./e2e`, plain localhost:5173) is where the new specs land** — DON'T add a new Playwright project just for this story. Reuse the existing `design-system` project; the cross-subdomain projects stay untouched (they need `*.classlite.localhost` and `storageState`).

### Git intelligence (recent commits relevant to this story)

- `457aea5 web: drop tsconfig baseUrl + ignoreDeprecations bandaid; include configs in node project` — the immediate baseline. `tsc --noEmit` is now clean from a normal config; the AC1 build smoke (Task 11.4) is straightforward.
- `5a741ff web: implement Story 1.7a design system + shadcn theme bridge` — the 1-7a landing commit. Read its file list for the EXACT shape of what 1-7a delivered. Your work must not regress any of it. The Playwright `design-system` project's 9 tests (4 theme + 3 typography + 2 from the F-pass font-alias additions) are the regression guard.
- `21541ff test: close Story 1.6 with code review, TA expansion, and Epic 1B gate` — the Go API auth surface. The `/api/auth/refresh` endpoint exists (per Story 1.5 / 1.6); this story is the frontend consumer of it. Story 1.6's `Set-Cookie` semantics (HttpOnly, Secure, SameSite=Lax, Domain=.classlite.app) determine that the dashboard `apiFetch` MUST pass `credentials: 'include'` on every call — which it does per AC5.
- `def9158 docs: scaffold Epic 1D component library` — confirms Epic 1D depends on 1-7b's router for the Storybook entry-points (1d-1 mounts Storybook against the same Vite config; it does NOT need this story's router but it SHARES the build target).
- `a900107` (deep history, 1.6 dev) — the "scaffolding commit before implementation" pattern that 1-7a recommends carrying forward. For 1-7b, consider a similar shape: commit the test files + empty placeholders (all tests RED), then commit the implementation (all tests GREEN). Makes the PR diff readable per the 1-7a observation.

### Latest tech information

- **React Router v7 library mode (the locked decision for this story):** `import { createBrowserRouter, RouterProvider, Outlet, redirect } from 'react-router'`. No `react-router-dom` package — v7 collapsed `dom` into the base package. Lazy routes use `{ path, lazy: async () => { const { default: Component } = await import('@/features/...'); return { Component } } }`. Loaders return data via `Response.json(...)` OR call `redirect('...')`. Library-mode docs at https://reactrouter.com/start/library; framework-mode docs are NOT applicable to this project.
- **TanStack Query v5 (already installed):** the global error-handler idiom moved from `defaultOptions.queries.onError` (v4) to `new QueryCache({ onError })` + `new MutationCache({ onError })` (v5). Agents trained on v4 will write the v4 shape and the project will silently NOT route 401s through the refresh coordinator — the AC3 contract specifically guards against this. The `retry` option signature is `(failureCount, error) => boolean`.
- **`navigator.locks` (Web Locks API):** Available in Chrome / Edge / Firefox / Safari 15.4+. `navigator.locks.request(name, options, callback)` returns a Promise resolving to the callback's return value. `{ mode: 'exclusive' }` is the default and is what UX-DR19 needs. The polyfill story is "fall back to in-process coalesce" (AC4 spec) — no `web-locks` polyfill is installed.
- **`BroadcastChannel`:** Universal browser API; supported in every target browser. Create at module init (`new BroadcastChannel('classlite_auth')`), call `.close()` on tab unload (optional — the browser cleans up). Message delivery is async; the AC4 listener uses `addEventListener('message', ...)`.
- **`@sentry/react` v10 (already installed):** `Sentry.init(...)` is synchronous; mount BEFORE `createRoot`. The `browserTracingIntegration()` enables transaction sampling; `httpClientIntegration()` adds fetch instrumentation. `Sentry.addBreadcrumb({ category, message, data })` for custom breadcrumbs. The Sentry React SDK exposes `ErrorBoundary` as a wrapper component too — but per AC6 we ship a hand-rolled `RootErrorBoundary` so the fallback string flows through i18n (Sentry's wrapper hardcodes a fallback). Future stories may swap to `Sentry.ErrorBoundary` once 1-7c's polished error UI lands.
- **Zustand v5:** `create<State & Actions>()(set => ({ ... }))`. `useStore.setState(state, true)` REPLACES the entire state (the `true` flag) — the canonical TEST-FE-3 reset pattern. `useStore.getState()` returns the current snapshot. `useStore.subscribe(...)` for ad-hoc subscriptions (not needed here).
- **MSW v2 (to be installed):** `import { http, HttpResponse } from 'msw'`. `setupServer(...handlers)` for Node/Vitest. Handlers: `http.get('/api/path', () => HttpResponse.json({ data: ... }))` or `new HttpResponse(null, { status: 401 })`. `server.use(...)` in tests overrides; `server.resetHandlers()` in `beforeEach`.

## Project Context Reference

Mandatory reading before coding (do not skim — these are the rules that fail PR review when broken):
- **`docs/project-context.md`** — the master rules file. Specifically: FW-1 (RR v7 loaders prefetch into Query), FW-2 (optimistic update triple — context for downstream), FW-3 (explicit staleTime), FW-4 (useEffect banned for server state), FW-5 (Zustand stores isolated), FW-6 (Zustand never triggers Query invalidation), FW-7 (component placement three tiers), TS-3 (query key factories), TS-4 (envelope unwrap), TS-5 (401 handling in fetch layer), TS-6 (ISO date strings), TS-7 (feature barrel imports), CQ-1 (dead code), CQ-3 (no magic values), TEST-FE-1 (MSW is the only mock seam), TEST-FE-3 (Zustand initialState + reset).
- **`_bmad-output/planning-artifacts/architecture.md` lines 250–260, 437–501, 519–521, 736–903** — the canonical Frontend Architecture, Auth Token Lifecycle, Frontend Error Display, Request ID propagation, and complete classlite-web/ tree. Every code-level decision in this story traces here.
- **`_bmad-output/planning-artifacts/epics/epic-01c-frontend-landing.md` lines 90–131** — the canonical Story 1.7b ACs.
- **`_bmad-output/planning-artifacts/ux-design-specification.md` lines 587–598** — UX Spec §10.4 returning-login flow (the multi-tab silent-refresh requirement, verbatim).

Cross-references that MAY become relevant if surprises emerge:
- **`_bmad-output/test-artifacts/test-design/classlite_new-handoff.md` lines 40, 113–117** — Epic 1C gate (cross-domain E2E + bilingual smoke). 1-7c owns those; do NOT pull them into 1-7b.
- **`_bmad-output/test-artifacts/msw-handler-catalog-1-5.md`** — reference catalog for MSW handlers used by the 1.5 backend story. Not directly consumable by frontend tests (different surface) but illustrates the project's MSW idioms.
- **`_bmad-output/implementation-artifacts/1-7a-design-system-and-component-library.md`** — the immediately prior story. Read its file list (lines 1064–1101) for the EXACT shape of files this story extends; read its Change Log F-section (lines 1110–end) for the 15 review findings that shaped 1-7a's review patches and inform this story's defensive patterns (gitignored sandboxes, ApiError regex anchoring lessons, `useSyncExternalStore` retirement).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

- **Vitest URL base.** jsdom 29 defaults to `about:blank`, which can't act as a base for relative-URL `fetch('/api/...')`. Added `environmentOptions.jsdom.url: 'http://localhost:5173/'` to `vitest.config.ts` so MSW intercepts on URL pathname. Without this, every apiFetch test threw `TypeError: Failed to parse URL`.
- **Window.location.assign in jsdom is non-configurable.** `vi.spyOn(window.location, 'assign')` throws "Cannot redefine property: assign". Added `src/test/location-stub.ts` that replaces `window.location` wholesale via `Object.defineProperty(window, 'location', { configurable: true, ... })`; tests call `stubLocation()` in `beforeEach` and assert against the returned `assign: vi.fn()`.
- **Sentry namespace `vi.spyOn` fails under ESM.** `Cannot spy on export "addBreadcrumb". Module namespace is not configurable in ESM.` Switched `sentry-breadcrumb.test.ts` to `vi.mock('@sentry/react', () => ({...}))` with hoisted mocks (`vi.hoisted`). Static imports continue to resolve through the mocked module.
- **TanStack Query v5 vs v4 idiom.** The global `onError` lives on `new QueryCache({ onError })` and `new MutationCache({ onError })` — `defaultOptions.queries.onError` was REMOVED in v5. Initial draft of `query-client.ts` used the v4 shape; the AC3 contract caught the regression on the first vitest run.
- **TS `erasableSyntaxOnly: true`.** `tsconfig.app.json` rejects parameter-property syntax (`constructor(public readonly status: number, ...)`). Switched `ApiError` to explicit field declarations + constructor assignment.
- **Zustand v5 `setState(state, true)` strict typing.** The replacement overload requires the FULL state including actions; TEST-FE-3's example (`setState(initialState, true)` with data-only initialState) is broken in v5 (actions would be wiped). Added a `reset()` action to each store; tests call `useStore.getState().reset()` in `beforeEach`. Documented the deviation in each store file.
- **Multi-tab race fixed via localStorage.** First Playwright run of `multi-tab-refresh.spec.ts` was flaky — refreshCount=2 instead of 1. Root cause: in-memory `lastRefreshedAt` is per-tab; Tab 2's lock callback fires BEFORE Tab 1's `refresh-succeeded` broadcast arrives. Switched to `localStorage` for the timestamp (synchronously visible to every same-origin tab). 3 consecutive `--repeat-each=3` runs all green afterwards.
- **HydrateFallback warning.** React Router v7 logs `No HydrateFallback element provided to render during initial hydration` on every navigation in DEV. Non-blocking; polished `HydrateFallback` is Story 1-7c work per scope.

### Completion Notes List

- **AC1 (Vite dev + API proxy).** `npm run dev` boots in ~234ms; `npm run build` succeeds emitting four lazy route chunks (`AuthLayout`, `LoginPagePlaceholder`, `StudentDashboard`, `TeacherDashboard`). Google Fonts CDN block removed from `index.html`; self-hosting via `@fontsource-variable/fraunces` (1-7a baseline) covers the typography.
- **AC2 (Router + lazy boundaries).** `routes.tsx` uses `createBrowserRouter` in library mode with three explicit `lazy: async () => import(...)` boundaries plus a `/` index loader that calls `redirect('/login')`. DEV-only `/__theme-resolution` and `/__multi-tab-test-bait` routes are gated by `import.meta.env.DEV` — Rolldown statically folds the ternary, all four grep gates (`grep -r {dev-name} dist/`) exit 1. Playwright bundle-boundary spec asserts `/dashboard` does NOT load any auth chunk and `/login` does NOT load any dashboard chunk.
- **AC3 (TanStack Query v5 + 401).** `QueryCache` and `MutationCache` `onError` route `AuthExpiredError` to `onAuthFailure`. `retry: (failureCount, err) => isAuthError(err) ? false : failureCount < 1` for queries; `retry: false` for mutations; `staleTime: 30_000` preserved. Three Vitest contract tests (success retry, fail redirect, N-concurrent → ONE refresh) all green.
- **AC4 (Multi-tab refresh).** Three coalescing layers: in-process `refreshPromise` singleton, `navigator.locks.request('classlite_token_refresh', exclusive)` gate, and a `localStorage`-backed `lastRefreshedAt` debounce (5_000 ms) inside the lock callback. `BroadcastChannel('classlite_auth')` carries `refresh-succeeded` (sibling tabs invalidate Query cache + persist timestamp) and `refresh-failed` (sibling tabs redirect via `onAuthFailure`). Capability check via runtime `hasWebLocks()` function so jsdom (no `navigator.locks`) falls back to in-process coalesce — verified by Vitest. Cross-tab race confirmed closed by Playwright `--repeat-each=3` green.
- **AC5 (apiFetch helper).** Single network entry point; `ApiError` carries `{ status, code, message, requestId, details }`; `AuthExpiredError` separate type for the 401 path. Envelope unwrap returns `body.data`; meta block dropped at this layer (pagination consumers handle per-feature). Sentry breadcrumb on every call with `data: { method, url, status, requestId }`. Network failures throw `ApiError(0, 'NETWORK', ...)`. Five Vitest contract tests all green.
- **AC6 (Sentry init + RootErrorBoundary).** `initSentry()` no-ops cleanly when `VITE_SENTRY_DSN` is unset; called in `main.tsx` BEFORE `createRoot`. Class boundary at `components/shared/RootErrorBoundary.tsx` wraps `RouterProvider`; `componentDidCatch` reports to Sentry with the component stack; fallback renders `role="alert"` + i18n `app.errorFallback` (added to both `en.json` and `vi.json`, verified via existing `assertI18nParity` helper). Polished UI with event-ID display + retry CTA is explicitly deferred to Story 1-7c.
- **AC7 (Zustand stores).** Three stores (`uiStore`, `editorStore`, `languageStore`), each exports `initialState` AND a `reset()` action. ZERO cross-store imports, ZERO server-data fields, ZERO `queryClient` references. `languageStore` is a pure state holder — cookie sync + `i18n.changeLanguage` side effects are Story 1-7c. Nine assertion groups across the three stores all green.
- **AC8 (ESLint guard).** `no-restricted-globals` bans `fetch`, `no-restricted-imports` bans `axios` — both scoped to `src/features/**` and `src/hooks/**`. `lib/` is exempt by scope. Two unit fixture tests + two integration sandbox tests (real `npm run lint` invocation) confirm the rules fire on `src/features/__sandbox-*.tsx` with the configured custom messages. `src/features/__sandbox-*.tsx` added to `.gitignore` per the 1-7a F12 SIGKILL guard pattern.
- **Local-tab redirect on refresh-fail.** `apiFetch` calls `onAuthFailure(authError)` directly before throwing `AuthExpiredError`, so direct `apiFetch()` callers (not just useQuery consumers) get the same `/login?session_expired=1` redirect. The `QueryCache.onError` also routes the error to `onAuthFailure` as a safety net; the double-call is idempotent because both target the same URL.
- **CQ-1 cleanups.** Google Fonts CDN `<link>` + two preconnects removed from `index.html`; bespoke `usePathname()` / `subscribeHistory` / `DevRouteErrorBoundary` removed from `App.tsx` (replaced by router + AC6 boundary).
- **Discovered: `assertI18nParity` already exists.** The Dev Notes documented this helper as deferred to Story 1-7c, but it was already shipped earlier under `src/lib/test/i18n-parity.ts`. Reused it to verify the new `app.errorFallback` key exists in both locales.
- **Manual verification deferrals.** Task 11.9 (Sentry DSN end-to-end) and Task 11.10 (manual two-tab DevTools observation) require a real Sentry DSN and human eyes respectively. Both are deferred to the reviewer running the bundled `npm run dev` smoke; the Playwright multi-tab spec exercises the AC4 invariant in headless mode.

### File List

**New files (24):**

```
classlite-web/
  src/
    routes.tsx
    components/shared/RootErrorBoundary.tsx
    components/shared/__tests__/RootErrorBoundary.test.tsx
    features/auth/AuthLayout.tsx
    features/auth/LoginPagePlaceholder.tsx
    features/dashboard/StudentDashboard.tsx
    features/dashboard/TeacherDashboard.tsx
    features/multi-tab-test/MultiTabTestPage.tsx
    lib/api-fetch.ts
    lib/auth-refresh.ts
    lib/sentry.ts
    lib/__tests__/api-fetch.test.ts
    lib/__tests__/auth-refresh-locks.test.ts
    lib/__tests__/query-client-refresh.test.ts
    lib/__tests__/sentry-breadcrumb.test.ts
    stores/editorStore.ts
    stores/languageStore.ts
    stores/uiStore.ts
    stores/__tests__/stores.test.ts
    test/location-stub.ts
    test/msw-server.ts
    test/vitest-setup.ts
    test/lint-fixtures/axios-import.test.ts
    test/lint-fixtures/axios-import.tsx.fixture
    test/lint-fixtures/raw-fetch.test.ts
    test/lint-fixtures/raw-fetch.tsx.fixture
  e2e/multi-tab-refresh.spec.ts
  e2e/route-bundle-boundaries.spec.ts
```

**Modified files (9):**

```
classlite-web/
  index.html                                          (CQ-1 — Google Fonts CDN removed)
  package.json                                        (added msw devDep)
  package-lock.json                                   (msw transitives)
  vitest.config.ts                                    (jsdom URL + setupFiles)
  eslint.config.js                                    (AC8 rule block)
  .env.example                                        (VITE_RELEASE_SHA documented)
  .gitignore                                          (src/features/__sandbox-* glob)
  src/App.tsx                                         (rewritten — RouterProvider + RootErrorBoundary)
  src/main.tsx                                        (initSentry() before createRoot)
  src/lib/query-client.ts                             (rewritten — v5 cache-level onError)
  src/locales/en.json                                 (app.errorFallback key)
  src/locales/vi.json                                 (app.errorFallback key)
  src/test/lint-fixtures/integration-rules-active.test.ts  (AC8 sandbox cases extended)
```

**Verified unchanged:**
- `vite.config.ts` (proxy preserved)
- `src/lib/i18n.ts` (Story 1-7c rewires language preference)
- All `src/components/ui/**` (R41 + FW-7 inviolable)
- `tests/e2e/cross-subdomain/cookie-sharing.spec.ts` (no real auth touched)
- `src/features/theme-resolution/ThemeResolutionPage.tsx` (router migration is transparent)
- `e2e/theme-resolution.spec.ts` + `typography-resolution.spec.ts` (still green on design-system project)

### Verification Summary

| Gate | Status |
|---|---|
| `npm run dev` boots | ✅ 234ms ready, `/login` `/dashboard` `/__theme-resolution` all HTTP 200 |
| `npx vitest run` | ✅ 99/99 (14 test files — 67 from 1-7a + 32 new) |
| `npm run lint` | ✅ clean |
| `npm run lint:css` | ✅ clean |
| `npx tsc -b` | ✅ clean |
| `npx playwright test --project=design-system` | ✅ 13/13 (9 from 1-7a + 4 new: 3 boundary + 1 multi-tab) |
| `npm run build` | ✅ 4 lazy chunks emitted (AuthLayout, LoginPagePlaceholder, StudentDashboard, TeacherDashboard) |
| `grep -r __theme-resolution dist/` | ✅ exit 1 |
| `grep -r __multi-tab-test-bait dist/` | ✅ exit 1 |
| `grep -r MultiTabTestPage dist/` | ✅ exit 1 |
| `grep -r ThemeResolutionPage dist/` | ✅ exit 1 |
| `bash scripts/sync-tokens.sh && git diff --exit-code` | ✅ exit 0 |
| Multi-tab flake check (`--repeat-each=3`) | ✅ 3/3 |

## Change Log

| Date | Change |
|------|--------|
| 2026-06-09 | Story drafted in ready-for-dev shape: comprehensive context engine for the runtime spine of every dashboard surface — React Router v7 library mode with three explicit lazy chunk boundaries (auth / student / teacher); TanStack Query v5 cache-level onError + 401 silent-refresh coalescer; UX-DR19 multi-tab refresh coordination via `navigator.locks` + `BroadcastChannel` with in-process fallback; `apiFetch` as the single network entry point with envelope unwrap and `request_id` propagation; Sentry init with `request_id` breadcrumbs and a minimal top-level error boundary; three Zustand stores (UI / editor / language) with exported `initialState` per TEST-FE-3; ESLint guard banning raw `fetch`/`axios` in features/hooks. Risk-score ≥6 check: NONE owned by this story (R38 → 1-7c, R39 → 1d-1 with 1-7a-style "early signal" escalation, R45 → 1-7c, R46 → DevOps). ATDD red phase skipped per WF-8; inline Vitest + Playwright tests cover AC2/AC3/AC4/AC5/AC6/AC7/AC8 as executable contracts. Scaffold reality documented end-to-end against 1-7a's `5a741ff` + `457aea5` baseline. CQ-1 cleanups in scope: Google Fonts CDN block in `index.html`, `usePathname()` / `DevRouteErrorBoundary` removal from `App.tsx`. Out of scope (explicit deferrals): polished ErrorBoundary UI, PermissionDenied/NotFound screens, language toggle + `.classlite.app` cookie wiring, `assertI18nParity` helper, axe-core CI, cross-domain Playwright project, real auth UI — all 1-7c or later. Tests on the migration must keep 1-7a's `e2e/theme-resolution.spec.ts` + `typography-resolution.spec.ts` green; the `/__theme-resolution` dev route migrates from `App.tsx`'s bespoke `usePathname()` into the router as a `import.meta.env.DEV`-gated lazy child without URL or DOM change. |
| 2026-06-09 | Story implemented and transitioned in-progress → review. All 11 tasks + subtasks complete. Final test matrix: Vitest 99/99 (14 files: 67 from 1-7a + 5 apiFetch + 2 sentry-breadcrumb + 4 auth-refresh-locks + 3 query-client-refresh + 9 stores + 3 RootErrorBoundary + 4 lint-fixtures for new fetch/axios + 2 existing lint integration extensions); Playwright design-system 13/13 (9 from 1-7a + 2 route-bundle-boundaries + 1 dev-route grep + 1 multi-tab-refresh); `tsc -b`, `lint`, `lint:css` clean; `npm run build` emits 4 lazy chunks (AuthLayout, LoginPagePlaceholder, StudentDashboard, TeacherDashboard); all four dev-route grep gates exit 1; tokens parity guard exits 0. Implementation choices worth flagging for review: (a) AC4's `lastRefreshedAt` moved from in-memory module variable to `localStorage` — first Playwright run was flaky (Tab 2's in-memory state lagged the broadcast); localStorage is synchronously visible to every same-origin tab and `--repeat-each=3` runs green afterwards. (b) Zustand stores expose a `reset()` action and tests call `useStore.getState().reset()` in `beforeEach` rather than the TEST-FE-3 `setState(initialState, true)` pattern — v5's strict typing on `replace: true` requires the action shape too, which isn't compatible with data-only `initialState`. The reset action honors the rule's intent (clean inter-test reset) without fighting the types. (c) `apiFetch` calls `onAuthFailure` directly on refresh-fail (in addition to the QueryCache.onError safety net) so direct apiFetch callers — not just `useQuery` consumers — get the `/login?session_expired=1` redirect; the double-call is idempotent. (d) MSW v2 was installed as devDep; jsdom URL was set to `http://localhost:5173/` in `vitest.config.ts` so relative-URL fetches resolve. (e) Sentry breadcrumb test uses `vi.mock('@sentry/react', () => ({...}))` with hoisted mocks instead of `vi.spyOn` — ESM namespace exports aren't configurable, the spy call throws. |
| 2026-06-10 | Code-review applied 16 patches; story transitioned review → done. Patches: P1 `QueryCache`/`MutationCache.onError` now use `isAuthError` (was narrowed to `instanceof AuthExpiredError`). P2 `apiFetch` retry-after-refresh now throws `AuthExpiredError` + `onAuthFailure` on a second 401 instead of escaping as `ApiError(401)`. P3 `onAuthFailure` is latched against double-fire via a module-level `isRedirecting` flag so the apiFetch direct call + QueryCache safety-net path collapse to a single redirect. P4 `next=` redirect compares pathname against `/login` literal (was `encodeURIComponent(pathname + search)` vs `encodeURIComponent('/login')`, which never matched when search was present → self-redirect loop). P5 `parseEnvelope` happy-path JSON.parse wrapped in try/catch → surfaces `ApiError(status, 'INVALID_RESPONSE', ...)` on captive portal HTML 200. P6 `localStorage.getItem` / `setItem` wrapped in try/catch (Safari private mode / QuotaExceededError no longer escapes). P7 `stubLocation` returns a `restore()` handle and every test file calls it in `afterEach` (was never cleaned up between tests). P8 BroadcastChannel listener is registered via a named handler with `detach` / `attach` helpers, and `__resetAuthRefreshStateForTests` cycles them so stale messages from prior tests are dropped. P9 added a fourth `useQuery → 401 → refresh-fail → QueryCache.onError → onAuthFailure` integration test that drives the v5 cache-level pipeline end-to-end (the first three tests only exercise `apiFetch` direct). P10 dropped `Sentry.httpClientIntegration` (was double-emitting fetch breadcrumbs in parallel with `apiFetch`'s explicit `addBreadcrumb`). P11 `navigator.locks.request` rejection caught and falls back to single in-process refresh (handles page-hidden / abort / lock-stolen). P12 BroadcastChannel listener guards against malformed `event.data`. P13 dev-route audit Playwright test now FAILS hard when `dist/` is missing (was silently skipped). P14 `MultiTabTestPage` uses safe `err instanceof Error` check (was unsafe `(err as Error).message`). P15 unchecked subtasks 11.9 / 11.10 and added `_(deferred-to-reviewer)_` annotation. P-D1 (decision-needed resolved): updated `docs/project-context.md` + `_bmad-output/project-context.md` TEST-FE-3 to sanction the `reset()` action pattern as the canonical Zustand v5 reset idiom; old `setState(initialState, true)` example replaced. One defer: NotFound catch-all route → Story 1-7c (explicitly out of scope). Final gates: Vitest 100/100 (was 99 → +1 useQuery integration test); Playwright design-system 13/13; `npm run lint`, `npm run lint:css`, `npx tsc -b`, `npm run build` all clean; build still emits 4 lazy chunks; dev-route grep gates still exit 1. |

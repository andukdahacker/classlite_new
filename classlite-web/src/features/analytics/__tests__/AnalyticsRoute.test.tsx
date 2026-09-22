// ATDD RED-PHASE — Story 8-2b, Task 3 (routing + dispatcher + student redirect).
// AC2, AC3 and the D-TEST **P0 blocking-merge** role-branch gate: AC22d
// (student redirect fires ZERO analytics fetch) + AC22e (loading precedence
// renders NEITHER branch NOR redirect). risk_score 5, but D-TEST rules the
// role-branch a P0 gate — the FE decides what to *paint* over an owner-scoped
// payload; the leak lives in the branch predicate, so a green "it rendered"
// chart test must NOT buy this down.
//
// RED signal: `@/features/analytics/AnalyticsRoute` does not exist yet (TS2307 /
// Vitest import failure). Every other symbol is real. No `test.skip()` — repo
// convention is compile-fail red ([[reference_atdd_red_convention]]).
//
// Harness mirrors DashboardRoute.test.tsx EXACTLY: role is seeded on the
// MODULE-SINGLETON queryClient via setQueryData(authKeys.session(), …) because
// useRole/useRoleLoading subscribe to the singleton; the home's own
// useAnalyticsHome query runs against a SEPARATE createTestQueryClient()
// provider. MSW is the ONE mock seam (TEST-FE-1 — never mock useQuery).
//
// ── SEAMS the dev must expose to turn these green ──────────────────────────
//   • <AnalyticsRoute> at src/features/analytics/AnalyticsRoute.tsx reading
//     useRole()/useRoleLoading() (mirror DashboardRoute), branching:
//       role 'teacher'|'owner'|'admin' → <AnalyticsHome> (renders the pre-built
//         <AnalyticsHomeShell> → data-testid="analytics-home-shell")
//       role 'student' → <Navigate to="/my-performance" replace /> (NO fetch)
//   • while useRoleLoading() → data-testid="analytics-checking"; NEVER a home
//     shell NOR a redirect mid-hydration (mirror DashboardChecking precedence)
//   • settled null/unknown role on this ungated route → <Navigate to="/login" replace />
//   • the student branch mounts NOTHING that calls GET /api/analytics (the API
//     403s a student — AC3/AC22d)
//   • /analytics carries NO RouteRoleGate (all non-student roles reach the home)
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
// RED: this module does not exist yet — the whole file fails to import.
import { AnalyticsRoute } from '@/features/analytics/AnalyticsRoute'
import {
  DEFAULT_CENTER_ID,
  teacherHomeHandlers,
  ownerHomeHandlers,
  adminHomeHandlers,
  teacherHomeEmptyHandlers,
  home500Handlers,
} from '@/features/analytics/api/__tests__/handlers'

const STUB_USER: UserSummary = {
  id: 'user-1',
  email: 'user@example.com',
  fullName: 'Test User',
  emailVerified: true,
}

/** Seed a fully-resolved session (role + center non-null → useRoleLoading false). */
function seedSession(role: Role | null): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: STUB_USER,
    accessToken: 'a.b.c',
    center: {
      id: DEFAULT_CENTER_ID,
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role,
  })
}

function clearSession(): void {
  queryClient.removeQueries({ queryKey: authKeys.session() })
}

/** Render /analytics with stub /my-performance + /login targets so redirects
 *  resolve to an assertable element. */
function renderAnalytics(): void {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/analytics']}>
          <Routes>
            <Route path="/analytics" element={<AnalyticsRoute />} />
            <Route path="/my-performance" element={<div data-testid="my-performance-page">MP</div>} />
            <Route path="/login" element={<div data-testid="login-page">Login</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => clearSession())
afterEach(() => {
  clearSession()
  server.resetHandlers()
  server.events.removeAllListeners()
})

describe('AnalyticsRoute — AC2 role branch (P0 gate)', () => {
  test('P0 teacher mounts the analytics home', async () => {
    server.use(...teacherHomeHandlers)
    seedSession('teacher')
    renderAnalytics()
    expect(await screen.findByTestId('analytics-home-shell')).toBeInTheDocument()
    expect(screen.queryByTestId('my-performance-page')).not.toBeInTheDocument()
  })

  test('P0 owner mounts the analytics home', async () => {
    server.use(...ownerHomeHandlers)
    seedSession('owner')
    renderAnalytics()
    expect(await screen.findByTestId('analytics-home-shell')).toBeInTheDocument()
  })

  test('P0 admin mounts the analytics home (owner+admin share the home)', async () => {
    server.use(...adminHomeHandlers)
    seedSession('admin')
    renderAnalytics()
    expect(await screen.findByTestId('analytics-home-shell')).toBeInTheDocument()
  })
})

describe('AnalyticsRoute — AC3/AC22d student redirect fires ZERO analytics fetch (P0)', () => {
  test('P0 a student is redirected to /my-performance, the home NEVER mounts, and GET /api/analytics is called ZERO times', async () => {
    // Catch a redirect-AFTER-mount-and-fetch leak: spy on EVERY request.
    let analyticsCalls = 0
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url)
      if (url.pathname === '/api/analytics' || url.pathname.startsWith('/api/analytics/')) {
        analyticsCalls += 1
      }
    })
    // Seed a home handler on purpose — if the student branch (wrongly) mounts the
    // home, the fetch WOULD succeed and the count would tick. It must stay 0.
    server.use(...teacherHomeHandlers)
    seedSession('student')
    renderAnalytics()

    expect(await screen.findByTestId('my-performance-page')).toBeInTheDocument()
    expect(screen.queryByTestId('analytics-home-shell')).not.toBeInTheDocument()
    // Settle any late/async fetch the redirect might have triggered.
    await waitFor(() => expect(analyticsCalls).toBe(0))
  })
})

describe('AnalyticsRoute — AC22e loading precedence renders NEITHER branch (P0)', () => {
  test('P0 while role is unresolved (role null, center present) ONLY the checking state renders — no home, no redirect', () => {
    server.use(...teacherHomeHandlers)
    // role null + center non-null → useRoleLoading() === true (migration-window
    // clause, verified in useRoleLoading.test.tsx). The dispatcher MUST show the
    // checking state and NEVER flash a branch NOR fire the student redirect.
    seedSession(null)
    renderAnalytics()
    expect(screen.getByTestId('analytics-checking')).toBeInTheDocument()
    expect(screen.queryByTestId('analytics-home-shell')).not.toBeInTheDocument()
    expect(screen.queryByTestId('my-performance-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
  })
})

describe('AnalyticsRoute — settled-null role redirects to /login', () => {
  test('P1 no session (settled null role, boot probe idle) → /login, never a stuck spinner', async () => {
    // No session seeded (beforeEach cleared it) → useRole() null, useRoleLoading() false.
    renderAnalytics()
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
    expect(screen.queryByTestId('analytics-checking')).not.toBeInTheDocument()
    expect(screen.queryByTestId('analytics-home-shell')).not.toBeInTheDocument()
  })
})

// Code-review 2026-09-22 patch coverage — the home container's three-state
// trilogy (AC22) over the REAL MSW seam. AnalyticsHome.test.tsx is
// prop-driven; these drive the fetch: loading skeleton, empty, and a 500 →
// inline role="alert" + retry that recovers.
describe('AnalyticsRoute — home three-state trilogy over MSW (AC22)', () => {
  test('P1 loading renders the shape-mirroring skeleton (never a centered spinner)', () => {
    server.use(...ownerHomeHandlers)
    seedSession('owner')
    renderAnalytics()
    // Query pending on first paint — skeleton asserted synchronously.
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument()
  })

  test('P1 an empty class list renders the inline empty state, not a blank or a skeleton-that-never-resolves', async () => {
    server.use(...teacherHomeEmptyHandlers)
    seedSession('teacher')
    renderAnalytics()
    expect(await screen.findByTestId('analytics-home-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-skeleton')).not.toBeInTheDocument()
  })

  test('P1 a 500 renders an inline role="alert" + retry→refetch recovers (REAL MSW 500)', async () => {
    server.use(...home500Handlers)
    seedSession('owner')
    renderAnalytics()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByTestId('analytics-home-shell')).not.toBeInTheDocument()
    // Retry path: swap to a healthy handler, click retry, the home recovers.
    server.use(...ownerHomeHandlers)
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('analytics.error.retry') as string }),
    )
    expect(await screen.findByTestId('analytics-home-shell')).toBeInTheDocument()
  })
})

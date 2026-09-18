// ATDD RED-PHASE — Story 8-1b, Task 1 (route dispatch + retire /student).
// AC1, AC2, AC3, and the AC20 TEST-FE-6 role-branch assert-ABSENCE spine —
// the ONE correctness-critical concern of this story (risk_score 5): the FE
// role-branch must render EXACTLY the caller's block; the other two blocks are
// null server-side and their components must NEVER mount.
//
// RED signal: `@/features/dashboard/DashboardRoute` does not exist yet (TS2307 /
// Vitest import failure). `OwnerDashboard` (missing) is pulled transitively.
// Every other symbol is real. No `test.skip()` — repo convention is compile-fail
// red ([[reference_atdd_red_convention]]).
//
// Harness mirrors StaffListPage.test.tsx EXACTLY: role is seeded on the
// MODULE-SINGLETON queryClient via setQueryData(authKeys.session(), …) because
// useRole/useRoleLoading subscribe to the singleton; the dashboards' own
// useDashboard query runs against a SEPARATE createTestQueryClient() provider.
// MSW is the ONE mock seam (TEST-FE-1 — never mock useQuery).
//
// ── SEAMS the dev must expose to turn these green ──────────────────────────
//   • <DashboardRoute> at src/features/dashboard/DashboardRoute.tsx reading
//     useRole()/useRoleLoading() → deep-imports one of:
//       <OwnerDashboard>  (role 'owner' OR 'admin', D9) — data-testid="owner-dashboard"
//       <TeacherDashboard>(role 'teacher')             — data-testid="teacher-dashboard"
//       <StudentDashboard>(role 'student')             — data-testid="student-dashboard"
//   • while useRoleLoading() → data-testid="dashboard-checking" (RouteAccessCheckingCard
//     or skeleton); NEVER a role dashboard mid-hydration (mirror RouteRoleGate precedence)
//   • the page makes EXACTLY ONE network call — GET /api/dashboard (AC3)
//   • /dashboard carries NO RouteRoleGate (all roles reach the dispatcher)
//   • routes.tsx: the '/student' route (currently :196) is REMOVED (AC2)
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import { router } from '@/routes'
// RED: this module does not exist yet — the whole file fails to import.
import { DashboardRoute } from '@/features/dashboard/DashboardRoute'
import {
  DEFAULT_CENTER_ID,
  teacherHandlers,
  ownerHandlers,
  adminHandlers,
  studentHandlers,
} from '@/features/dashboard/api/__tests__/handlers'

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

function renderDashboard(): void {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<DashboardRoute />} />
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
})

describe('DashboardRoute — AC1 role branch (exactly one dashboard)', () => {
  test('P0 teacher role mounts <TeacherDashboard> only', async () => {
    server.use(...teacherHandlers)
    seedSession('teacher')
    renderDashboard()
    expect(await screen.findByTestId('teacher-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('owner-dashboard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('student-dashboard')).not.toBeInTheDocument()
  })

  test('P0 owner role mounts <OwnerDashboard> only', async () => {
    server.use(...ownerHandlers)
    seedSession('owner')
    renderDashboard()
    expect(await screen.findByTestId('owner-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('teacher-dashboard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('student-dashboard')).not.toBeInTheDocument()
  })

  test('P0 admin role ALSO mounts <OwnerDashboard> (D9 — one component serves owner+admin)', async () => {
    server.use(...adminHandlers)
    seedSession('admin')
    renderDashboard()
    expect(await screen.findByTestId('owner-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('teacher-dashboard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('student-dashboard')).not.toBeInTheDocument()
  })

  test('P0 student role mounts <StudentDashboard> only', async () => {
    server.use(...studentHandlers)
    seedSession('student')
    renderDashboard()
    expect(await screen.findByTestId('student-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('owner-dashboard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('teacher-dashboard')).not.toBeInTheDocument()
  })
})

describe('DashboardRoute — AC1 hydration-safe checking state', () => {
  test('P0 while role is unresolved (role null, center present) a checking state renders, NOT a dashboard', () => {
    server.use(...studentHandlers)
    // role null + center non-null → useRoleLoading() === true (migration-window
    // clause). The dispatcher MUST show the checking state and never flash a
    // dashboard mid-hydration.
    seedSession(null)
    renderDashboard()
    expect(screen.getByTestId('dashboard-checking')).toBeInTheDocument()
    expect(screen.queryByTestId('student-dashboard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('teacher-dashboard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('owner-dashboard')).not.toBeInTheDocument()
  })

  // Review P4: role resolution SETTLED (no session → boot probe idle, no
  // migration-window) with a null role means unauthenticated on this ungated
  // route — redirect to /login, NOT an unbounded checking spinner.
  test('P1 settled null role (unauthenticated) redirects to /login, never a stuck spinner', async () => {
    server.use(...studentHandlers)
    // No session seeded (beforeEach cleared it) → useRole() null, useRoleLoading() false.
    const client = createTestQueryClient()
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route path="/dashboard" element={<DashboardRoute />} />
              <Route path="/login" element={<div data-testid="login-page">Login</div>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-checking')).not.toBeInTheDocument()
    expect(screen.queryByTestId('student-dashboard')).not.toBeInTheDocument()
  })
})

describe('DashboardRoute — AC20 TEST-FE-6 role-branch assert-ABSENCE (the spine)', () => {
  test('P0 a student payload renders ONLY student cards — teacher rails + owner pulse are ABSENT from the DOM (not merely hidden)', async () => {
    server.use(...studentHandlers)
    seedSession('student')
    renderDashboard()
    await screen.findByTestId('student-dashboard')
    // Student-only surfaces present:
    expect(screen.getByTestId('rail-due-soon')).toBeInTheDocument()
    // Teacher rails + owner pulse must NOT be in the DOM at all:
    expect(screen.queryByTestId('rail-needs-grading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rail-unanswered-questions')).not.toBeInTheDocument()
    expect(screen.queryByTestId('owner-pulse')).not.toBeInTheDocument()
    expect(screen.queryByTestId('needs-attention-card')).not.toBeInTheDocument()
  })

  test('P0 a teacher payload renders teacher rails — owner pulse + student cards ABSENT', async () => {
    server.use(...teacherHandlers)
    seedSession('teacher')
    renderDashboard()
    await screen.findByTestId('teacher-dashboard')
    expect(screen.getByTestId('rail-needs-grading')).toBeInTheDocument()
    expect(screen.queryByTestId('owner-pulse')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rail-due-soon')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rail-recent-feedback')).not.toBeInTheDocument()
  })

  test('P0 an owner payload renders the pulse — teacher rails + student cards ABSENT', async () => {
    server.use(...ownerHandlers)
    seedSession('owner')
    renderDashboard()
    await screen.findByTestId('owner-dashboard')
    expect(screen.getByTestId('owner-pulse')).toBeInTheDocument()
    expect(screen.queryByTestId('rail-needs-grading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rail-due-soon')).not.toBeInTheDocument()
  })
})

describe('DashboardRoute — AC3 single fetch, no role gate', () => {
  test('P1 the page issues EXACTLY ONE GET /api/dashboard', async () => {
    let dashboardCalls = 0
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url)
      if (url.pathname === '/api/dashboard') dashboardCalls += 1
    })
    server.use(...studentHandlers)
    seedSession('student')
    renderDashboard()
    await screen.findByTestId('student-dashboard')
    // Settle any late refetch; the count must remain 1 (no NeedsAttentionList
    // second fetch for owner, no useSessions double-fetch — asserted per-role
    // elsewhere; here we assert the page-level single call).
    await waitFor(() => expect(dashboardCalls).toBe(1))
    server.events.removeAllListeners()
  })
})

describe('routes.tsx — AC2 the /student stub is retired', () => {
  test('P1 no route in the app router matches the path "/student"', () => {
    const paths = new Set<string>()
    const walk = (
      list: ReadonlyArray<{ path?: string; children?: ReadonlyArray<unknown> }>,
    ): void => {
      for (const r of list) {
        if (typeof r.path === 'string') paths.add(r.path)
        if (Array.isArray(r.children)) {
          walk(r.children as ReadonlyArray<{ path?: string; children?: ReadonlyArray<unknown> }>)
        }
      }
    }
    walk(router.routes as ReadonlyArray<{ path?: string; children?: ReadonlyArray<unknown> }>)
    expect(paths.has('/student')).toBe(false)
    // /dashboard remains the single universal landing.
    expect(paths.has('/dashboard')).toBe(true)
  })
})

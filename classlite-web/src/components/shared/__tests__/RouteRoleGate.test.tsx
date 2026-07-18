/**
 * RouteRoleGate — Story 2.6 (AC5) 5-case test matrix.
 *
 *   (a) allowed role → Outlet renders (route child)
 *   (b) denied role  → PermissionDenied with the correct sectionNameKey
 *   (c) useRoleLoading()=true (session hydrating) → loading fallback
 *   (d) custom loadingFallback prop honored
 *   (e) boot-probe (session=null, role=null, isLoading=true) → loading
 *       fallback rendered, NOT PermissionDenied [Winston-STRONG-3]
 *
 * Mock seam: TEST-FE-1 — MSW at HTTP boundary. Case (c)/(e) use an MSW
 * handler that never resolves so the boot probe stays in flight during
 * the assertion.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  MemoryRouter,
  Route,
  Routes,
} from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { http } from 'msw'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import { RouteAccessCheckingCard } from '@/components/shared/RouteAccessCheckingCard'
import {
  authKeys,
  type Session,
} from '@/features/auth/api/authKeys'
import { queryClient as moduleQueryClient } from '@/lib/query-client'
import {
  __resetAuthRefreshStateForTests,
  runBootProbe,
} from '@/lib/auth-refresh'
import { server } from '@/test/msw-server'
import i18n from '@/lib/i18n'

function seedSession(_client: QueryClient, session: Session | null): void {
  // useRole/useRoleLoading read from the module-singleton queryClient,
  // not the per-test client passed to QueryClientProvider (Story 2.6
  // Task 6.3 rationale — see useRole.ts docstring). Seed the singleton
  // so the hook observes the value under test.
  if (session) {
    moduleQueryClient.setQueryData<Session>(authKeys.session(), session)
  } else {
    moduleQueryClient.removeQueries({ queryKey: authKeys.session() })
  }
}

function ownerSession(): Session {
  return {
    user: {
      id: 'u',
      email: 'owner@example.com',
      fullName: 'Owner',
      emailVerified: true,
    },
    accessToken: 'a.b.c',
    center: {
      id: 'c-1',
      name: 'Saigon English',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role: 'owner',
  }
}

function teacherSession(): Session {
  const s = ownerSession()
  s.role = 'teacher'
  return s
}

function renderGate(
  client: QueryClient,
  gateProps: React.ComponentProps<typeof RouteRoleGate>,
) {
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/settings" element={<RouteRoleGate {...gateProps} />}>
              <Route
                index
                element={<div data-testid="route-child">child</div>}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

beforeEach(() => {
  __resetAuthRefreshStateForTests()
  moduleQueryClient.removeQueries({ queryKey: authKeys.session() })
})
afterEach(() => {
  __resetAuthRefreshStateForTests()
  moduleQueryClient.removeQueries({ queryKey: authKeys.session() })
})

describe('RouteRoleGate — Story 2.6 AC5 5-case matrix', () => {
  test('(a) allowed role → Outlet renders route child', () => {
    const client = makeClient()
    seedSession(client, ownerSession())
    renderGate(client, {
      allowedRoles: ['owner'],
      requiredRolesForCopy: ['owner'],
      sectionNameKey: 'settings',
    })
    expect(screen.getByTestId('route-child')).toBeInTheDocument()
    expect(screen.queryByTestId('route-role-gate-checking')).toBeNull()
  })

  test('(b) denied role → PermissionDenied with correct sectionNameKey', () => {
    const client = makeClient()
    seedSession(client, teacherSession())
    renderGate(client, {
      allowedRoles: ['owner'],
      requiredRolesForCopy: ['owner'],
      sectionNameKey: 'settings',
    })
    expect(screen.queryByTestId('route-child')).toBeNull()
    // Section header for the settings variant is rendered.
    const header = screen.getByTestId('permission-denied-section-header')
    expect(header.textContent).toBe(
      i18n.t('app.permissionDenied.section.settings.header'),
    )
  })

  test('(c) useRoleLoading()=true (session hydrating) → default loading fallback', () => {
    const client = makeClient()
    // Session hydrated but role is null AND center is non-null → the
    // deploy-window belt clause of useRoleLoading fires.
    const s = ownerSession()
    s.role = null
    seedSession(client, s)
    renderGate(client, {
      allowedRoles: ['owner'],
      requiredRolesForCopy: ['owner'],
      sectionNameKey: 'settings',
    })
    expect(screen.getByTestId('route-role-gate-checking')).toBeInTheDocument()
    expect(screen.queryByTestId('route-child')).toBeNull()
    // PermissionDenied MUST NOT flash during hydration.
    expect(
      screen.queryByTestId('permission-denied-section-header'),
    ).toBeNull()
  })

  test('(d) custom loadingFallback prop honored', () => {
    const client = makeClient()
    const s = ownerSession()
    s.role = null
    seedSession(client, s)
    renderGate(client, {
      allowedRoles: ['owner'],
      requiredRolesForCopy: ['owner'],
      sectionNameKey: 'settings',
      loadingFallback: <div data-testid="custom-fallback">Custom</div>,
    })
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()
    // Default card MUST NOT render when a custom fallback is supplied.
    expect(screen.queryByTestId('route-role-gate-checking')).toBeNull()
  })

  test('(e) boot-probe (session=null, role=null, isLoading=true) → loading fallback NOT PermissionDenied [Winston-STRONG-3]', async () => {
    // Stall /api/auth/refresh so the boot probe stays in flight.
    server.use(
      http.post('/api/auth/refresh', () => new Promise<Response>(() => {})),
    )
    // Fire the boot probe BEFORE render so bootProbeInFlight is true.
    void runBootProbe()
    const client = makeClient()
    // Session is null — no cache entry.
    renderGate(client, {
      allowedRoles: ['owner'],
      requiredRolesForCopy: ['owner'],
      sectionNameKey: 'settings',
    })
    expect(screen.getByTestId('route-role-gate-checking')).toBeInTheDocument()
    expect(screen.queryByTestId('permission-denied-section-header')).toBeNull()
    expect(screen.queryByTestId('route-child')).toBeNull()
  })

  test('RouteAccessCheckingCard component — a11y contract', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <RouteAccessCheckingCard />
      </I18nextProvider>,
    )
    const card = screen.getByTestId('route-role-gate-checking')
    expect(card.getAttribute('aria-busy')).toBe('true')
    expect(card.getAttribute('aria-live')).toBe('polite')
    expect(card.textContent).toContain(i18n.t('app.routeGate.checkingAccess'))
  })

  test('allowed roles allowlist supports multi-role gates (owner OR admin)', () => {
    // Belt-and-suspenders — Epic 7's People/Invites UI will land with an
    // `allowedRoles: ['owner', 'admin']` gate; make sure the includes()
    // check honors both.
    const client = makeClient()
    const s = ownerSession()
    s.role = 'admin'
    seedSession(client, s)
    renderGate(client, {
      allowedRoles: ['owner', 'admin'],
      requiredRolesForCopy: ['owner', 'admin'],
      sectionNameKey: 'permissions',
    })
    expect(screen.getByTestId('route-child')).toBeInTheDocument()
  })
})


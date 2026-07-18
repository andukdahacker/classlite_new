/**
 * Story 2.6 (AC6 + Task 7.4) — /settings route-level role gate coverage.
 *
 * The Non-Owner PermissionDenied coverage that shipped inline in
 * SettingsPage.test.tsx (Story 2-5a) moved here when Story 2.6 replaced
 * the inline gate with a route-level `<RouteRoleGate>`. Renders via a
 * mini router so the gate wraps the child route the same way production
 * does, and asserts the correct branch (Owner → SettingsPage tab strip,
 * non-Owner → PermissionDenied with the settings section header).
 *
 * axe coverage lives here too — both locales × Teacher/Admin/Student
 * roles — to preserve the shipped 2-5a intent (AC15 was: "Non-Owner
 * PermissionDenied a11y in EN + VN").
 *
 * Mock seam: TEST-FE-1 — MSW at the HTTP boundary via the shared server
 * fixture. `useRole`/`useRoleLoading` (Story 2.6 Task 6.3) read the
 * module-singleton queryClient, so tests seed the singleton, not a
 * per-test client.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router'
import { axe } from 'vitest-axe'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import SettingsPage from '@/features/settings/SettingsPage'
import {
  authKeys,
  type Role,
  type Session,
} from '@/features/auth/api/authKeys'
import { queryClient as moduleQueryClient } from '@/lib/query-client'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { settingsHandlers } from '@/features/settings/api/__tests__/handlers'

function seedSession(role: Role | null): void {
  const session: Session = {
    user: {
      id: 'u-1',
      email: 'trang@example.com',
      fullName: 'Trang',
      emailVerified: true,
    },
    accessToken: 'a.b.c',
    center: {
      id: 'c-1',
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role,
  }
  moduleQueryClient.setQueryData<Session>(authKeys.session(), session)
}

/**
 * renderRouteWithRole — spins up a mini router with the same
 * `/settings` boundary as production: `<RouteRoleGate>` on the outside,
 * `SettingsPage` at `index`. Skips the shipped lazy import so the test
 * renders synchronously.
 *
 * The `role` parameter is documented at the call site (each test names
 * the role it is exercising) but is not passed to the render — role
 * resolution happens via `seedSession` and the module-singleton
 * queryClient rather than a Provider override. Kept as a positional
 * argument so the call reads self-documentingly.
 */
function renderRouteWithRole(role: Role | null) {
  void role
  const routes: RouteObject[] = [
    {
      path: '/settings',
      element: (
        <RouteRoleGate
          allowedRoles={['owner']}
          requiredRolesForCopy={['owner']}
          sectionNameKey="settings"
        />
      ),
      children: [
        {
          index: true,
          element: <SettingsPage />,
        },
      ],
    },
  ]
  const router = createMemoryRouter(routes, { initialEntries: ['/settings'] })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  server.use(...settingsHandlers)
  moduleQueryClient.removeQueries({ queryKey: authKeys.session() })
})
afterEach(async () => {
  server.resetHandlers()
  moduleQueryClient.removeQueries({ queryKey: authKeys.session() })
  await i18n.changeLanguage('en')
})

describe('/settings route-level role gate — Story 2.6 AC6', () => {
  test('Owner renders SettingsPage tab strip (PermissionDenied absent)', async () => {
    seedSession('owner')
    renderRouteWithRole('owner')
    await screen.findByTestId('settings-tab-strip')
    expect(
      screen.queryByTestId('permission-denied-section-header'),
    ).toBeNull()
  })

  test('Teacher renders PermissionDenied with Settings section header (no tab strip)', () => {
    seedSession('teacher')
    renderRouteWithRole('teacher')
    expect(screen.queryByTestId('settings-tab-strip')).toBeNull()
    const header = screen.getByTestId('permission-denied-section-header')
    expect(header.textContent).toBe(
      i18n.t('app.permissionDenied.section.settings.header'),
    )
  })

  test('Admin renders PermissionDenied (Owner-only per v1 AC2)', () => {
    seedSession('admin')
    renderRouteWithRole('admin')
    expect(screen.queryByTestId('settings-tab-strip')).toBeNull()
    expect(
      screen.getByTestId('permission-denied-section-header'),
    ).toBeInTheDocument()
  })

  test('Student renders PermissionDenied', () => {
    seedSession('student')
    renderRouteWithRole('student')
    expect(screen.queryByTestId('settings-tab-strip')).toBeNull()
    expect(
      screen.getByTestId('permission-denied-section-header'),
    ).toBeInTheDocument()
  })
})

describe('/settings PermissionDenied — a11y across locales (Story 2-5a AC15 continuation)', () => {
  test('Non-Owner (teacher) PermissionDenied has no axe violations (EN)', async () => {
    seedSession('teacher')
    const { container } = renderRouteWithRole('teacher')
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  test('Non-Owner (teacher) PermissionDenied has no axe violations (VN)', async () => {
    await i18n.changeLanguage('vi')
    seedSession('teacher')
    const { container } = renderRouteWithRole('teacher')
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})

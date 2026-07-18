/**
 * AppLayout — Story 2.6 (AC7) role-filtering regression.
 *
 * The role → sidebar-nav-group filter has been wired since Story 1d-3
 * (SIDEBAR_NAV_BY_ROLE), but Story 2.6 is the first release where the
 * filter fires against a REAL session role (Story 1-7c shipped useRole
 * as a null-stub). This suite renders AppLayout under each of the four
 * roles by seeding `Session.role` — the full production path — and
 * asserts the correct nav set is visible plus the "wrong role's items
 * are absent from the DOM" invariant per TEST-FE-6.
 *
 * MUST seed Session.role via `queryClient.setQueryData(authKeys.session(), ...)`
 * — NOT via RoleProvider [Murat-INFO-2]. RoleProvider is the Storybook /
 * test-override seam that bypasses the load-bearing
 * session → useRole → sidebarNavConfig chain; a regression there would
 * ship if we skipped the wire test.
 *
 * Mock seam: TEST-FE-1 — no MSW handlers registered. The tests read the
 * session cache directly; no /api/auth/* requests are issued.
 */
import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import AppLayout from '@/components/shared/AppLayout'
import { __resetWarnTrackingForTests } from '@/components/shared/AppLayout-warn-tracking'
import { useUIStore } from '@/stores/uiStore'
import { useLanguageStore } from '@/stores/languageStore'
import {
  authKeys,
  type Role,
  type Session,
} from '@/features/auth/api/authKeys'
import { queryClient } from '@/lib/query-client'
import i18n from '@/lib/i18n'

const STUB_USER: Session['user'] = {
  id: 'u-1',
  email: 'trang@example.com',
  fullName: 'Trang',
  emailVerified: true,
}

function seedSession(role: Role | null, centerAttached: boolean = true): void {
  const session: Session = {
    user: STUB_USER,
    accessToken: 'a.b.c',
    center: centerAttached
      ? {
          id: 'c-1',
          name: 'Saigon English Center',
          shortCode: 'saigon-english',
          brandColor: null,
          logoUrl: null,
          timezone: 'Asia/Ho_Chi_Minh',
        }
      : null,
    role,
  }
  // useRole/useRoleLoading (Story 2.6 Task 6.3) subscribe to the
  // module-singleton queryClient, NOT the per-test client passed to a
  // QueryClientProvider. Seed the singleton so useRole reads the value
  // this test expects — mirrors the shipped useAuth.test.tsx pattern.
  queryClient.setQueryData<Session>(authKeys.session(), session)
}

function renderAppLayoutWithRole(role: Role | null): {
  client: QueryClient
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  seedSession(role)
  const router = createMemoryRouter(
    [
      {
        path: '/',
        Component: () => <AppLayout />,
        children: [
          {
            index: true,
            element: <div data-testid="route-child">child content</div>,
          },
        ],
      },
    ],
    { initialEntries: ['/'] },
  )
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { client }
}

// Role-scoped `href`s each nav group EXPOSES. Wrong-role hrefs must be
// ABSENT from the DOM per TEST-FE-6, not just visually hidden.
const OWNER_ONLY_HREFS = ['/knowledge-hub', '/archive'] as const
const OWNER_HREFS = ['/dashboard', '/people/staff', '/classes', '/settings'] as const
const ADMIN_HREFS = ['/dashboard', '/people/staff', '/classes']
const ADMIN_ABSENT_HREFS = ['/settings'] // /settings is Owner-only
const TEACHER_HREFS = [
  '/dashboard',
  '/classes',
  '/exercises',
  '/students',
]
const TEACHER_ABSENT_HREFS = ['/people/staff', '/settings']
const STUDENT_HREFS = ['/dashboard', '/my-classes', '/assignments', '/my-schedule']
const STUDENT_ABSENT_HREFS = ['/settings', '/people/staff', '/classes']

beforeEach(() => {
  useUIStore.getState().reset()
  useLanguageStore.getState().reset()
  __resetWarnTrackingForTests()
  queryClient.removeQueries({ queryKey: authKeys.session() })
})
afterEach(() => {
  useUIStore.getState().reset()
  useLanguageStore.getState().reset()
  queryClient.removeQueries({ queryKey: authKeys.session() })
})

describe('AppLayout — Story 2.6 AC7 role-filtering via seeded Session.role', () => {
  test('Owner: sees Owner nav (dashboard/people/classes/settings) + Owner-only items', () => {
    renderAppLayoutWithRole('owner')
    for (const href of OWNER_HREFS) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull()
    }
    for (const href of OWNER_ONLY_HREFS) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull()
    }
  })

  test('Admin: sees Admin nav but /settings is absent from DOM (TEST-FE-6)', () => {
    renderAppLayoutWithRole('admin')
    for (const href of ADMIN_HREFS) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull()
    }
    for (const href of ADMIN_ABSENT_HREFS) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeNull()
    }
  })

  test('Teacher: sees Teacher nav, no /people/staff, no /settings (TEST-FE-6)', () => {
    renderAppLayoutWithRole('teacher')
    for (const href of TEACHER_HREFS) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull()
    }
    for (const href of TEACHER_ABSENT_HREFS) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeNull()
    }
  })

  test('Student: sees Student nav (my-classes / assignments) and NO owner nav (TEST-FE-6)', () => {
    renderAppLayoutWithRole('student')
    for (const href of STUDENT_HREFS) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull()
    }
    for (const href of STUDENT_ABSENT_HREFS) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeNull()
    }
  })

  test('role=null renders guest shell (topbar only, no sidebar nav)', () => {
    renderAppLayoutWithRole(null)
    // Sidebar wrapper never rendered — the shipped AppLayout returns null
    // in the sidebar slot when role is null (guest shell branch).
    expect(screen.queryByTestId('sidebar-nav-primary')).toBeNull()
  })
})

// ATDD RED-PHASE — Story 7-1b, Task 1 (route wiring + role gate). AC1.
//
// RED signals (two, both intentional):
//   1. `@/features/people/StaffListPage` does not exist yet (TS2307).
//   2. sectionNameKey="people" is NOT yet a member of the SectionNameKey union
//      (PermissionDenied.tsx) — passing it is a compile error until Task 1 adds
//      `people` to the union AND the app.permissionDenied.section.people.* copy
//      to en + vi. This deliberately drives the union + i18n extension.
//
// AC1: /people/staff and /people/staff/:userId sit behind
// RouteRoleGate allowedRoles={['owner','admin']}. Owner/Admin see the list;
// Teacher/Student see <PermissionDenied> with the `people`-section copy.
// This is the route-level companion to the s40 TEST-FE-6 DOM-absence assertion.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import {
  authKeys,
  type Role,
  type Session,
  type UserSummary,
} from '@/features/auth/api/authKeys'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
// RED: this module does not exist yet.
import { StaffListPage } from '@/features/people/StaffListPage'
import {
  DEFAULT_CENTER_ID,
  memberActiveTeacher,
  rosterHandlers,
} from '@/features/people/api/__tests__/handlers'

const STUB_USER: UserSummary = {
  id: 'user-viewer',
  email: 'viewer@example.com',
  fullName: 'Viewer',
  emailVerified: true,
}

function seedSession(role: Role): void {
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

function renderGatedList(role: Role): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/people/staff']}>
          <Routes>
            {/* Mirror routes.tsx: the gate is an Outlet LAYOUT route; the
                allowed content is a nested child route, not a JSX child. */}
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['owner', 'admin']}
                  requiredRolesForCopy={['owner', 'admin']}
                  sectionNameKey="people"
                />
              }
            >
              <Route path="/people/staff" element={<StaffListPage />} />
            </Route>
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

describe('People routes — RouteRoleGate (AC1)', () => {
  test.each(['owner', 'admin'] as const)(
    'P0 %s sees the staff list (allowed)',
    async (role) => {
      server.use(...rosterHandlers())
      renderGatedList(role)
      expect(await screen.findByText(memberActiveTeacher.name)).toBeInTheDocument()
      expect(screen.queryByTestId('permission-denied-section-header')).not.toBeInTheDocument()
    },
  )

  test.each(['teacher', 'student'] as const)(
    'P0 %s is denied with the people-section copy (absent list)',
    async (role) => {
      server.use(...rosterHandlers())
      renderGatedList(role)
      const header = await screen.findByTestId('permission-denied-section-header')
      expect(header).toHaveTextContent(i18n.t('app.permissionDenied.section.people.header'))
      // Negative: the roster data never renders for a denied role.
      expect(screen.queryByText(memberActiveTeacher.name)).not.toBeInTheDocument()
    },
  )

  test('P1 the people-section denial copy exists in BOTH en and vi (TEST-FE-4)', () => {
    for (const lng of ['en', 'vi'] as const) {
      expect(i18n.exists('app.permissionDenied.section.people.header', { lng })).toBe(true)
    }
  })
})

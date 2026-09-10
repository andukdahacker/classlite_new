// ATDD RED-PHASE — Story 7-3b, Task 1 (route wiring + role gate + sidebar nav). AC1, AC2, AC14.
//
// RED signals (TWO, both intentional — no `test.skip()`, repo convention is
// compile-fail red, [[reference_atdd_red_convention]]):
//   1. `@/features/people/EnrolmentPage` does not exist yet (TS2307).
//   2. `sectionNameKey="enrolment"` does NOT type-check today: `SectionNameKey`
//      (PermissionDenied.tsx:45) is a CLOSED union that omits 'enrolment'. This
//      deliberately drives the Task-1 fix: WIDEN `SectionNameKey` to include
//      'enrolment' AND add `app.permissionDenied.section.enrolment.header`
//      (en+vi). Mirrors how 7-1b's StaffRoutesGate drove the `people` union and
//      7-2b's StudentRoutesGate drove the teacher-copy widening. (Story D1/Task 1
//      names the new i18n key but the union-widening was surfaced by this scaffold.)
//
// Gate matrix (owner/admin console; no data-leak axis — reads are backend-scoped,
// 7-3a middleware RequireRole + in-service DB re-fetch):
//   • /people/enrolment → allowedRoles ['owner','admin']  (teacher/student denied)
// Plus the sidebar contract: a NEW "Enrolment" People item for owner+admin only.
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
import { SIDEBAR_NAV_BY_ROLE } from '@/components/domain/sidebarNavConfig'
import { classesHandlers } from '@/features/classes/api/__tests__/handlers'
import { centerRosterHandlers } from '@/features/people/api/__tests__/studentHandlers'
import { historyHandlers, attentionHandlers } from '@/features/people/api/__tests__/enrolmentHandlers'
// RED: this module does not exist yet — the whole file fails to import.
import { EnrolmentPage } from '@/features/people/EnrolmentPage'

const ENROLMENT_HREF = '/people/enrolment'

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
      id: 'c-1',
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

function allEnrolmentHandlers() {
  // The page mounts all three zones → satisfy every query it fires.
  return [
    ...historyHandlers(),
    ...attentionHandlers(),
    ...centerRosterHandlers(), // student combobox options
    ...classesHandlers, // target-class picker
  ]
}

function renderEnrolmentRoute(role: Role): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[ENROLMENT_HREF]}>
          <Routes>
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['owner', 'admin']}
                  requiredRolesForCopy={['owner', 'admin']}
                  sectionNameKey="enrolment"
                />
              }
            >
              <Route path="/people/enrolment" element={<EnrolmentPage />} />
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

describe('Enrolment route gate /people/enrolment (AC1)', () => {
  test.each(['owner', 'admin'] as const)('P0 %s reaches the console (allowed)', async (role) => {
    server.use(...allEnrolmentHandlers())
    renderEnrolmentRoute(role)
    // SEAM: EnrolmentPage exposes data-testid="enrolment-page".
    expect(await screen.findByTestId('enrolment-page')).toBeInTheDocument()
    expect(screen.queryByTestId('permission-denied-section-header')).not.toBeInTheDocument()
  })

  test.each(['teacher', 'student'] as const)('P0 %s is denied (no console)', async (role) => {
    server.use(...allEnrolmentHandlers())
    renderEnrolmentRoute(role)
    expect(await screen.findByTestId('permission-denied-section-header')).toBeInTheDocument()
    expect(screen.queryByTestId('enrolment-page')).not.toBeInTheDocument()
  })
})

describe('Enrolment denied copy (AC14, TEST-FE-4)', () => {
  test('P1 section.enrolment.header exists in BOTH en and vi', () => {
    for (const lng of ['en', 'vi'] as const) {
      expect(i18n.exists('app.permissionDenied.section.enrolment.header', { lng })).toBe(true)
    }
  })
})

describe('Sidebar — NEW Enrolment item (AC2, TEST-FE-6)', () => {
  function hasEnrolmentItem(role: Role): boolean {
    return SIDEBAR_NAV_BY_ROLE[role].some((group) =>
      group.items.some((item) => item.href === ENROLMENT_HREF),
    )
  }

  test.each(['owner', 'admin'] as const)('P1 %s sidebar includes an Enrolment item', (role) => {
    expect(hasEnrolmentItem(role)).toBe(true)
  })

  test.each(['teacher', 'student'] as const)(
    'P1 %s sidebar does NOT include an Enrolment item (absent)',
    (role) => {
      expect(hasEnrolmentItem(role)).toBe(false)
    },
  )

  test('P1 sidebar enrolment labels exist in BOTH en and vi', () => {
    for (const lng of ['en', 'vi'] as const) {
      expect(i18n.exists('sidebar.owner.enrolment', { lng })).toBe(true)
      expect(i18n.exists('sidebar.admin.enrolment', { lng })).toBe(true)
    }
  })
})

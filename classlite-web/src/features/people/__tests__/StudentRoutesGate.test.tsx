// ATDD RED-PHASE — Story 7-2b, Task 1 (route wiring + role gates). AC1, AC2, AC3.
//
// RED signals (TWO, both intentional — no `test.skip()`, repo convention is
// compile-fail red, [[reference_atdd_red_convention]]):
//   1. `@/features/people/StudentsTeacherPage` + `StudentsCenterPage` do not
//      exist yet (TS2307).
//   2. `requiredRolesForCopy={['teacher']}` does NOT type-check today:
//      `PermissionDeniedRoles = ['owner','admin'] | ['owner']`
//      (PermissionDenied.tsx:32) cannot express a teacher-gated route, and
//      `bodyKey`/`requiredRoleSummaryKey` branch only owner-vs-owner+admin.
//      This deliberately drives the Task-1 D1 fix: WIDEN `PermissionDeniedRoles`
//      to accept `['teacher']`, add teacher body/summary copy, AND broaden the
//      owner/admin-worded `section.students` header to staff-inclusive (en+vi).
//      Mirrors how 7-1b's StaffRoutesGate drove the `people` SectionNameKey union.
//
// The security spine of 7-2b (risk 5): teacher role-scope is enforced
// server-side (404 non-disclosure, 7-2a D3/D11) — these route-gate tests are the
// UI companion, proving the ALLOW/DENY matrix at the router edge:
//   • /students*        → allowedRoles ['teacher']         (owner/admin/student denied)
//   • /people/students* → allowedRoles ['owner','admin']   (teacher/student denied)
// Denied copy must be STAFF-inclusive (D1 fix): the shipped section.students copy
// is owner/admin-worded ("available to owners and admins") — wrong on the teacher
// route. This drives the broadening.
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
// RED: neither module exists yet.
import { StudentsTeacherPage } from '@/features/people/StudentsTeacherPage'
import { StudentsCenterPage } from '@/features/people/StudentsCenterPage'
import {
  DEFAULT_CENTER_ID,
  studentGood,
  teacherRosterHandlers,
  centerRosterHandlers,
} from '@/features/people/api/__tests__/studentHandlers'

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

function renderTeacherRoute(role: Role): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/students']}>
          <Routes>
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['teacher']}
                  requiredRolesForCopy={['teacher']}
                  sectionNameKey="students"
                />
              }
            >
              <Route path="/students" element={<StudentsTeacherPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

function renderCenterRoute(role: Role): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/people/students']}>
          <Routes>
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['owner', 'admin']}
                  requiredRolesForCopy={['owner', 'admin']}
                  sectionNameKey="students"
                />
              }
            >
              <Route path="/people/students" element={<StudentsCenterPage />} />
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

describe('Student routes — teacher roster gate /students (AC1)', () => {
  test('P0 a teacher sees the roster (allowed)', async () => {
    server.use(...teacherRosterHandlers())
    renderTeacherRoute('teacher')
    expect(await screen.findByText(studentGood.name)).toBeInTheDocument()
    expect(screen.queryByTestId('permission-denied-section-header')).not.toBeInTheDocument()
  })

  test.each(['owner', 'admin', 'student'] as const)(
    'P0 %s is denied /students (center list is the owner/admin surface, not this one)',
    async (role) => {
      server.use(...teacherRosterHandlers())
      renderTeacherRoute(role)
      expect(await screen.findByTestId('permission-denied-section-header')).toBeInTheDocument()
      expect(screen.queryByText(studentGood.name)).not.toBeInTheDocument()
    },
  )

  test('P1 the students-section denial copy is STAFF-inclusive, not owner/admin-only (D1 fix)', async () => {
    server.use(...teacherRosterHandlers())
    renderTeacherRoute('student')
    const header = await screen.findByTestId('permission-denied-section-header')
    // A teacher-gated route must NOT show "owners and admins"-only wording.
    expect(header.textContent ?? '').not.toMatch(/owners and admins/i)
  })
})

describe('Student routes — center list gate /people/students (AC2)', () => {
  test.each(['owner', 'admin'] as const)(
    'P0 %s sees the center-wide list (allowed)',
    async (role) => {
      server.use(...centerRosterHandlers())
      renderCenterRoute(role)
      expect(await screen.findByText(studentGood.name)).toBeInTheDocument()
      expect(screen.queryByTestId('permission-denied-section-header')).not.toBeInTheDocument()
    },
  )

  test.each(['teacher', 'student'] as const)(
    'P0 %s is denied /people/students (absent list)',
    async (role) => {
      server.use(...centerRosterHandlers())
      renderCenterRoute(role)
      expect(await screen.findByTestId('permission-denied-section-header')).toBeInTheDocument()
      expect(screen.queryByText(studentGood.name)).not.toBeInTheDocument()
    },
  )

  test('P1 the students-section denial copy exists in BOTH en and vi (TEST-FE-4)', () => {
    for (const lng of ['en', 'vi'] as const) {
      expect(i18n.exists('app.permissionDenied.section.students.header', { lng })).toBe(true)
    }
  })
})

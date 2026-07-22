// ATDD RED-PHASE — Story 3.4, Task 0 (AC9 — deferred student surface).
//
// RED signal: `@/features/schedule/MySchedulePage` does not exist yet (import
// failure). GREEN: Task 9.
//
// AC9: /my-schedule (s32) is a TRUTHFUL <20-line dormant STUB (enrollments are
// Epic 7 — FU-3-4-A). It must render an EMPTY STATE (not a rendered calendar,
// not an error, not a spinner) with honest copy + the twin disclaimers. The
// student must NOT see the staff schedule-workspace, and there must be NO
// session data fetch (no /api/sessions call for students).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
// RED: this module lands in Story 3.4 Task 9.
import { MySchedulePage } from '@/features/schedule/MySchedulePage'

const CENTER_ID = '00000000-0000-0000-0000-000000000001'
const STUB_USER: UserSummary = {
  id: 'student-under-test',
  email: 'student@example.com',
  fullName: 'Student S',
  emailVerified: true,
}

function seedSession(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: STUB_USER,
    accessToken: 'a.b.c',
    center: {
      id: CENTER_ID,
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role,
  })
}

function renderMySchedule(role: Role): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/my-schedule']}>
          <Routes>
            <Route
              element={<RouteRoleGate allowedRoles={['student']} requiredRolesForCopy={['owner', 'admin']} sectionNameKey="schedule" />}
            >
              <Route path="/my-schedule" element={<MySchedulePage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
})
afterEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
})

describe('MySchedulePage — deferred student stub (AC9)', () => {
  test('student sees the truthful empty-state stub', async () => {
    renderMySchedule('student')
    expect(await screen.findByTestId('my-schedule-placeholder')).toBeInTheDocument()
    // honest copy: schedule lives here once a teacher enrolls them
    expect(screen.getByText(i18n.t('mySchedule.empty.headline'))).toBeInTheDocument()
  })

  test('the stub is NOT the staff workspace and renders no calendar grid', () => {
    renderMySchedule('student')
    expect(screen.queryByTestId('schedule-workspace')).not.toBeInTheDocument()
    // empty state, not an error, not a spinner
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTestId('schedule-skeleton')).not.toBeInTheDocument()
  })
})

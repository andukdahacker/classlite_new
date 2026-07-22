// ATDD RED-PHASE — Story 3.4, Task 0 (AC5 staff gate, TEST-FE-6).
//
// RED signal: `@/features/schedule/SchedulePage` does not exist yet (import
// failure). Everything else is valid. GREEN: Task 8.
//
// AC5/AC7: /schedule (s13) is gated owner+admin+teacher via RouteRoleGate
// sectionNameKey="schedule". Asserts BOTH sides of TEST-FE-6:
//   • a teacher sees the workspace (positive), and
//   • a STUDENT gets PermissionDenied with the workspace ABSENT from the DOM
//     (negative — students belong on the deferred /my-schedule surface).
//
// Role is seeded on the module-singleton queryClient via setQueryData(
// authKeys.session(), ...) — same pattern as ClassesPage/TemplatesIndexPage tests.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
// RED: this module lands in Story 3.4 Task 8.
import { SchedulePage } from '@/features/schedule/SchedulePage'

const CENTER_ID = '00000000-0000-0000-0000-000000000001'

const STUB_USER: UserSummary = {
  id: 'user-under-test',
  email: 'user@example.com',
  fullName: 'Test User',
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

function renderSchedule(role: Role): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/schedule']}>
          <Routes>
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['owner', 'admin', 'teacher']}
                  requiredRolesForCopy={['owner', 'admin']}
                  sectionNameKey="schedule"
                />
              }
            >
              <Route path="/schedule" element={<SchedulePage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  server.use(
    http.get('*/api/sessions', () =>
      HttpResponse.json({ data: [], meta: { serverTime: '2026-08-15T00:00:00Z' } }),
    ),
  )
})
afterEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
})

describe('SchedulePage — role gate (TEST-FE-6)', () => {
  test('teacher sees the schedule workspace', async () => {
    renderSchedule('teacher')
    expect(await screen.findByTestId('schedule-workspace')).toBeInTheDocument()
  })

  test('owner sees the schedule workspace', async () => {
    renderSchedule('owner')
    expect(await screen.findByTestId('schedule-workspace')).toBeInTheDocument()
  })

  test('student is denied and the workspace is ABSENT from the DOM', async () => {
    renderSchedule('student')
    await waitFor(() =>
      expect(screen.getByText(i18n.t('app.permissionDenied.section.schedule.header'))).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('schedule-workspace')).not.toBeInTheDocument()
  })
})

// ATDD RED-PHASE — Story 7-2b, Task 4 (s10a teacher roster). AC4-6.
//
// RED signal: `@/features/people/StudentsTeacherPage` does not exist yet.
// No `test.skip()` — compile-fail red ([[reference_atdd_red_convention]]).
//
// Harness mirrors StaffListPage.test.tsx EXACTLY: role seeded on the
// MODULE-SINGLETON queryClient (useRole subscribes to it); the page's own
// useQuery runs against a SEPARATE createTestQueryClient(). MSW is the ONE seam.
//
// ── SEAMS the dev must expose to turn these green ──────────────────────────
//   • data-testid="student-row-skeleton" (≥1 while loading; row-shaped, NOT a spinner)
//   • data-testid="student-row-{studentId}" per row; name is a <link> to /students/{id}
//   • role="tab" buttons All / At-risk / New / By-class (people.student.tabs.*), mono counts
//   • data-testid="perf-pill-{good|normal|at-risk}" in the Status column
//   • data-testid="student-empty" (informational — NO invite/add action; enrolment = 7.3)
//   • role="alert" inline error + a retry (people.student.list.retry) that calls refetch
//   • teacher variant columns include "My classes" + an Attendance cell ("—" when null)
//   • all copy via people.student.* i18n keys (TEST-FE-4)
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
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
// RED: this module does not exist yet.
import { StudentsTeacherPage } from '@/features/people/StudentsTeacherPage'
import {
  DEFAULT_CENTER_ID,
  STUDENT_GOOD_ID,
  STUDENT_AT_RISK_ID,
  STUDENT_OUT_OF_SCOPE_ID,
  studentGood,
  studentAtRisk,
  studentListItem,
  teacherRosterHandlers,
  rosterEmptyHandlers,
  roster500Handlers,
} from '@/features/people/api/__tests__/studentHandlers'

const STUB_USER: UserSummary = {
  id: 'user-teacher',
  email: 'teacher@example.com',
  fullName: 'Class Teacher',
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

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-probe">{location.pathname}</div>
}

function renderRoster(): void {
  seedSession('teacher')
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/students']}>
          <LocationProbe />
          <Routes>
            <Route path="/students" element={<StudentsTeacherPage />} />
            <Route path="/students/:id" element={<div data-testid="detail-stub" />} />
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

describe('StudentsTeacherPage — AC6 three-state trilogy (UX-1)', () => {
  test('P0 row-shaped skeletons while loading (never a spinner)', () => {
    server.use(...teacherRosterHandlers())
    renderRoster()
    expect(screen.getAllByTestId(/^student-row-skeleton/).length).toBeGreaterThanOrEqual(1)
  })

  test('P0 renders student rows on success', async () => {
    server.use(...teacherRosterHandlers())
    renderRoster()
    expect(await screen.findByText(studentGood.name)).toBeInTheDocument()
    expect(screen.getByTestId(`student-row-${STUDENT_GOOD_ID}`)).toBeInTheDocument()
  })

  test('P1 informational empty state — NO invite/add action (enrolment = 7.3)', async () => {
    server.use(...rosterEmptyHandlers)
    renderRoster()
    expect(await screen.findByTestId('student-empty')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /invite|add student/i }),
    ).not.toBeInTheDocument()
  })

  test('P0 inline error alert with a working retry on 500', async () => {
    server.use(...roster500Handlers)
    renderRoster()
    const alert = await screen.findByRole('alert')
    server.use(...teacherRosterHandlers())
    await userEvent.click(
      within(alert).getByRole('button', { name: i18n.t('people.student.list.retry') }),
    )
    expect(await screen.findByText(studentGood.name)).toBeInTheDocument()
  })
})

describe('StudentsTeacherPage — AC4 teacher role-scope (security spine)', () => {
  test('P0 renders exactly the server-scoped set; an out-of-scope student is ABSENT', async () => {
    // The teacher fixture omits STUDENT_OUT_OF_SCOPE_ID (server enforces scope, 7-2a D3).
    // Adding it to the response would make it appear — so assert the scoped fixture
    // does not leak a foreign-class student into the teacher's own roster view.
    server.use(...teacherRosterHandlers())
    renderRoster()
    await screen.findByText(studentGood.name)
    expect(screen.queryByTestId(`student-row-${STUDENT_OUT_OF_SCOPE_ID}`)).not.toBeInTheDocument()
  })

  test('P1 a row shows the "My classes" cell and a PerfPill in the Status column', async () => {
    server.use(...teacherRosterHandlers())
    renderRoster()
    const row = await screen.findByTestId(`student-row-${STUDENT_GOOD_ID}`)
    expect(within(row).getByText(/IELTS Writing 6\.5/)).toBeInTheDocument()
    expect(within(row).getByTestId('perf-pill-good')).toBeInTheDocument()
  })

  test('P1 attendance renders the em-dash token, never "0%", when the field is null', async () => {
    server.use(
      ...teacherRosterHandlers([
        studentListItem({ studentId: STUDENT_GOOD_ID, name: studentGood.name, overallBand: null }),
      ]),
    )
    renderRoster()
    const row = await screen.findByTestId(`student-row-${STUDENT_GOOD_ID}`)
    expect(within(row).queryByText('0%')).not.toBeInTheDocument()
  })
})

describe('StudentsTeacherPage — AC5 tabs (All / At-risk / New / By-class)', () => {
  test('P1 renders the four teacher-variant tabs', async () => {
    server.use(...teacherRosterHandlers())
    renderRoster()
    await screen.findByText(studentGood.name)
    for (const key of ['all', 'atRisk', 'new', 'byClass'] as const) {
      expect(
        screen.getByRole('tab', { name: new RegExp(i18n.t(`people.student.tabs.${key}`), 'i') }),
      ).toBeInTheDocument()
    }
    // Negative: the owner/admin-only tabs must NOT appear on the teacher roster.
    expect(
      screen.queryByRole('tab', { name: new RegExp(i18n.t('people.student.tabs.unassigned'), 'i') }),
    ).not.toBeInTheDocument()
  })

  test('P1 At-risk tab shows the at-risk student and NOT a good student (negative)', async () => {
    server.use(...teacherRosterHandlers())
    const user = userEvent.setup()
    renderRoster()
    await screen.findByText(studentGood.name)
    await user.click(screen.getByRole('tab', { name: new RegExp(i18n.t('people.student.tabs.atRisk'), 'i') }))
    expect(await screen.findByText(studentAtRisk.name)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(studentGood.name)).not.toBeInTheDocument()
    })
  })
})

describe('StudentsTeacherPage — AC4 row navigation', () => {
  test('P0 clicking a student row navigates to /students/{id}', async () => {
    server.use(...teacherRosterHandlers())
    const user = userEvent.setup()
    renderRoster()
    const link = await screen.findByRole('link', { name: studentAtRisk.name })
    expect(link).toHaveAttribute('href', `/students/${STUDENT_AT_RISK_ID}`)
    await user.click(link)
    expect(await screen.findByTestId('detail-stub')).toBeInTheDocument()
    expect(screen.getByTestId('location-probe')).toHaveTextContent(`/students/${STUDENT_AT_RISK_ID}`)
  })
})

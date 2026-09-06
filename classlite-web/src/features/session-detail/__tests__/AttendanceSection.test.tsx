// Story 3.5b (AC5/AC12/AC13/AC14/AC15 · D9/D11/D12/D13) — the live AttendanceSection
// that replaces the dormant AttendancePlaceholder on s12. RED phase: this file
// imports the GREENFIELD module `@/features/session-detail/components/AttendanceSection`
// and its `api/attendanceApi` hooks, neither of which exists yet — so `tsc -b`
// fails (the FE red convention: import-missing-modules, not test.skip). The dev
// turns it green by building Task 7/8.
//
// Mirrors SessionDetailPage.test.tsx: MSW at the HTTP boundary (TEST-FE-1), real
// QueryClient, role seeded on the module-singleton via authKeys.session(), i18n
// key-existence in BOTH locales (TEST-FE-4), and the TEST-FE-6 role-negative gate.
//
// GREEN SEAMS (dev — Task 7/8):
//   components/AttendanceSection.tsx        — roster table + AttendanceToggle + summary
//   api/attendanceApi.ts                    — useSessionAttendance / useSetAttendance / useBulkAttendance
//   components/AttendanceToggle.tsx (domain) — Present/Late/Absent, LOUD unmarked, NO clear
//   i18n flat keys session.attendance.status.* / .summary / .markAll* / .undo / .empty.* / .bulkError

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
// GREENFIELD import — does not exist yet → tsc -b RED until Task 8.
import { AttendanceSection } from '@/features/session-detail/components/AttendanceSection'

const CENTER_ID = '00000000-0000-0000-0000-000000000001'
const SESSION_ID = '11111111-1111-1111-1111-111111111111'
const MARKED_SID = '22222222-2222-2222-2222-222222222222'
const UNMARKED_SID = '33333333-3333-3333-3333-333333333333'

const STUB_USER: UserSummary = {
  id: 'teacher-under-test',
  email: 'teacher@example.com',
  fullName: 'Teacher T',
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

function rosterResponse() {
  return {
    data: {
      roster: [
        { studentId: MARKED_SID, name: 'Marked Student', email: 'marked@x.com', status: 'late', markedAt: '2026-09-03T10:00:00Z' },
        { studentId: UNMARKED_SID, name: 'Unmarked Student', email: 'unmarked@x.com', status: null, markedAt: null },
      ],
    },
  }
}

function renderSection() {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AttendanceSection sessionId={SESSION_ID} />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
  seedSession('teacher')
})
afterEach(() => server.resetHandlers())

describe('AttendanceSection (s12)', () => {
  // AC15 — i18n key existence in BOTH locales, no hardcoded English.
  test('all attendance i18n keys resolve in en and vi', () => {
    const keys = [
      'session.attendance.status.present',
      'session.attendance.status.late',
      'session.attendance.status.absent',
      'session.attendance.summary',
      'session.attendance.markAllPresent',
      'session.attendance.markAllAbsent',
      'session.attendance.undo',
      'session.attendance.empty.owner',
      'session.attendance.empty.teacher',
      'session.attendance.bulkError',
      'session.attendance.rowError',
      'session.attendance.enrolCta',
    ]
    for (const lng of ['en', 'vi']) {
      for (const k of keys) {
        expect(i18n.getFixedT(lng)(k), `${k} missing in ${lng}`).not.toBe(k)
      }
    }
  })

  // AC12 — loading skeleton → live roster + marked-count summary; unmarked row LOUD.
  test('renders skeleton then the live roster with a marked-count summary', async () => {
    server.use(http.get(`*/api/sessions/${SESSION_ID}/attendance`, () => HttpResponse.json(rosterResponse())))
    renderSection()
    expect(screen.getByTestId('attendance-skeleton')).toBeInTheDocument()

    await screen.findByText('Marked Student')
    expect(screen.getByText('Unmarked Student')).toBeInTheDocument()
    // AC12 — a marked-count summary is present (1/2 marked).
    expect(screen.getByTestId('attendance-summary')).toBeInTheDocument()
    // AC12/D9 — the unmarked row is visually distinct (a data-flag the a11y/tests can assert).
    const unmarkedRow = screen.getByTestId(`attendance-row-${UNMARKED_SID}`)
    expect(unmarkedRow).toHaveAttribute('data-unmarked', 'true')
  })

  // AC5 — role-aware empty state: a teacher gets the "ask your admin" copy, no dead CTA.
  test('teacher empty state shows the ask-admin copy, not an enrolment link', async () => {
    server.use(http.get(`*/api/sessions/${SESSION_ID}/attendance`, () => HttpResponse.json({ data: { roster: [] } })))
    renderSection()
    await screen.findByText(i18n.t('session.attendance.empty.teacher'))
    expect(screen.queryByRole('link', { name: i18n.t('session.attendance.enrolCta') })).not.toBeInTheDocument()
  })

  // AC5 — role-aware empty state (positive): an owner gets the onboarding copy AND
  // an actionable enrolment link (the teacher branch's counterpart — the CTA the
  // teacher must NOT see).
  test('owner empty state shows the onboarding copy and an actionable enrolment link', async () => {
    seedSession('owner')
    server.use(http.get(`*/api/sessions/${SESSION_ID}/attendance`, () => HttpResponse.json({ data: { roster: [] } })))
    renderSection()
    await screen.findByText(i18n.t('session.attendance.empty.owner'))
    expect(screen.getByRole('link', { name: i18n.t('session.attendance.enrolCta') })).toBeInTheDocument()
    // negative counterpart — the teacher's ask-admin copy is absent for an owner.
    expect(screen.queryByText(i18n.t('session.attendance.empty.teacher'))).not.toBeInTheDocument()
  })

  // AC12 — error trilogy: retry-able alert on network failure.
  test('renders a retry-able error alert on fetch failure', async () => {
    server.use(http.get(`*/api/sessions/${SESSION_ID}/attendance`, () => HttpResponse.error()))
    renderSection()
    await screen.findByRole('alert')
  })

  // AC13 / D11 — a per-row toggle mutates optimistically AND offers no un-mark/clear path.
  test('toggle sets status optimistically and exposes no clear/un-mark control', async () => {
    server.use(
      http.get(`*/api/sessions/${SESSION_ID}/attendance`, () => HttpResponse.json(rosterResponse())),
      http.put(`*/api/sessions/${SESSION_ID}/attendance/${UNMARKED_SID}`, () =>
        HttpResponse.json({ data: { studentId: UNMARKED_SID, name: 'Unmarked Student', email: 'unmarked@x.com', status: 'present', markedAt: '2026-09-03T10:05:00Z' } }),
      ),
    )
    renderSection()
    const row = await screen.findByTestId(`attendance-row-${UNMARKED_SID}`)
    await userEvent.click(within(row).getByRole('button', { name: i18n.t('session.attendance.status.present') }))
    await waitFor(() => expect(within(row).getByRole('button', { name: i18n.t('session.attendance.status.present') })).toHaveAttribute('aria-pressed', 'true'))
    // D11 — write-once-editable: there is NO clear/un-mark affordance in the row.
    expect(within(row).queryByRole('button', { name: /clear|unmark|un-mark/i })).not.toBeInTheDocument()
  })

  // AC14 / D12 — "Mark all Absent" applies then shows an UNDO toast (destructive-path safety).
  test('Mark all Absent shows an undo affordance', async () => {
    server.use(
      http.get(`*/api/sessions/${SESSION_ID}/attendance`, () => HttpResponse.json(rosterResponse())),
      http.post(`*/api/sessions/${SESSION_ID}/attendance/bulk`, () => HttpResponse.json(rosterResponse())),
    )
    renderSection()
    await screen.findByText('Marked Student')
    await userEvent.click(screen.getByRole('button', { name: i18n.t('session.attendance.markAllAbsent') }))
    await screen.findByRole('button', { name: i18n.t('session.attendance.undo') })
  })

  // AC14 / D13 — an atomic bulk FAILURE snaps back and shows ONE banner, not N row errors.
  test('bulk failure surfaces a single banner and reverts', async () => {
    server.use(
      http.get(`*/api/sessions/${SESSION_ID}/attendance`, () => HttpResponse.json(rosterResponse())),
      http.post(`*/api/sessions/${SESSION_ID}/attendance/bulk`, () => HttpResponse.error()),
    )
    renderSection()
    await screen.findByText('Marked Student')
    await userEvent.click(screen.getByRole('button', { name: i18n.t('session.attendance.markAllPresent') }))
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(i18n.t('session.attendance.bulkError'))
  })

  // TEST-FE-6 / AC14 negative — a non-owning teacher (API 404s) renders NO write controls.
  test('a 404 (non-owning teacher) renders no write controls', async () => {
    server.use(
      http.get(`*/api/sessions/${SESSION_ID}/attendance`, () =>
        HttpResponse.json({ error: { code: 'SESSION_NOT_FOUND', message: 'not found', requestId: 'r' } }, { status: 404 }),
      ),
    )
    renderSection()
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: i18n.t('session.attendance.markAllPresent') })).not.toBeInTheDocument()
  })

  // TEST-FE-5 — no a11y violations on the loaded roster.
  test('has no accessibility violations', async () => {
    server.use(http.get(`*/api/sessions/${SESSION_ID}/attendance`, () => HttpResponse.json(rosterResponse())))
    const { container } = renderSection()
    await screen.findByText('Marked Student')
    expect(await axe(container)).toHaveNoViolations()
  })
})

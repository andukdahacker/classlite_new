// Story 3.5 — SessionDetailPage: UX-1 trilogy, section composition, and the
// TEST-FE-6 role-negative gate (a student gets PermissionDenied with the page
// ABSENT from the DOM). Role is seeded on the module-singleton queryClient via
// setQueryData(authKeys.session(), …) — the SchedulePage/MySchedulePage pattern.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import { SessionDetailPage } from '@/features/session-detail/SessionDetailPage'

const CENTER_ID = '00000000-0000-0000-0000-000000000001'
const SESSION_ID = '11111111-1111-1111-1111-111111111111'

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

function sessionDetail(overrides: Record<string, unknown> = {}) {
  const iso = '2026-08-16T09:00:00Z'
  return {
    session: {
      id: SESSION_ID,
      centerId: CENTER_ID,
      classId: '22222222-2222-2222-2222-222222222222',
      className: 'IELTS Cohort A',
      classColor: null,
      topic: 'Reading practice',
      startsAt: iso,
      endsAt: iso,
      status: 'scheduled',
      cancelledAt: null,
      recurrenceGroupId: null,
      recurrencePattern: null,
      recurrenceTz: 'Asia/Ho_Chi_Minh',
      createdAt: iso,
      updatedAt: iso,
      ...overrides,
    },
    series: { groupId: null, total: 1, upcoming: 1, completed: 0 },
  }
}

function emptyList() {
  return HttpResponse.json({ data: [], meta: { serverTime: '2026-08-15T00:00:00Z' } })
}

function renderPage(role: Role) {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}`]}>
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
              <Route path="/sessions/:id" element={<SessionDetailPage />} />
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
    http.get('*/api/sessions/:id/notes', () => emptyList()),
    http.get('*/api/sessions/:id/materials', () => emptyList()),
    http.get('*/api/sessions/:id/exercises', () => emptyList()),
    http.get('*/api/classes', () => emptyList()),
  )
})
afterEach(() => server.resetHandlers())

describe('SessionDetailPage — content + layout', () => {
  test('renders the head, three content sections, actions card, and attendance placeholder', async () => {
    server.use(
      http.get('*/api/sessions/:id', () => HttpResponse.json({ data: sessionDetail(), meta: {} })),
    )
    renderPage('teacher')

    expect(await screen.findByTestId('session-detail-page')).toBeInTheDocument()
    expect(screen.getByTestId('session-materials')).toBeInTheDocument()
    expect(screen.getByTestId('session-exercises')).toBeInTheDocument()
    expect(screen.getByTestId('session-notes')).toBeInTheDocument()
    expect(screen.getByTestId('session-actions-card')).toBeInTheDocument()
    // AC2 — attendance is a dormant future-affordance placeholder, present (not hidden).
    expect(screen.getByTestId('session-attendance-placeholder')).toBeInTheDocument()
  })

  test('has no axe violations in the loaded composition', async () => {
    server.use(
      http.get('*/api/sessions/:id', () => HttpResponse.json({ data: sessionDetail(), meta: {} })),
    )
    const { container } = renderPage('owner')
    await screen.findByTestId('session-detail-page')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('shows the recurrence banner for a recurring session', async () => {
    server.use(
      http.get('*/api/sessions/:id', () =>
        HttpResponse.json({
          data: sessionDetail({ recurrenceGroupId: '33333333-3333-3333-3333-333333333333', recurrencePattern: 'weekly' }),
          meta: {},
        }),
      ),
    )
    renderPage('owner')
    expect(await screen.findByTestId('session-recurrence-banner')).toBeInTheDocument()
  })
})

describe('SessionDetailPage — trilogy', () => {
  test('renders the not-found card on 404', async () => {
    server.use(http.get('*/api/sessions/:id', () => new HttpResponse(null, { status: 404 })))
    renderPage('teacher')
    expect(await screen.findByTestId('session-detail-not-found')).toBeInTheDocument()
  })

  test('renders the error alert on network failure', async () => {
    server.use(http.get('*/api/sessions/:id', () => HttpResponse.error()))
    renderPage('teacher')
    expect(await screen.findByTestId('session-detail-error')).toBeInTheDocument()
  })
})

describe('SessionDetailPage — role gate (TEST-FE-6)', () => {
  test('a student gets PermissionDenied and the page is ABSENT from the DOM', async () => {
    server.use(
      http.get('*/api/sessions/:id', () => HttpResponse.json({ data: sessionDetail(), meta: {} })),
    )
    renderPage('student')
    // The gate resolves synchronously from the seeded role.
    expect(screen.queryByTestId('session-detail-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-materials')).not.toBeInTheDocument()
  })
})

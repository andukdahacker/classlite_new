// Story 5.2c (TEST-FE-1..6, TEST-UX-1) — AssignmentsListPage component tests.
// MSW at the HTTP boundary (never mock Query); real QueryClient + real Zustand.
// Covers:
//   - three-state trilogy (skeleton / rows / error) + student-tone empty
//   - role-negative: student allowed; teacher/owner denied → list ABSENT
//   - CTA/status mapping per submissionStatus × skill incl. "Available soon"
//   - overdue marker (+ late-penalty hint)
//   - pagination (server order preserved, next-page slice)
//   - deadline i18n in BOTH locales + i18n parity + axe on every state
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, delay, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import {
  authKeys,
  type Role,
  type Session,
  type UserSummary,
} from '@/features/auth/api/authKeys'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import { AssignmentsListPage } from '@/features/assignments'
import type { components } from '@/lib/api/client'

type Item = components['schemas']['StudentAssignmentListItem']
type ExerciseSkill = components['schemas']['ExerciseSkill']
type SubmissionStatus = components['schemas']['SubmissionStatus']

const CENTER_ID = 'c-1'
const STUDENT_ID = 'user-student'
const SERVER_NOW = '2026-08-04T00:00:00Z'
const FUTURE = '2026-08-20T00:00:00Z'
const PAST = '2026-08-01T00:00:00Z'

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'a-' + Math.random().toString(36).slice(2, 8),
    exerciseId: 'ex-1',
    classId: 'cl-1',
    status: 'open',
    deadlineAt: FUTURE,
    hardDeadlineAt: null,
    instructions: null,
    latePenalty: 0,
    createdAt: SERVER_NOW,
    updatedAt: SERVER_NOW,
    exerciseTitle: 'Untitled',
    exerciseSkill: 'reading' as ExerciseSkill,
    submissionId: null,
    submissionStatus: null,
    ...overrides,
  }
}

// listHandler mirrors the server: server order preserved, page slicing over the
// caller's enrollment-scoped set, EnvelopeMetaListPaginated meta.
function listHandler(all: Item[]) {
  return http.get('/api/assignments', ({ request }) => {
    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page') ?? '1')
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20')
    const total = all.length
    const start = (page - 1) * pageSize
    const items = all.slice(start, start + pageSize)
    return HttpResponse.json({
      data: items,
      meta: {
        serverTime: SERVER_NOW,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
    })
  })
}

const STUB_USER: UserSummary = {
  id: STUDENT_ID,
  email: 'student@example.com',
  fullName: 'Student',
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

/** Render the bare page (student session already seeded). */
function renderPage(role: Role = 'student'): ReturnType<typeof render> {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/assignments']}>
          <Routes>
            <Route path="/assignments" element={<AssignmentsListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

/** Render behind the SAME student gate wired in routes.tsx (TEST-FE-6). */
function renderPageWithGate(role: Role): ReturnType<typeof render> {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/assignments']}>
          <Routes>
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['student']}
                  requiredRolesForCopy={['owner', 'admin']}
                  sectionNameKey="assignments"
                />
              }
            >
              <Route path="/assignments" element={<AssignmentsListPage />} />
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
afterEach(async () => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  server.resetHandlers()
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

describe('AssignmentsListPage — trilogy (TEST-FE-2 + UX-1)', () => {
  test('renders skeleton rows while loading', () => {
    server.use(listHandler([item({ exerciseTitle: 'Reading Quiz' })]))
    renderPage()
    expect(
      screen.getAllByTestId(/^assignment-row-skeleton/).length,
    ).toBeGreaterThanOrEqual(1)
  })

  test('renders assignment rows on success in server order', async () => {
    server.use(
      listHandler([
        item({ id: 'a1', exerciseTitle: 'Due Soonest', deadlineAt: PAST, submissionStatus: 'submitted' }),
        item({ id: 'a2', exerciseTitle: 'Due Later' }),
      ]),
    )
    renderPage()
    expect(await screen.findByText('Due Soonest')).toBeInTheDocument()
    const list = screen.getByTestId('assignments-list')
    const rows = list.querySelectorAll('li')
    // Server order preserved (NOT re-sorted client-side, XL-2).
    expect(rows[0]).toHaveTextContent('Due Soonest')
    expect(rows[1]).toHaveTextContent('Due Later')
  })

  test('renders inline error alert + retry when GET /api/assignments fails', async () => {
    server.use(
      http.get('/api/assignments', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r' } },
          { status: 500 },
        ),
      ),
    )
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(i18n.t('assignments.error.body'))
    expect(
      screen.getByRole('button', { name: i18n.t('assignments.error.retry') }),
    ).toBeInTheDocument()
  })

  test('student-tone empty state (not "No data found") when there are no assignments', async () => {
    server.use(listHandler([]))
    renderPage()
    expect(await screen.findByTestId('assignments-empty')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('assignments.empty.headline'))).toBeInTheDocument()
  })
})

describe('AssignmentsListPage — CTA + status mapping (AC4)', () => {
  test('not-started reading → Start CTA links to the 5.2b attempt route', async () => {
    server.use(listHandler([item({ id: 'q1', exerciseTitle: 'Quiz', exerciseSkill: 'reading' })]))
    renderPage()
    const cta = await screen.findByTestId('assignment-cta-q1')
    expect(cta).toHaveTextContent(i18n.t('assignments.cta.start'))
    expect(cta).toHaveAttribute('href', '/assignments/q1/attempt')
  })

  test('in_progress → Continue CTA (same attempt route)', async () => {
    server.use(
      listHandler([item({ id: 'q2', exerciseSkill: 'listening', submissionStatus: 'in_progress' })]),
    )
    renderPage()
    const cta = await screen.findByTestId('assignment-cta-q2')
    expect(cta).toHaveTextContent(i18n.t('assignments.cta.continue'))
    expect(cta).toHaveAttribute('href', '/assignments/q2/attempt')
  })

  test.each<SubmissionStatus>(['submitted', 'ai_processing'])(
    '%s → Submitted status + read-only View CTA',
    async (status) => {
      server.use(
        listHandler([item({ id: 'q3', exerciseSkill: 'vocabulary', submissionStatus: status })]),
      )
      renderPage()
      const cta = await screen.findByTestId('assignment-cta-q3')
      expect(cta).toHaveTextContent(i18n.t('assignments.cta.view'))
      expect(cta).toHaveAttribute('href', '/assignments/q3/attempt')
      expect(screen.getByTestId('assignment-status-q3')).toHaveTextContent(
        i18n.t('assignments.status.submitted'),
      )
    },
  )

  test('graded → Graded badge, NO actionable CTA (result deferred to 5.5)', async () => {
    server.use(listHandler([item({ id: 'q4', exerciseSkill: 'reading', submissionStatus: 'graded' })]))
    renderPage()
    await screen.findByTestId('assignment-row-q4')
    expect(screen.getByTestId('assignment-status-q4')).toHaveTextContent(
      i18n.t('assignments.status.graded'),
    )
    expect(screen.queryByTestId('assignment-cta-q4')).not.toBeInTheDocument()
  })

  test('writing deep-links to the 5.3 writing attempt route (/write)', async () => {
    server.use(
      listHandler([item({ id: 'w1', exerciseSkill: 'writing', submissionStatus: null })]),
    )
    renderPage()
    const cta = await screen.findByTestId('assignment-cta-w1')
    expect(cta).toHaveTextContent(i18n.t('assignments.cta.start'))
    expect(cta).toHaveAttribute('href', '/assignments/w1/write')
  })

  test.each<ExerciseSkill>(['speaking'])(
    'skill %s whose attempt UI is not built yet → disabled "Available soon" (not a 404 link)',
    async (skill) => {
      server.use(listHandler([item({ id: 'q5', exerciseSkill: skill, submissionStatus: null })]))
      renderPage()
      const cta = await screen.findByTestId('assignment-cta-q5')
      expect(cta).toHaveTextContent(i18n.t('assignments.cta.availableSoon'))
      expect(cta).toBeDisabled()
      expect(cta).not.toHaveAttribute('href')
    },
  )
})

describe('AssignmentsListPage — overdue marker (AC5)', () => {
  test('past deadline + not-started → overdue marker', async () => {
    server.use(listHandler([item({ id: 'o1', deadlineAt: PAST, submissionStatus: null })]))
    renderPage()
    expect(await screen.findByTestId('assignment-overdue-o1')).toHaveTextContent(
      i18n.t('assignments.overdue.marker'),
    )
  })

  test('overdue with latePenalty > 0 communicates the penalty', async () => {
    server.use(
      listHandler([item({ id: 'o2', deadlineAt: PAST, submissionStatus: 'in_progress', latePenalty: 5 })]),
    )
    renderPage()
    expect(await screen.findByTestId('assignment-overdue-o2')).toHaveTextContent(
      i18n.t('assignments.overdue.penalty', { penalty: 5 }),
    )
  })

  test('submitted row past deadline → NO overdue marker', async () => {
    server.use(listHandler([item({ id: 'o3', deadlineAt: PAST, submissionStatus: 'submitted' })]))
    renderPage()
    await screen.findByTestId('assignment-row-o3')
    expect(screen.queryByTestId('assignment-overdue-o3')).not.toBeInTheDocument()
  })
})

describe('AssignmentsListPage — pagination (AC3)', () => {
  test('next page fetches the next slice; indicator updates', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      item({ id: `p-${i}`, exerciseTitle: `Assignment ${i}` }),
    )
    server.use(listHandler(many))
    renderPage()
    await screen.findByText('Assignment 0')
    expect(screen.getByText('Assignment 19')).toBeInTheDocument()
    expect(screen.queryByText('Assignment 20')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('assignments-next'))

    expect(await screen.findByText('Assignment 20')).toBeInTheDocument()
    expect(screen.getByTestId('assignments-page-indicator')).toHaveTextContent('2')
  })
})

describe('AssignmentsListPage — role gate (TEST-FE-6)', () => {
  test('student (allowed) sees the list behind the gate', async () => {
    server.use(listHandler([item({ exerciseTitle: 'Reading Quiz' })]))
    renderPageWithGate('student')
    expect(await screen.findByText('Reading Quiz')).toBeInTheDocument()
  })

  test.each<Role>(['teacher', 'owner'])(
    '%s is denied — the list is ABSENT from the DOM (not hidden)',
    async (role) => {
      server.use(listHandler([item({ exerciseTitle: 'Reading Quiz' })]))
      renderPageWithGate(role)
      await waitFor(() => {
        expect(screen.queryByTestId('assignments-page')).not.toBeInTheDocument()
        expect(screen.queryByText('Reading Quiz')).not.toBeInTheDocument()
      })
    },
  )
})

describe('AssignmentsListPage — i18n + a11y (TEST-FE-4/5, TEST-UX-1)', () => {
  test('assignments.* keys exist in both en and vi', () => {
    assertI18nParity([
      'assignments.sectionHeading',
      'assignments.footer.showing',
      'assignments.pagination.prev',
      'assignments.pagination.next',
      'assignments.pagination.page',
      'assignments.empty.headline',
      'assignments.empty.body',
      'assignments.error.body',
      'assignments.error.retry',
      'assignments.skill.reading',
      'assignments.skill.writing',
      'assignments.skill.speaking',
      'assignments.skill.general',
      'assignments.deadlineLabel',
      'assignments.status.notStarted',
      'assignments.status.inProgress',
      'assignments.status.submitted',
      'assignments.status.graded',
      'assignments.overdue.marker',
      'assignments.overdue.penalty',
      'assignments.cta.start',
      'assignments.cta.continue',
      'assignments.cta.view',
      'assignments.cta.availableSoon',
      'assignments.cta.startFor',
      'assignments.cta.continueFor',
      'assignments.cta.viewFor',
      'assignments.cta.availableSoonFor',
      'app.permissionDenied.section.assignments.header',
    ])
  })

  test('countLabel plural keys exist in both locales', () => {
    assertI18nParity(['assignments.countLabel_one', 'assignments.countLabel_other'])
  })

  test('deadline renders via the i18n formatter in BOTH locales', async () => {
    server.use(listHandler([item({ id: 'd1', deadlineAt: FUTURE })]))
    renderPage()
    const enDeadline = await screen.findByTestId('assignment-deadline-d1')
    expect(enDeadline).toHaveTextContent('2026')
    // The label prefix is localized (en "Due" ≠ vi "Hạn").
    expect(enDeadline).toHaveTextContent(/Due/)

    await i18n.changeLanguage('vi')
    await waitFor(() => {
      expect(screen.getByTestId('assignment-deadline-d1')).toHaveTextContent(/Hạn/)
    })
  })

  test('no accessibility violations on the loaded list', async () => {
    server.use(
      listHandler([
        item({ id: 'x1', exerciseTitle: 'Reading Quiz', submissionStatus: null }),
        item({ id: 'x2', exerciseTitle: 'Essay', exerciseSkill: 'writing' }),
        item({ id: 'x3', exerciseTitle: 'Graded One', submissionStatus: 'graded', deadlineAt: PAST }),
      ]),
    )
    const { container } = renderPage()
    await screen.findByText('Reading Quiz')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('no accessibility violations on the empty state', async () => {
    server.use(listHandler([]))
    const { container } = renderPage()
    await screen.findByTestId('assignments-empty')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('no accessibility violations while loading (skeleton state)', async () => {
    // Hang the request so the component stays in its pending/skeleton state
    // while axe audits it (AC7 — axe clean on the loading state).
    server.use(
      http.get('/api/assignments', async () => {
        await delay('infinite')
        return HttpResponse.json({ data: [] })
      }),
    )
    const { container } = renderPage()
    await screen.findByTestId('assignment-row-skeleton-0')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('no accessibility violations on the error state', async () => {
    server.use(
      http.get('/api/assignments', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r' } },
          { status: 500 },
        ),
      ),
    )
    const { container } = renderPage()
    await screen.findByRole('alert')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('CTA is keyboard-reachable and carries a title-specific accessible name', async () => {
    server.use(listHandler([item({ id: 'k1', exerciseTitle: 'Reading Quiz', submissionStatus: null })]))
    renderPage()
    const cta = await screen.findByRole('link', {
      name: i18n.t('assignments.cta.startFor', { title: 'Reading Quiz' }),
    })
    expect(cta).toBeInTheDocument()
    await userEvent.tab()
    await waitFor(() => expect(cta).toHaveFocus())
  })
})

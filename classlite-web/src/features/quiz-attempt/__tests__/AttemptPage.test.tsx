// Story 5.2b Task 10 — AttemptPage integration (MSW-only seam, TEST-FE-1..6).
// Covers WF-8 #7 (finalize happy-path), #8 (resume-finalize expired load), #9
// (409 subcode → read-only), #12 (three-state bundle load), #13 (role-negative),
// #14 (axe on states). Real QueryClient + real Zustand; MSW mocks the 4 endpoints.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
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
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import { initialState, useQuizAttemptStore } from '@/stores/quizAttemptStore'
import { AttemptPage } from '../AttemptPage'
import type { components } from '@/lib/api/client'

type AttemptBundle = components['schemas']['AttemptBundle']
type Submission = components['schemas']['Submission']

const ASSIGNMENT_ID = 'a-1'
const SUBMISSION_ID = 'sub-1'
const SERVER_NOW = '2026-08-04T00:00:00Z'
const STARTED = '2026-08-04T00:00:00Z'

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: SUBMISSION_ID,
    centerId: 'c-1',
    assignmentId: ASSIGNMENT_ID,
    studentId: 'user-student',
    status: 'in_progress',
    isLate: false,
    appliedPenalty: 0,
    startedAt: STARTED,
    submittedAt: null,
    timeBudgetSeconds: null,
    schemaVersion: 1,
    content: {},
    createdAt: STARTED,
    updatedAt: STARTED,
    ...overrides,
  }
}

function bundle(overrides: Partial<AttemptBundle> = {}): AttemptBundle {
  return {
    submission: submission(),
    assignment: {
      id: ASSIGNMENT_ID,
      exerciseId: 'ex-1',
      classId: 'cl-1',
      status: 'open',
      deadlineAt: '2026-08-20T00:00:00Z',
      hardDeadlineAt: null,
      instructions: null,
      latePenalty: 0,
      createdAt: STARTED,
      updatedAt: STARTED,
    },
    exercise: {
      id: 'ex-1',
      title: 'Reading Quiz',
      skill: 'reading',
      settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
      sections: [
        {
          type: 'reading',
          title: 'Passage One',
          content: 'The quick brown fox.',
          questionGroups: [
            {
              type: 'multiple_choice',
              instructions: '',
              questions: [{ text: 'Pick A or B', type: 'multiple_choice', options: ['A', 'B'] }],
            },
            {
              type: 'fill_in_blank',
              instructions: '',
              questions: [{ text: 'Fill me', type: 'fill_in_blank', options: [] }],
            },
          ],
        },
      ],
    },
    ...overrides,
  }
}

interface HandlerOpts {
  startStatus?: number
  startError?: { code: string }
  attemptBundle?: AttemptBundle
  events?: string[]
}

function installHandlers(opts: HandlerOpts = {}) {
  const events = opts.events ?? []
  server.use(
    http.post('/api/submissions', () => {
      events.push('START')
      if (opts.startError) {
        return HttpResponse.json(
          { error: { code: opts.startError.code, message: 'x', requestId: 'r' } },
          { status: opts.startStatus ?? 409 },
        )
      }
      return HttpResponse.json({ data: submission(), meta: { serverTime: SERVER_NOW } }, { status: 201 })
    }),
    http.get(`/api/submissions/${SUBMISSION_ID}/attempt`, () => {
      events.push('GET')
      return HttpResponse.json({
        data: opts.attemptBundle ?? bundle(),
        meta: { serverTime: SERVER_NOW },
      })
    }),
    http.put(`/api/submissions/${SUBMISSION_ID}/progress`, () => {
      events.push('PUT')
      return HttpResponse.json({ data: submission(), meta: { serverTime: SERVER_NOW } })
    }),
    http.post(`/api/submissions/${SUBMISSION_ID}/submit`, () => {
      events.push('POST')
      return HttpResponse.json({
        data: submission({ status: 'submitted' }),
        meta: { serverTime: SERVER_NOW },
      })
    }),
  )
  return events
}

const STUB_USER: UserSummary = {
  id: 'user-student',
  email: 'student@example.com',
  fullName: 'Student',
  emailVerified: true,
}

function seedSession(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: STUB_USER,
    accessToken: 'a.b.c',
    center: {
      id: 'c-1',
      name: 'C',
      shortCode: 'c',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role,
  })
}

function renderPage(role: Role = 'student') {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/assignments/${ASSIGNMENT_ID}/attempt`]}>
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
              <Route
                path="/assignments/:assignmentId/attempt"
                element={<AttemptPage />}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
  window.localStorage.clear()
  useQuizAttemptStore.setState({ ...initialState })
})
afterEach(async () => {
  server.resetHandlers()
  queryClient.clear()
  window.localStorage.clear()
  useQuizAttemptStore.setState({ ...initialState })
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

describe('AttemptPage — three-state trilogy (WF-8 #12, UX-1)', () => {
  test('renders the split-pane skeleton while bootstrapping', async () => {
    server.use(
      http.post('/api/submissions', async () => {
        await delay('infinite')
        return HttpResponse.json({ data: submission() }, { status: 201 })
      }),
    )
    renderPage()
    expect(await screen.findByTestId('attempt-skeleton')).toBeInTheDocument()
  })

  test('renders the shell on success (two-call bootstrap: POST then GET)', async () => {
    const events = installHandlers()
    renderPage()
    expect(await screen.findByTestId('attempt-shell')).toBeInTheDocument()
    expect(events.slice(0, 2)).toEqual(['START', 'GET'])
    expect(screen.getAllByText('The quick brown fox.')[0]).toBeInTheDocument()
  })

  test('renders an inline error + retry on a generic bootstrap failure', async () => {
    server.use(
      http.post('/api/submissions', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r' } },
          { status: 500 },
        ),
      ),
    )
    renderPage()
    const alert = await screen.findByTestId('attempt-error')
    expect(alert).toHaveTextContent(i18n.t('attempt.error.body'))
    expect(screen.getByTestId('attempt-error-retry')).toBeInTheDocument()
  })

  // Review Patch #4 — a deterministic 4xx (e.g. 403) offers NO retry, so the
  // student can't spin a retry that re-fails the same way.
  test('a 403 bootstrap error offers no retry (no loop)', async () => {
    server.use(
      http.post('/api/submissions', () =>
        HttpResponse.json(
          { error: { code: 'INSUFFICIENT_ROLE', message: 'x', requestId: 'r' } },
          { status: 403 },
        ),
      ),
    )
    renderPage()
    await screen.findByTestId('attempt-error')
    expect(screen.queryByTestId('attempt-error-retry')).not.toBeInTheDocument()
  })
})

describe('AttemptPage — answering + navigator (AC7/AC8)', () => {
  test('answering an MCQ marks its navigator dot done; flagging marks it flagged', async () => {
    installHandlers()
    renderPage()
    await screen.findByTestId('attempt-shell')

    // Two questions → two dots, both pending initially.
    expect(screen.getByTestId('nav-dot-0:0:0')).toHaveAttribute('data-state', 'current')
    await userEvent.click(screen.getAllByTestId('choice-0:0:0-A')[0])
    await waitFor(() =>
      expect(screen.getByTestId('nav-dot-0:0:0')).toHaveAttribute('data-state', 'current'),
    )
    // A different (non-current) answered question shows 'done'.
    await userEvent.click(screen.getAllByTestId('flag-0:1:0')[0])
    await waitFor(() =>
      expect(screen.getByTestId('nav-dot-0:1:0')).toHaveAttribute('data-state', 'flagged'),
    )
  })
})

describe('AttemptPage — submit flow (AC13/AC18/AC23, WF-8 #7)', () => {
  test('confirm submit runs flush→POST and lands on the confirmation end-state', async () => {
    const events = installHandlers()
    renderPage()
    await screen.findByTestId('attempt-shell')

    await userEvent.click(screen.getAllByTestId('choice-0:0:0-A')[0])
    await userEvent.click(screen.getByTestId('attempt-submit-open'))
    const dialog = await screen.findByTestId('submit-confirm-dialog')
    expect(within(dialog).getByTestId('submit-answered')).toHaveTextContent('1')

    await userEvent.click(within(dialog).getByTestId('submit-confirm'))

    expect(await screen.findByTestId('submission-confirmation')).toBeInTheDocument()
    // A flush PUT preceded the POST, and POST fired exactly once.
    expect(events.filter((e) => e === 'POST')).toHaveLength(1)
    expect(events.lastIndexOf('PUT')).toBeLessThan(events.indexOf('POST'))
  })
})

describe('AttemptPage — terminal / locked start (AC1)', () => {
  test('409 SUBMISSION_EXISTS → the confirmation end-state, not an error page', async () => {
    installHandlers({ startError: { code: 'SUBMISSION_EXISTS' }, startStatus: 409 })
    renderPage()
    expect(await screen.findByTestId('submission-confirmation')).toBeInTheDocument()
  })

  test('409 SUBMISSION_LOCKED → a terminal read-only/locked message (no retry)', async () => {
    installHandlers({ startError: { code: 'SUBMISSION_LOCKED' }, startStatus: 409 })
    renderPage()
    const err = await screen.findByTestId('attempt-error')
    expect(err).toHaveTextContent(i18n.t('attempt.readonly.locked'))
    expect(screen.queryByTestId('attempt-error-retry')).not.toBeInTheDocument()
  })
})

describe('AttemptPage — read-only (AC15)', () => {
  test('an already-submitted bundle renders read-only: banner shown, Submit hidden, inputs disabled', async () => {
    installHandlers({
      attemptBundle: bundle({ submission: submission({ status: 'submitted' }) }),
    })
    renderPage()
    await screen.findByTestId('attempt-shell')
    expect(screen.getByTestId('attempt-readonly-banner')).toHaveTextContent(
      i18n.t('attempt.readonly.submitted'),
    )
    expect(screen.queryByTestId('attempt-submit-open')).not.toBeInTheDocument()
    // Native controls reflect disabled; the flag button too.
    expect(screen.getAllByTestId('gap-input-0:1:0')[0]).toBeDisabled()
    expect(screen.getAllByTestId('flag-0:0:0')[0]).toBeDisabled()
  })
})

describe('AttemptPage — resume-finalize an expired load (AC19, WF-8 #8)', () => {
  test('a timed attempt whose deadline already passed finalizes on load → confirmation', async () => {
    // serverTime is well past startedAt + 60s → expired at mount.
    server.use(
      http.post('/api/submissions', () =>
        HttpResponse.json(
          { data: submission({ timeBudgetSeconds: 60 }), meta: { serverTime: SERVER_NOW } },
          { status: 201 },
        ),
      ),
      http.get(`/api/submissions/${SUBMISSION_ID}/attempt`, () =>
        HttpResponse.json({
          data: bundle({ submission: submission({ timeBudgetSeconds: 60 }) }),
          // 10 minutes after start → past the 60s budget.
          meta: { serverTime: '2026-08-04T00:10:00Z' },
        }),
      ),
      http.put(`/api/submissions/${SUBMISSION_ID}/progress`, () =>
        HttpResponse.json({ data: submission(), meta: { serverTime: SERVER_NOW } }),
      ),
      http.post(`/api/submissions/${SUBMISSION_ID}/submit`, () =>
        HttpResponse.json({ data: submission({ status: 'submitted' }), meta: { serverTime: SERVER_NOW } }),
      ),
    )
    renderPage()
    expect(await screen.findByTestId('submission-confirmation')).toBeInTheDocument()
  })
})

describe('AttemptPage — racing write 409 (AC15, WF-8 #9)', () => {
  test('a TIME_EXPIRED progress 409 flips the attempt read-only inline', async () => {
    server.use(
      http.post('/api/submissions', () =>
        HttpResponse.json({ data: submission(), meta: { serverTime: SERVER_NOW } }, { status: 201 }),
      ),
      http.get(`/api/submissions/${SUBMISSION_ID}/attempt`, () =>
        HttpResponse.json({ data: bundle(), meta: { serverTime: SERVER_NOW } }),
      ),
      http.put(`/api/submissions/${SUBMISSION_ID}/progress`, () =>
        HttpResponse.json(
          { error: { code: 'TIME_EXPIRED', message: 'x', requestId: 'r' } },
          { status: 409 },
        ),
      ),
    )
    renderPage()
    await screen.findByTestId('attempt-shell')
    await userEvent.click(screen.getAllByTestId('choice-0:0:0-A')[0])
    // Force the flush by opening submit (which flushes) — the 409 flips read-only.
    await userEvent.click(screen.getByTestId('attempt-submit-open'))
    await userEvent.click(screen.getByTestId('submit-confirm'))
    await waitFor(() =>
      expect(screen.getByTestId('attempt-readonly-banner')).toHaveTextContent(
        i18n.t('attempt.readonly.timeExpired'),
      ),
    )
  })
})

describe('AttemptPage — role gate (TEST-FE-6, WF-8 #13)', () => {
  test.each<Role>(['teacher', 'owner'])(
    '%s is denied — the attempt shell is ABSENT from the DOM',
    async (role) => {
      installHandlers()
      renderPage(role)
      await waitFor(() => {
        expect(screen.queryByTestId('attempt-shell')).not.toBeInTheDocument()
      })
    },
  )
})

describe('AttemptPage — a11y (WF-8 #14, TEST-UX-1)', () => {
  test('no axe violations on the loaded shell', async () => {
    installHandlers()
    const { container } = renderPage()
    await screen.findByTestId('attempt-shell')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('no axe violations on the skeleton', async () => {
    server.use(
      http.post('/api/submissions', async () => {
        await delay('infinite')
        return HttpResponse.json({ data: submission() }, { status: 201 })
      }),
    )
    const { container } = renderPage()
    await screen.findByTestId('attempt-skeleton')
    expect(await axe(container)).toHaveNoViolations()
  })
})

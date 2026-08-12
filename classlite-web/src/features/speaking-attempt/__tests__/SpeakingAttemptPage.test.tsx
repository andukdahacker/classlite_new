/**
 * Story 5.4 Task 10 (WF-8) — SpeakingAttemptPage integration (MSW-only seam).
 * Covers the three-state trilogy (UX-1/AC22), terminal/locked start (AC1),
 * role-negative (TEST-FE-6), and axe on states (AC24). The recorder-driven flows
 * live in SpeakingAttemptShell.test.tsx.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, delay, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import { useAttemptStore } from '@/stores/attemptStore'
import { SpeakingAttemptPage } from '../SpeakingAttemptPage'
import type { components } from '@/lib/api/client'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}))

type AttemptBundle = components['schemas']['AttemptBundle']
type Submission = components['schemas']['Submission']

const ASSIGNMENT_ID = 'a-1'
const SUBMISSION_ID = 'sub-sp1'
const SERVER_NOW = '2026-08-10T00:00:00Z'

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: SUBMISSION_ID,
    centerId: 'c-1',
    assignmentId: ASSIGNMENT_ID,
    studentId: 'user-student',
    status: 'in_progress',
    isLate: false,
    appliedPenalty: 0,
    startedAt: SERVER_NOW,
    submittedAt: null,
    timeBudgetSeconds: null,
    schemaVersion: 1,
    content: {},
    createdAt: SERVER_NOW,
    updatedAt: SERVER_NOW,
    ...overrides,
  }
}

function bundle(): AttemptBundle {
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
      createdAt: SERVER_NOW,
      updatedAt: SERVER_NOW,
    },
    exercise: {
      id: 'ex-1',
      title: 'IELTS Speaking Part 2',
      skill: 'speaking',
      settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
      sections: [
        { type: 'speaking', title: 'Cue card', content: 'Describe a journey.', questionGroups: [] },
      ],
    },
  }
}

function installHandlers(opts: { startError?: { code: string }; startStatus?: number } = {}) {
  server.use(
    http.post('/api/submissions', () => {
      if (opts.startError) {
        return HttpResponse.json(
          { error: { code: opts.startError.code, message: 'x', requestId: 'r' } },
          { status: opts.startStatus ?? 409 },
        )
      }
      return HttpResponse.json({ data: submission(), meta: { serverTime: SERVER_NOW } }, { status: 201 })
    }),
    http.get(`/api/submissions/${SUBMISSION_ID}/attempt`, () =>
      HttpResponse.json({ data: bundle(), meta: { serverTime: SERVER_NOW } }),
    ),
  )
}

const STUB_USER: UserSummary = {
  id: 'user-student',
  email: 'student@example.com',
  fullName: 'Student',
  emailVerified: true,
}

function renderPage(role: Role = 'student') {
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
  const client = createTestQueryClient()
  // DATA router (createMemoryRouter + RouterProvider) so the shell's `useBlocker`
  // works — the page renders the shell after bootstrap.
  const router = createMemoryRouter(
    [
      {
        element: (
          <RouteRoleGate
            allowedRoles={['student']}
            requiredRolesForCopy={['owner', 'admin']}
            sectionNameKey="assignments"
          />
        ),
        children: [
          { path: '/assignments/:assignmentId/speak', element: <SpeakingAttemptPage /> },
        ],
      },
    ],
    { initialEntries: [`/assignments/${ASSIGNMENT_ID}/speak`] },
  )
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
  window.localStorage.clear()
  useAttemptStore.getState().reset()
})
afterEach(async () => {
  server.resetHandlers()
  queryClient.clear()
  window.localStorage.clear()
  useAttemptStore.getState().reset()
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

describe('three-state trilogy (UX-1, AC22)', () => {
  test('speaking-shaped skeleton while bootstrapping', async () => {
    server.use(
      http.post('/api/submissions', async () => {
        await delay('infinite')
        return HttpResponse.json({ data: submission() }, { status: 201 })
      }),
    )
    renderPage()
    expect(await screen.findByTestId('speaking-skeleton')).toBeInTheDocument()
  })

  test('shell + cue card on success', async () => {
    installHandlers()
    renderPage()
    expect(await screen.findByTestId('speaking-attempt-shell')).toBeInTheDocument()
    expect(screen.getByTestId('speaking-cue-card')).toHaveTextContent('Describe a journey')
  })

  test('inline error + retry on a 5xx bootstrap failure', async () => {
    server.use(
      http.post('/api/submissions', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r' } },
          { status: 500 },
        ),
      ),
    )
    renderPage()
    expect(await screen.findByTestId('speaking-error')).toHaveTextContent(i18n.t('attempt.error.body'))
    expect(screen.getByTestId('speaking-error-retry')).toBeInTheDocument()
  })

  test('a 403 offers no retry (no loop)', async () => {
    server.use(
      http.post('/api/submissions', () =>
        HttpResponse.json(
          { error: { code: 'NOT_ENROLLED', message: 'x', requestId: 'r' } },
          { status: 403 },
        ),
      ),
    )
    renderPage()
    await screen.findByTestId('speaking-error')
    expect(screen.queryByTestId('speaking-error-retry')).not.toBeInTheDocument()
  })
})

describe('terminal / locked start (AC1)', () => {
  test('409 SUBMISSION_EXISTS → the confirmation end-state', async () => {
    installHandlers({ startError: { code: 'SUBMISSION_EXISTS' }, startStatus: 409 })
    renderPage()
    expect(await screen.findByTestId('submission-confirmation')).toBeInTheDocument()
  })

  test('409 SUBMISSION_LOCKED → terminal locked message, no retry', async () => {
    installHandlers({ startError: { code: 'SUBMISSION_LOCKED' }, startStatus: 409 })
    renderPage()
    expect(await screen.findByTestId('speaking-error')).toHaveTextContent(
      i18n.t('attempt.readonly.locked'),
    )
    expect(screen.queryByTestId('speaking-error-retry')).not.toBeInTheDocument()
  })
})

describe('role gate (TEST-FE-6)', () => {
  test.each<Role>(['teacher', 'owner'])(
    '%s is denied — the speaking shell is ABSENT from the DOM',
    async (role) => {
      installHandlers()
      renderPage(role)
      await waitFor(() => {
        expect(screen.queryByTestId('speaking-attempt-shell')).not.toBeInTheDocument()
        expect(screen.queryByTestId('speaking-recorder-leaf')).not.toBeInTheDocument()
      })
    },
  )
})

describe('a11y (TEST-UX-1)', () => {
  test('no axe violations on the loaded shell', async () => {
    installHandlers()
    const { container } = renderPage()
    await screen.findByTestId('speaking-attempt-shell')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('no axe violations on the error state', async () => {
    server.use(
      http.post('/api/submissions', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r' } },
          { status: 500 },
        ),
      ),
    )
    const { container } = renderPage()
    await screen.findByTestId('speaking-error')
    expect(await axe(container)).toHaveNoViolations()
  })
})

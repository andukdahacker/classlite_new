// Story 5.3 Task 8 (WF-8) — WritingAttemptPage integration (MSW-only seam).
// Covers: three-state trilogy (UX-1), terminal/locked start (AC1), role-negative
// (TEST-FE-6), seed-before-write ordering + local-newer recovery (BLOCKER, Murat
// F3), reload-recovers-mirror, and axe on states.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, delay, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
import { useAttemptStore } from '@/stores/attemptStore'
import { WritingAttemptPage } from '../WritingAttemptPage'
import type { components } from '@/lib/api/client'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}))
import { toast } from 'sonner'

type AttemptBundle = components['schemas']['AttemptBundle']
type Submission = components['schemas']['Submission']
type SubmissionContent = components['schemas']['SubmissionContent']

const ASSIGNMENT_ID = 'a-1'
const SUBMISSION_ID = 'sub-w1'
const SERVER_NOW = '2026-08-04T00:00:00Z'
const MIRROR_KEY = `classlite:attempt-draft:${SUBMISSION_ID}`

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

function bundle(content: SubmissionContent = {}): AttemptBundle {
  return {
    submission: submission({ content }),
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
      title: 'IELTS Writing Task 2',
      skill: 'writing',
      settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
      sections: [
        {
          type: 'writing',
          title: 'Task',
          content: 'Discuss both views and give your opinion.',
          questionGroups: [],
        },
      ],
    },
  }
}

interface HandlerOpts {
  startStatus?: number
  startError?: { code: string }
  attemptBundle?: AttemptBundle
}

function installHandlers(opts: HandlerOpts = {}) {
  server.use(
    http.post('/api/submissions', () => {
      if (opts.startError) {
        return HttpResponse.json(
          { error: { code: opts.startError.code, message: 'x', requestId: 'r' } },
          { status: opts.startStatus ?? 409 },
        )
      }
      return HttpResponse.json(
        { data: submission(), meta: { serverTime: SERVER_NOW } },
        { status: 201 },
      )
    }),
    http.get(`/api/submissions/${SUBMISSION_ID}/attempt`, () =>
      HttpResponse.json({
        data: opts.attemptBundle ?? bundle(),
        meta: { serverTime: SERVER_NOW },
      }),
    ),
    http.put(`/api/submissions/${SUBMISSION_ID}/progress`, () =>
      HttpResponse.json({ data: submission(), meta: { serverTime: SERVER_NOW } }),
    ),
    http.post(`/api/submissions/${SUBMISSION_ID}/submit`, () =>
      HttpResponse.json({
        data: submission({ status: 'submitted' }),
        meta: { serverTime: SERVER_NOW },
      }),
    ),
  )
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
        <MemoryRouter initialEntries={[`/assignments/${ASSIGNMENT_ID}/write`]}>
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
                path="/assignments/:assignmentId/write"
                element={<WritingAttemptPage />}
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
  useAttemptStore.getState().reset()
  vi.mocked(toast.info).mockClear()
})
afterEach(async () => {
  server.resetHandlers()
  queryClient.clear()
  window.localStorage.clear()
  useAttemptStore.getState().reset()
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

describe('WritingAttemptPage — three-state trilogy (UX-1)', () => {
  test('renders the writing-shaped skeleton while bootstrapping', async () => {
    server.use(
      http.post('/api/submissions', async () => {
        await delay('infinite')
        return HttpResponse.json({ data: submission() }, { status: 201 })
      }),
    )
    renderPage()
    expect(await screen.findByTestId('writing-skeleton')).toBeInTheDocument()
  })

  test('renders the shell + prompt + editor on success', async () => {
    installHandlers()
    renderPage()
    expect(await screen.findByTestId('writing-attempt-shell')).toBeInTheDocument()
    expect(screen.getByTestId('writing-prompt')).toHaveTextContent(
      'Discuss both views',
    )
    expect(screen.getByTestId('writing-editor-leaf')).toBeInTheDocument()
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
    const alert = await screen.findByTestId('writing-error')
    expect(alert).toHaveTextContent(i18n.t('attempt.error.body'))
    expect(screen.getByTestId('writing-error-retry')).toBeInTheDocument()
  })

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
    await screen.findByTestId('writing-error')
    expect(screen.queryByTestId('writing-error-retry')).not.toBeInTheDocument()
  })
})

describe('WritingAttemptPage — terminal / locked start (AC1)', () => {
  test('409 SUBMISSION_EXISTS → the confirmation end-state, not an error page', async () => {
    installHandlers({ startError: { code: 'SUBMISSION_EXISTS' }, startStatus: 409 })
    renderPage()
    expect(await screen.findByTestId('submission-confirmation')).toBeInTheDocument()
  })

  test('409 SUBMISSION_LOCKED → a terminal locked message (no retry)', async () => {
    installHandlers({ startError: { code: 'SUBMISSION_LOCKED' }, startStatus: 409 })
    renderPage()
    const err = await screen.findByTestId('writing-error')
    expect(err).toHaveTextContent(i18n.t('attempt.readonly.locked'))
    expect(screen.queryByTestId('writing-error-retry')).not.toBeInTheDocument()
  })
})

describe('WritingAttemptPage — draft recovery + seed-before-write (BLOCKER, Murat F3)', () => {
  test('a pre-write mirror newer than the server is RECOVERED into the editor, mirror never clobbered', async () => {
    // Crash left a newer local draft; the server only has the older autosave.
    window.localStorage.setItem(
      MIRROR_KEY,
      JSON.stringify({ schemaVersion: 1, text: 'unsaved-before-crash' }),
    )
    installHandlers({ attemptBundle: bundle({ schemaVersion: 1, text: 'server-older' }) })
    renderPage()

    const editor = await screen.findByTestId('writing-editor-leaf')
    // Local-newer-wins (D4): the recovered text seeds the uncontrolled leaf.
    expect(editor).toHaveValue('unsaved-before-crash')
    // The mirror was never clobbered to empty before reconcile ran.
    expect(JSON.parse(window.localStorage.getItem(MIRROR_KEY)!).text).toBe(
      'unsaved-before-crash',
    )
    // Reconcile fired once → exactly one recovered toast.
    expect(vi.mocked(toast.info)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
      i18n.t('writing.draft.recoveredToast'),
    )
  })

  test('reload recovers the mirror when the server draft is empty', async () => {
    window.localStorage.setItem(
      MIRROR_KEY,
      JSON.stringify({ schemaVersion: 1, text: 'recovered on reload' }),
    )
    installHandlers({ attemptBundle: bundle({}) }) // server content empty
    renderPage()
    const editor = await screen.findByTestId('writing-editor-leaf')
    expect(editor).toHaveValue('recovered on reload')
  })
})

describe('WritingAttemptPage — role gate (TEST-FE-6)', () => {
  test.each<Role>(['teacher', 'owner'])(
    '%s is denied — the writing shell is ABSENT from the DOM',
    async (role) => {
      installHandlers()
      renderPage(role)
      await waitFor(() => {
        expect(screen.queryByTestId('writing-attempt-shell')).not.toBeInTheDocument()
        expect(screen.queryByTestId('writing-editor-leaf')).not.toBeInTheDocument()
      })
    },
  )
})

describe('WritingAttemptPage — a11y (TEST-UX-1)', () => {
  test('no axe violations on the loaded shell', async () => {
    installHandlers()
    const { container } = renderPage()
    await screen.findByTestId('writing-attempt-shell')
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
    await screen.findByTestId('writing-skeleton')
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
    await screen.findByTestId('writing-error')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('WritingAttemptPage — localStorage mirror unavailable (AC11)', () => {
  test('a failing mirror write surfaces the one-time unavailable warning', async () => {
    installHandlers()
    vi.mocked(toast.warning).mockClear()
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded')
      })
    renderPage()
    await screen.findByTestId('writing-attempt-shell')
    await waitFor(() =>
      expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
        i18n.t('attempt.draft.localUnavailable'),
      ),
    )
    setItemSpy.mockRestore()
  })
})

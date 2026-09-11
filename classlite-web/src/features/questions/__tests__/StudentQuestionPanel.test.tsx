/**
 * StudentQuestionPanel tests (Story 7.4b, AC1–AC4/AC16). The rail is an overlay
 * mirrored to `?questions=open` (AC1); the ask submits only assignmentId +
 * anchor + content — NEVER classId/studentId (SEC-7, AC3); three-state trilogy
 * (TEST-FE-2); axe (TEST-FE-5). Real QueryClient + MSW (TEST-FE-1).
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { components } from '@/lib/api/client'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { StudentQuestionPanel } from '../components/StudentQuestionPanel'
import {
  askHandlers,
  askTargetNotFound404,
  listEmptyHandlers,
  listErrorHandlers,
  listHandlers,
  question,
  QA_EXERCISE_ID,
} from '../api/__tests__/questionHandlers'

type AskQuestionRequest = components['schemas']['AskQuestionRequest']

const CENTER_ID = '00000000-0000-0000-0000-0000000000c1'
const ASSIGNMENT_ID = '00000000-0000-0000-0000-0000000000aa'

function seedSession(): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: 'stu1', email: 'stu1@example.com', fullName: 'Asker Student', emailVerified: true },
    accessToken: 'a.b.c',
    center: {
      id: CENTER_ID,
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role: 'student',
  })
}

function renderPanel(entry: string, currentHandle: string | null = null): void {
  seedSession()
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route
              path="/attempt"
              element={
                <StudentQuestionPanel
                  assignmentId={ASSIGNMENT_ID}
                  exerciseId={QA_EXERCISE_ID}
                  currentHandle={currentHandle}
                />
              }
            />
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
  server.resetHandlers()
})

describe('StudentQuestionPanel — overlay open/close (AC1)', () => {
  test('is closed (absent) without the ?questions=open param', () => {
    renderPanel('/attempt')
    expect(screen.queryByTestId('student-question-panel')).not.toBeInTheDocument()
  })

  test('opens when ?questions=open is present', async () => {
    server.use(...listEmptyHandlers)
    renderPanel('/attempt?questions=open')
    await screen.findByTestId('student-question-panel')
    expect(screen.getByTestId('student-question-composer')).toBeInTheDocument()
  })
})

describe('StudentQuestionPanel — three-state trilogy (AC4)', () => {
  test('renders the loading skeleton', () => {
    server.use(...listHandlers([question()]))
    renderPanel('/attempt?questions=open')
    expect(screen.getByTestId('student-question-list-skeleton')).toBeInTheDocument()
  })

  test('renders the empty state', async () => {
    server.use(...listEmptyHandlers)
    renderPanel('/attempt?questions=open')
    await screen.findByTestId('student-question-list-empty')
  })

  test('renders own threads on success', async () => {
    server.use(...listHandlers([question({ id: 'q1', content: 'Why B not C?' })]))
    renderPanel('/attempt?questions=open')
    await screen.findByTestId('anchored-question-card-q1')
    expect(screen.getByTestId('anchored-question-card-q1-question-text')).toHaveTextContent(
      'Why B not C?',
    )
  })

  test('renders the error state on network failure', async () => {
    server.use(...listErrorHandlers)
    renderPanel('/attempt?questions=open')
    await screen.findByTestId('student-question-list-error')
  })
})

describe('StudentQuestionPanel — ask (AC3, SEC-7)', () => {
  test('whole-exercise ask posts only assignmentId + anchor + content (no classId/studentId)', async () => {
    const bodies: AskQuestionRequest[] = []
    server.use(...listEmptyHandlers, ...askHandlers((body) => bodies.push(body)))
    renderPanel('/attempt?questions=open')
    await screen.findByTestId('student-question-composer')

    await userEvent.click(screen.getByTestId('student-question-scope-exercise'))
    await userEvent.type(screen.getByTestId('student-question-content'), 'Is this whole task graded?')
    await userEvent.click(screen.getByTestId('student-question-submit'))

    await waitFor(() => expect(bodies).toHaveLength(1))
    const body = bodies[0]
    expect(body).toMatchObject({
      assignmentId: ASSIGNMENT_ID,
      anchorType: 'exercise',
      anchorRef: null,
      content: 'Is this whole task graded?',
    })
    expect(body).not.toHaveProperty('classId')
    expect(body).not.toHaveProperty('studentId')
  })

  test('a 404 target surfaces the UX-1 error, never a raw code', async () => {
    server.use(...listEmptyHandlers, ...askTargetNotFound404)
    renderPanel('/attempt?questions=open')
    await screen.findByTestId('student-question-composer')

    await userEvent.click(screen.getByTestId('student-question-scope-exercise'))
    await userEvent.type(screen.getByTestId('student-question-content'), 'Question that fails')
    await userEvent.click(screen.getByTestId('student-question-submit'))

    const error = await screen.findByTestId('student-question-ask-error')
    expect(error).toHaveTextContent(i18n.t('questions.composer.error.targetNotFound'))
  })
})

describe('StudentQuestionPanel — a11y (AC16)', () => {
  test('has no axe violations when open', async () => {
    seedSession()
    server.use(...listEmptyHandlers)
    const client = createTestQueryClient()
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/attempt?questions=open']}>
            <Routes>
              <Route
                path="/attempt"
                element={
                  <StudentQuestionPanel
                    assignmentId={ASSIGNMENT_ID}
                    exerciseId={QA_EXERCISE_ID}
                    currentHandle={null}
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    await screen.findByTestId('student-question-composer')
    expect(await axe(container)).toHaveNoViolations()
  })
})

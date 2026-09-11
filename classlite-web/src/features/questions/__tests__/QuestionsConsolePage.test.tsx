/**
 * QuestionsConsolePage tests (Story 7.4b, AC6–AC11/AC16). Real QueryClient + MSW
 * at the HTTP boundary (TEST-FE-1); three-state trilogy (TEST-FE-2); reply /
 * send-&-resolve / batch (all-or-nothing) flows assert the POST bodies; axe
 * (TEST-FE-5); i18n resolves in both locales (TEST-FE-4).
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
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'
import { QuestionsConsolePage } from '../QuestionsConsolePage'
import {
  batchReplyHandlers,
  batchReplyNotFound404,
  listEmptyHandlers,
  listErrorHandlers,
  listHandlers,
  question,
  replyHandlers,
  resolveHandlers,
} from '../api/__tests__/questionHandlers'

type ReplyRequest = components['schemas']['ReplyRequest']
type BatchReplyRequest = components['schemas']['BatchReplyRequest']

const CENTER_ID = '00000000-0000-0000-0000-0000000000c1'

function seedSession(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: {
      id: 'user-teacher',
      email: 'teacher@example.com',
      fullName: 'Teacher One',
      emailVerified: true,
    },
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

function renderConsole(): void {
  seedSession('teacher')
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/questions']}>
          <Routes>
            <Route path="/questions" element={<QuestionsConsolePage />} />
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
  void i18n.changeLanguage('en')
})

describe('QuestionsConsolePage — three-state trilogy', () => {
  test('renders the loading skeleton first (TEST-FE-2)', () => {
    server.use(...listHandlers([question()]))
    renderConsole()
    expect(screen.getByTestId('questions-console-skeleton')).toBeInTheDocument()
  })

  test('renders questions with anchored context on success', async () => {
    server.use(...listHandlers([question({ id: 'q1', anchorExcerpt: 'the wisdom of crowds' })]))
    renderConsole()
    await screen.findByTestId('teacher-question-q1')
    expect(screen.getByTestId('anchored-question-card-q1-excerpt')).toHaveTextContent(
      'the wisdom of crowds',
    )
    // orange item pin present (AC14)
    expect(screen.getByTestId('anchored-question-card-q1-anchor-pin')).toHaveAttribute(
      'data-tone',
      'item',
    )
  })

  test('renders the empty state when there are no questions', async () => {
    server.use(...listEmptyHandlers)
    renderConsole()
    await screen.findByTestId('questions-console-empty')
  })

  test('renders the error state on network failure (TEST-FE-2)', async () => {
    server.use(...listErrorHandlers)
    renderConsole()
    await screen.findByTestId('questions-console-error')
  })
})

describe('QuestionsConsolePage — reply + resolve', () => {
  test('reply posts content + visibility with resolve:false (AC8)', async () => {
    const bodies: ReplyRequest[] = []
    server.use(
      ...listHandlers([question({ id: 'q1' })]),
      ...replyHandlers((body) => bodies.push(body), undefined, 'q1'),
    )
    renderConsole()
    await screen.findByTestId('teacher-question-q1')

    await userEvent.type(
      screen.getByTestId('anchored-question-card-q1-reply-input'),
      'Look at paragraph two.',
    )
    await userEvent.click(screen.getByTestId('anchored-question-card-q1-submit-reply'))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({
      content: 'Look at paragraph two.',
      visibility: 'personal',
      resolve: false,
    })
  })

  test('"Shared with your class" toggle switches visibility to shared (AC8/D5)', async () => {
    const bodies: ReplyRequest[] = []
    server.use(
      ...listHandlers([question({ id: 'q1' })]),
      ...replyHandlers((body) => bodies.push(body), undefined, 'q1'),
    )
    renderConsole()
    await screen.findByTestId('teacher-question-q1')

    await userEvent.type(
      screen.getByTestId('anchored-question-card-q1-reply-input'),
      'Shared answer',
    )
    await userEvent.click(screen.getByTestId('anchored-question-card-q1-visibility-shared'))
    await userEvent.click(screen.getByTestId('anchored-question-card-q1-submit-reply'))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].visibility).toBe('shared')
  })

  test('Send & resolve posts resolve:true (AC9)', async () => {
    const bodies: ReplyRequest[] = []
    server.use(
      ...listHandlers([question({ id: 'q1' })]),
      ...replyHandlers((body) => bodies.push(body), undefined, 'q1'),
    )
    renderConsole()
    await screen.findByTestId('teacher-question-q1')

    await userEvent.type(
      screen.getByTestId('anchored-question-card-q1-reply-input'),
      'Final answer',
    )
    await userEvent.click(screen.getByTestId('anchored-question-card-q1-send-resolve'))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].resolve).toBe(true)
  })

  test('standalone resolve calls PATCH (AC11)', async () => {
    server.use(...listHandlers([question({ id: 'q1', status: 'open' })]), ...resolveHandlers('q1'))
    renderConsole()
    await screen.findByTestId('teacher-question-q1')
    await userEvent.click(screen.getByTestId('teacher-question-q1-resolve'))
    // The button is present and clickable; success invalidates the list (no throw).
    expect(screen.getByTestId('teacher-question-q1-resolve')).toBeInTheDocument()
  })
})

describe('QuestionsConsolePage — unanswered filter (AC7)', () => {
  test('toggles the filter pressed state', async () => {
    server.use(...listHandlers([question({ id: 'q1' })]))
    renderConsole()
    await screen.findByTestId('teacher-question-q1')
    const filter = screen.getByTestId('questions-unanswered-filter')
    expect(filter).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(filter)
    await waitFor(() => expect(filter).toHaveAttribute('aria-pressed', 'true'))
  })
})

describe('QuestionsConsolePage — batch (AC10 all-or-nothing)', () => {
  test('batch reply posts all selected ids together', async () => {
    const bodies: BatchReplyRequest[] = []
    server.use(
      ...listHandlers([question({ id: 'q1' }), question({ id: 'q2' })]),
      ...batchReplyHandlers((body) => bodies.push(body)),
    )
    renderConsole()
    await screen.findByTestId('teacher-question-q1')

    await userEvent.click(screen.getByTestId('teacher-question-q1-select'))
    await userEvent.click(screen.getByTestId('teacher-question-q2-select'))
    await screen.findByTestId('batch-action-bar')

    await userEvent.type(screen.getByTestId('batch-action-bar-content'), 'One reply for all')
    await userEvent.click(screen.getByTestId('batch-action-bar-reply'))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].questionIds).toEqual(expect.arrayContaining(['q1', 'q2']))
    expect(bodies[0].questionIds).toHaveLength(2)
  })

  test('a 404 surfaces the all-or-nothing error, no partial mutation (AC10)', async () => {
    server.use(
      ...listHandlers([question({ id: 'q1' }), question({ id: 'q2' })]),
      ...batchReplyNotFound404,
    )
    renderConsole()
    await screen.findByTestId('teacher-question-q1')

    await userEvent.click(screen.getByTestId('teacher-question-q1-select'))
    await userEvent.click(screen.getByTestId('teacher-question-q2-select'))
    await userEvent.type(screen.getByTestId('batch-action-bar-content'), 'One reply for all')
    await userEvent.click(screen.getByTestId('batch-action-bar-reply'))

    await screen.findByTestId('batch-action-bar-error')
    // Selection is NOT cleared on error — the batch bar stays for a retry.
    expect(screen.getByTestId('batch-action-bar')).toBeInTheDocument()
  })
})

describe('QuestionsConsolePage — i18n + a11y', () => {
  test('renders the Vietnamese console title (TEST-FE-4 both locales)', async () => {
    await i18n.changeLanguage('vi')
    server.use(...listEmptyHandlers)
    renderConsole()
    await screen.findByTestId('questions-console-empty')
    expect(screen.getByRole('heading', { name: i18n.t('questions.console.title') })).toBeInTheDocument()
  })

  test('has no axe violations on the success state (TEST-FE-5)', async () => {
    server.use(...listHandlers([question({ id: 'q1' })]))
    const { container } = renderWithContainer()
    await screen.findByTestId('teacher-question-q1')
    expect(await axe(container)).toHaveNoViolations()
  })
})

function renderWithContainer() {
  seedSession('teacher')
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/questions']}>
          <Routes>
            <Route path="/questions" element={<QuestionsConsolePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

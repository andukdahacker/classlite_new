// Story 5.2b Task 10 (TEST-UX-2/4, WF-8 #15/#16) — keyboard flow tested as a
// FLOW: a navigator jump + Prev/Next move focus to the target question's first
// input; touch targets meet ≥44×44. MSW-only seam.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import { initialState, useQuizAttemptStore } from '@/stores/quizAttemptStore'
import { AttemptPage } from '../AttemptPage'
import type { components } from '@/lib/api/client'

type AttemptBundle = components['schemas']['AttemptBundle']
const AID = 'a-1'
const SID = 'sub-1'
const NOW = '2026-08-04T00:00:00Z'

function sub() {
  return {
    id: SID,
    centerId: 'c',
    assignmentId: AID,
    studentId: 'u',
    status: 'in_progress',
    isLate: false,
    appliedPenalty: 0,
    startedAt: NOW,
    submittedAt: null,
    timeBudgetSeconds: null,
    schemaVersion: 1,
    content: {},
    createdAt: NOW,
    updatedAt: NOW,
  }
}
function threeQuestionBundle(): AttemptBundle {
  return {
    submission: sub() as unknown as AttemptBundle['submission'],
    assignment: {
      id: AID,
      exerciseId: 'ex',
      classId: 'cl',
      status: 'open',
      deadlineAt: '2026-08-20T00:00:00Z',
      hardDeadlineAt: null,
      instructions: null,
      latePenalty: 0,
      createdAt: NOW,
      updatedAt: NOW,
    },
    exercise: {
      id: 'ex',
      title: 'Q',
      skill: 'reading',
      settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
      sections: [
        {
          type: 'reading',
          title: 'P',
          content: 'passage',
          questionGroups: [
            {
              type: 'fill_in_blank',
              instructions: '',
              questions: [
                { text: 'One', type: 'fill_in_blank', options: [] },
                { text: 'Two', type: 'fill_in_blank', options: [] },
              ],
            },
          ],
        },
      ],
    },
  }
}

function install() {
  server.use(
    http.post('/api/submissions', () =>
      HttpResponse.json({ data: sub(), meta: { serverTime: NOW } }, { status: 201 }),
    ),
    http.get(`/api/submissions/${SID}/attempt`, () =>
      HttpResponse.json({ data: threeQuestionBundle(), meta: { serverTime: NOW } }),
    ),
    http.put(`/api/submissions/${SID}/progress`, () =>
      HttpResponse.json({ data: sub(), meta: { serverTime: NOW } }),
    ),
  )
}

function seed() {
  const user: UserSummary = { id: 'u', email: 's@e.com', fullName: 'S', emailVerified: true }
  queryClient.setQueryData<Session>(authKeys.session(), {
    user,
    accessToken: 'a.b.c',
    center: { id: 'c', name: 'C', shortCode: 'c', brandColor: null, logoUrl: null, timezone: 'Asia/Ho_Chi_Minh' },
    role: 'student',
  })
}

function renderPage() {
  seed()
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/assignments/${AID}/attempt`]}>
          <Routes>
            <Route path="/assignments/:assignmentId/attempt" element={<AttemptPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
  useQuizAttemptStore.setState({ ...initialState })
})
afterEach(() => {
  server.resetHandlers()
  queryClient.clear()
  useQuizAttemptStore.setState({ ...initialState })
})

describe('keyboard flow (WF-8 #15)', () => {
  test('clicking a navigator dot moves focus to that question’s first input', async () => {
    install()
    renderPage()
    await screen.findByTestId('attempt-shell')
    // Jump to question 2 via the (desktop) rail dot.
    await userEvent.click(screen.getAllByTestId('nav-dot-0:0:1')[0])
    await waitFor(() =>
      expect(screen.getAllByTestId('gap-input-0:0:1')[0]).toHaveFocus(),
    )
  })

  test('Next moves focus to the next question’s input', async () => {
    install()
    renderPage()
    await screen.findByTestId('attempt-shell')
    await userEvent.click(screen.getAllByTestId('attempt-next')[0])
    await waitFor(() =>
      expect(screen.getAllByTestId('gap-input-0:0:1')[0]).toHaveFocus(),
    )
  })

  // Review Patch #1 — only ONE tree mounts per breakpoint, so ids are unique.
  test('mounts a single tree (no duplicate question ids)', async () => {
    install()
    renderPage()
    await screen.findByTestId('attempt-shell')
    // matchMedia mock → min-width matches → the desktop tree only.
    expect(screen.queryByTestId('attempt-mobile')).toBeNull()
    expect(screen.getAllByTestId('attempt-questions-pane')).toHaveLength(1)
    expect(screen.getAllByTestId('gap-input-0:0:0')).toHaveLength(1)
  })
})

describe('mobile tree (Review Patch #1)', () => {
  test('mobile mounts one tree and Prev/Next moves focus to the target input', async () => {
    const originalMatchMedia = globalThis.matchMedia
    // Force the MOBILE breakpoint — no min-width match.
    globalThis.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof globalThis.matchMedia
    try {
      install()
      renderPage()
      await screen.findByTestId('attempt-shell')
      // The mobile tree is the only one in the DOM — no duplicate ids.
      expect(screen.getByTestId('attempt-mobile')).toBeTruthy()
      expect(screen.queryByTestId('attempt-desktop')).toBeNull()
      expect(screen.getAllByTestId('gap-input-0:0:0')).toHaveLength(1)
      // Prev/Next focus-move now targets the visible (mobile) input, not a
      // display:none desktop copy.
      await userEvent.click(screen.getByTestId('attempt-next'))
      await waitFor(() =>
        expect(screen.getByTestId('gap-input-0:0:1')).toHaveFocus(),
      )
    } finally {
      globalThis.matchMedia = originalMatchMedia
    }
  })
})

describe('touch targets (WF-8 #16, TEST-UX-4)', () => {
  test('flag buttons and navigator dots use the 44px (size-11) target', async () => {
    install()
    renderPage()
    await screen.findByTestId('attempt-shell')
    // size-11 = 2.75rem = 44px. jsdom can't compute layout, so assert the class.
    expect(screen.getAllByTestId('flag-0:0:0')[0].className).toMatch(/size-11/)
    expect(screen.getAllByTestId('nav-dot-0:0:0')[0].className).toMatch(/size-11/)
    // Review Patch #3 — Prev/Next also meet the 44px floor (min-h-11).
    expect(screen.getAllByTestId('attempt-prev')[0].className).toMatch(/min-h-11/)
    expect(screen.getAllByTestId('attempt-next')[0].className).toMatch(/min-h-11/)
  })
})

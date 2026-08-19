// Story 6.1 (Task 11) — WritingGradingPage integration, MSW-only seam. Covers the
// L/E/E trilogy, the server-mirrored live overall band, the grade POST body OMITTING
// overallBand (AC7), and the desktop-only mobile seam + copy-link (AC17).
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, delay, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import type { components } from '@/lib/api/client'
import { WritingGradingPage } from '@/features/grading'
import { readGradingDraft } from '@/features/grading/lib/gradingDraft'

type TeacherGradingView = components['schemas']['TeacherGradingView']
type Grade = components['schemas']['Grade']

const CLASS_ID = 'cl-1'
const ASSIGNMENT_ID = 'a-1'
const SUBMISSION_ID = 'sub-5'
const GRADING_PATH = `/api/submissions/${SUBMISSION_ID}/grading`
const GRADE_PATH = `/api/submissions/${SUBMISSION_ID}/grade`
const QUEUE_PATH = `/api/classes/${CLASS_ID}/grading-queue`

function gradingView(overrides: Partial<TeacherGradingView> = {}): TeacherGradingView {
  return {
    submission: {
      id: SUBMISSION_ID,
      centerId: 'c-1',
      assignmentId: ASSIGNMENT_ID,
      studentId: 'stu-1',
      status: 'submitted',
      isLate: false,
      appliedPenalty: 0,
      startedAt: '2026-08-13T00:00:00Z',
      submittedAt: '2026-08-13T12:00:00Z',
      timeBudgetSeconds: null,
      schemaVersion: 1,
      content: { schemaVersion: 1, text: 'The quick brown fox.' },
      createdAt: '2026-08-13T00:00:00Z',
      updatedAt: '2026-08-13T12:00:00Z',
    },
    assignment: {
      id: ASSIGNMENT_ID,
      exerciseId: 'ex-1',
      classId: CLASS_ID,
      status: 'open',
      deadlineAt: '2026-08-20T00:00:00Z',
      hardDeadlineAt: null,
      instructions: null,
      latePenalty: 0,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    },
    student: { id: 'stu-1', fullName: 'Alice Nguyen' },
    exercise: { id: 'ex-1', title: 'Writing Task 1', skill: 'writing', sections: [], settings: {} as never },
    grade: null,
    ...overrides,
  }
}

const gradeResponse: Grade = {
  id: 'g-1',
  submissionId: SUBMISSION_ID,
  version: 1,
  criterionScores: { taskResponse: 6.5, coherenceCohesion: 6.5, lexicalResource: 6.5, grammaticalRange: 6.5 },
  overallBand: 6.5,
  comments: [],
  feedback: null,
  gradedBy: 'teacher-1',
  releasedAt: '2026-08-19T00:00:00Z',
  createdAt: '2026-08-19T00:00:00Z',
}

const STUB_USER: UserSummary = {
  id: 'teacher-1',
  email: 'teacher@example.com',
  fullName: 'Teacher',
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

function renderPage(role: Role = 'teacher') {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/classes/${CLASS_ID}/grading/${ASSIGNMENT_ID}/${SUBMISSION_ID}`]}>
          <Routes>
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['owner', 'admin', 'teacher']}
                  requiredRolesForCopy={['owner', 'admin']}
                  sectionNameKey="grading"
                />
              }
            >
              <Route path="/classes/:id/grading/:aid/:sid" element={<WritingGradingPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

function stubQueue() {
  server.use(http.get(QUEUE_PATH, () => HttpResponse.json({ data: [], meta: { serverTime: '2026-08-19T00:00:00Z' } })))
}

beforeEach(() => {
  queryClient.clear()
})
afterEach(async () => {
  server.resetHandlers()
  queryClient.clear()
  window.localStorage.clear()
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

describe('WritingGradingPage — trilogy', () => {
  test('renders the loading skeleton', async () => {
    stubQueue()
    server.use(
      http.get(GRADING_PATH, async () => {
        await delay(50)
        return HttpResponse.json({ data: gradingView(), meta: { serverTime: '2026-08-19T00:00:00Z' } })
      }),
    )
    renderPage()
    expect(await screen.findByTestId('grading-skeleton')).toBeInTheDocument()
  })

  test('renders the grading workspace on success', async () => {
    stubQueue()
    server.use(
      http.get(GRADING_PATH, () =>
        HttpResponse.json({ data: gradingView(), meta: { serverTime: '2026-08-19T00:00:00Z' } }),
      ),
    )
    renderPage()
    expect(await screen.findByText('Alice Nguyen')).toBeInTheDocument()
    // the essay text is painted into the surface
    expect(screen.getByTestId('writing-grading-surface-essay').textContent).toContain('quick brown fox')
    expect(screen.getByTestId('grading-band-inputs')).toBeInTheDocument()
  })

  test('renders the error alert on failure', async () => {
    stubQueue()
    server.use(http.get(GRADING_PATH, () => HttpResponse.json({ error: { code: 'X' } }, { status: 500 })))
    renderPage()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('WritingGradingPage — server-mirrored overall + grade POST (AC7/AC14)', () => {
  test('live overall band mirrors the server rounding; the POST omits overallBand', async () => {
    stubQueue()
    server.use(
      http.get(GRADING_PATH, () =>
        HttpResponse.json({ data: gradingView(), meta: { serverTime: '2026-08-19T00:00:00Z' } }),
      ),
    )
    let capturedBody: Record<string, unknown> | null = null
    server.use(
      http.post(GRADE_PATH, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ data: gradeResponse, meta: { serverTime: '2026-08-19T00:00:00Z' } }, { status: 201 })
      }),
    )
    renderPage()
    await screen.findByText('Alice Nguyen')

    // Fill 6/6/6.5/6.5 → mean 6.25 → .25 special-case → 6.5 (matches the server).
    fireEvent.change(screen.getByTestId('grading-band-taskResponse'), { target: { value: '6' } })
    fireEvent.change(screen.getByTestId('grading-band-coherenceCohesion'), { target: { value: '6' } })
    fireEvent.change(screen.getByTestId('grading-band-lexicalResource'), { target: { value: '6.5' } })
    fireEvent.change(screen.getByTestId('grading-band-grammaticalRange'), { target: { value: '6.5' } })
    expect(screen.getByTestId('grading-overall-band').textContent).toContain('6.5')

    fireEvent.click(screen.getByTestId('writing-grading-surface-submit'))
    fireEvent.click(await screen.findByTestId('grading-release-confirm'))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect(capturedBody).toHaveProperty('criterionScores')
    expect(capturedBody).toHaveProperty('comments')
    expect(capturedBody).not.toHaveProperty('overallBand') // server is authoritative (AC7)
  })
})

describe('WritingGradingPage — role gate (AC12/AC19, TEST-FE-6)', () => {
  test('a student never sees the grading surface — it is absent from the DOM', async () => {
    stubQueue()
    server.use(
      http.get(GRADING_PATH, () =>
        HttpResponse.json({ data: gradingView(), meta: { serverTime: '2026-08-19T00:00:00Z' } }),
      ),
    )
    renderPage('student')
    // The route gate denies before the page mounts.
    await screen.findByTestId('permission-denied-section-header')
    expect(screen.queryByTestId('writing-grading-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('grading-band-inputs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('writing-grading-surface-essay')).not.toBeInTheDocument()
  })
})

describe('WritingGradingPage — durable private draft (D4)', () => {
  test('editing bands persists a per-submission draft and publishes NOTHING until release', async () => {
    stubQueue()
    server.use(
      http.get(GRADING_PATH, () =>
        HttpResponse.json({ data: gradingView(), meta: { serverTime: '2026-08-19T00:00:00Z' } }),
      ),
    )
    let posted = false
    server.use(
      http.post(GRADE_PATH, () => {
        posted = true
        return HttpResponse.json({ data: gradeResponse, meta: { serverTime: '2026-08-19T00:00:00Z' } }, { status: 201 })
      }),
    )
    renderPage()
    await screen.findByText('Alice Nguyen')

    fireEvent.change(screen.getByTestId('grading-band-taskResponse'), { target: { value: '7' } })
    fireEvent.change(screen.getByTestId('grading-band-coherenceCohesion'), { target: { value: '6.5' } })

    // The draft is persisted per submission (survives a refresh) …
    await waitFor(() => {
      const draft = readGradingDraft(SUBMISSION_ID)
      expect(draft?.scores.taskResponse).toBe(7)
      expect(draft?.scores.coherenceCohesion).toBe(6.5)
    })
    // … and NOTHING is published — a draft is private until an explicit release (D4).
    expect(posted).toBe(false)
  })
})

describe('WritingGradingPage — band input (chunk-2 P4)', () => {
  test('a decimal half-band can be typed keystroke-by-keystroke', async () => {
    stubQueue()
    server.use(
      http.get(GRADING_PATH, () =>
        HttpResponse.json({ data: gradingView(), meta: { serverTime: '2026-08-19T00:00:00Z' } }),
      ),
    )
    renderPage()
    await screen.findByText('Alice Nguyen')
    const input = screen.getByTestId('grading-band-taskResponse') as HTMLInputElement

    // Intermediate "6." must not be snapped back to "6" (would eat the decimal point).
    fireEvent.change(input, { target: { value: '6.' } })
    expect(input.value).toBe('6.')
    fireEvent.change(input, { target: { value: '6.5' } })
    expect(input.value).toBe('6.5')
    await waitFor(() => expect(readGradingDraft(SUBMISSION_ID)?.scores.taskResponse).toBe(6.5))
  })
})

describe('WritingGradingPage — reciprocal pin↔card focus (AC13)', () => {
  // A graded submission whose grade carries one anchored comment over "quick"
  // (offsets 4–9 of "The quick brown fox.") so buildEssayHtml paints a <mark>.
  function gradedViewWithAnchoredComment(): TeacherGradingView {
    return gradingView({
      submission: { ...gradingView().submission, status: 'graded' },
      grade: {
        ...gradeResponse,
        comments: [
          { type: 'error', criterion: 'taskResponse', anchorStart: 4, anchorEnd: 9, text: 'word choice' },
        ],
      },
    })
  }

  test('clicking a pin announces its comment; hovering the card pulses the pin', async () => {
    stubQueue()
    server.use(
      http.get(GRADING_PATH, () =>
        HttpResponse.json({ data: gradedViewWithAnchoredComment(), meta: { serverTime: '2026-08-19T00:00:00Z' } }),
      ),
    )
    renderPage()
    await screen.findByText('Alice Nguyen')

    // The anchored span is painted as a <mark> carrying its comment index.
    const essay = screen.getByTestId('writing-grading-surface-essay')
    const pin = () => essay.querySelector<HTMLElement>('[data-anchor-index="0"]')
    expect(pin()).not.toBeNull()
    expect(pin()?.textContent).toBe('quick')

    // Pin click → the reciprocal focus announces the card (scrollIntoView is a
    // guarded no-op in jsdom; the announcement is the observable contract).
    fireEvent.click(pin() as HTMLElement)
    expect(screen.getByRole('status').textContent).toBe('Comment 1 focused')

    // Card hover → the pin(s) for that comment pulse; mouse-out clears it.
    const card = screen.getByTestId('comment-card-c-0')
    fireEvent.mouseOver(card)
    expect(pin()?.classList.contains('cl-anchor-pulse')).toBe(true)
    fireEvent.mouseOut(card)
    expect(pin()?.classList.contains('cl-anchor-pulse')).toBe(false)
  })
})

describe('WritingGradingPage — desktop-only seam (AC17)', () => {
  test('below the desktop breakpoint shows the seam + copy-link', async () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: false, // no min-width match → mobile
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    try {
      stubQueue()
      server.use(
        http.get(GRADING_PATH, () =>
          HttpResponse.json({ data: gradingView(), meta: { serverTime: '2026-08-19T00:00:00Z' } }),
        ),
      )
      renderPage()
      expect(await screen.findByTestId('grading-desktop-seam')).toBeInTheDocument()
      expect(screen.getByTestId('grading-copy-link')).toBeInTheDocument()
    } finally {
      window.matchMedia = original
    }
  })
})

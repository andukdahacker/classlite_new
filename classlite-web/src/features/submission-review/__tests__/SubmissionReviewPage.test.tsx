// Story 5.5a Task 5 (WF-8, risk 6) — SubmissionReviewPage integration, MSW-only
// seam. Covers AC1/AC5/AC6/AC7/AC10/AC11/AC12/AC14: the L/E/E trilogy incl. the
// LOADING skeleton (D11/Sally), 404→not-started + in_progress→resume + 403 error
// routing (non-retryable) vs 5xx (retryable), "review my submission" identity with
// the quiet "grades not released" note as a SECONDARY line (not the hero, D12),
// the neutral on-time / softened-late badge with NO penalty number (AC6/D5),
// the grade-data DOM-negatives (AC7 — no class-average / band / per-Q score /
// correctness / released-feedback / `data-score` anywhere), role-negative
// (TEST-FE-6), axe + focus-on-heading + <title> (AC14), and the scoped mobile
// tree (AC12).
//
// RED-PHASE (Story 5.5a, WF-8 risk-6). Excluded from `vitest run` (filename lacks
// `.test`/`.spec`). Dev renames `.red.tsx`→`.test.tsx` per file as each contract
// lands. `tsc --noEmit` red until the feature module + codegen exist (missing
// `@/features/submission-review/*` + `components['schemas']['StudentSubmissionResult']`
// / `['EnvelopeAudioUrl']`).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
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
import type { components } from '@/lib/api/client'
// RED: barrel does not exist yet (Task 5) — this import is a type-level RED signal.
import { SubmissionReviewPage } from '@/features/submission-review'

// RED: these codegen schemas do not exist yet (Task 1) — intended tsc RED.
type StudentSubmissionResult = components['schemas']['StudentSubmissionResult']
type Submission = components['schemas']['Submission']
type StudentAssignmentView = components['schemas']['StudentAssignmentView']
type AttemptExercise = components['schemas']['AttemptExercise']
type ExerciseSkill = components['schemas']['ExerciseSkill']

const ASSIGNMENT_ID = 'a-1'
const SUBMISSION_ID = 'sub-5'
const SERVER_NOW = '2026-08-14T00:00:00Z'
const DEADLINE = '2026-08-20T00:00:00Z'
const RESULT_PATH = `/api/assignments/${ASSIGNMENT_ID}/result`
const AUDIO_PATH = `/api/assignments/${ASSIGNMENT_ID}/submission/audio`

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: SUBMISSION_ID,
    centerId: 'c-1',
    assignmentId: ASSIGNMENT_ID,
    studentId: 'user-student',
    status: 'submitted',
    isLate: false,
    appliedPenalty: 0,
    startedAt: '2026-08-13T00:00:00Z',
    submittedAt: '2026-08-13T12:00:00Z', // before DEADLINE → on-time
    timeBudgetSeconds: null,
    schemaVersion: 1,
    content: { schemaVersion: 1, text: 'My essay body.' },
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T12:00:00Z',
    ...overrides,
  }
}

function assignment(overrides: Partial<StudentAssignmentView> = {}): StudentAssignmentView {
  return {
    id: ASSIGNMENT_ID,
    exerciseId: 'ex-1',
    classId: 'cl-1',
    status: 'open',
    deadlineAt: DEADLINE,
    hardDeadlineAt: null,
    instructions: null,
    latePenalty: 5,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function exercise(skill: ExerciseSkill = 'writing'): AttemptExercise {
  return {
    id: 'ex-1',
    title: 'IELTS Task 2',
    skill,
    settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
    sections: [
      {
        type: skill === 'writing' ? 'writing' : 'reading',
        title: 'Task',
        content: 'Discuss both views and give your opinion.',
        questionGroups: [],
      },
    ],
  }
}

function result(overrides: Partial<StudentSubmissionResult> = {}): StudentSubmissionResult {
  return {
    submission: submission(),
    assignment: assignment(),
    exercise: exercise('writing'),
    released: false,
    audioUrl: null,
    inProgress: false,
    ...overrides,
  }
}

interface HandlerOpts {
  status?: number
  errorCode?: string
  payload?: StudentSubmissionResult
}

function installResult(opts: HandlerOpts = {}) {
  server.use(
    http.get(RESULT_PATH, () => {
      if (opts.errorCode) {
        return HttpResponse.json(
          { error: { code: opts.errorCode, message: 'x', requestId: 'r' } },
          { status: opts.status ?? 500 },
        )
      }
      return HttpResponse.json({
        data: opts.payload ?? result(),
        meta: { serverTime: SERVER_NOW },
      })
    }),
    http.get(AUDIO_PATH, () =>
      HttpResponse.json({ data: { url: 'https://r2/fresh.m4a' }, meta: { serverTime: SERVER_NOW } }),
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

function renderPage(assignmentId: string = ASSIGNMENT_ID, { role }: { role?: Role } = {}) {
  seedSession(role ?? 'student')
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/assignments/${assignmentId}/submission`]}>
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
                path="/assignments/:assignmentId/submission"
                element={<SubmissionReviewPage />}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

/** Assert an i18n key resolves in BOTH shipped locales (TEST-FE-4). */
function expectKeyInBothLocales(key: string): void {
  expect(i18n.exists(key, { lng: 'en' })).toBe(true)
  expect(i18n.exists(key, { lng: 'vi' })).toBe(true)
}

beforeEach(() => {
  queryClient.clear()
})
afterEach(async () => {
  server.resetHandlers()
  queryClient.clear()
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

describe('SubmissionReviewPage — three-state trilogy (AC11/UX-1)', () => {
  test('P2-1a loading renders a review-shaped SKELETON (role=status, aria-busy), not a spinner', async () => {
    server.use(
      http.get(RESULT_PATH, async () => {
        await delay('infinite')
        return HttpResponse.json({ data: result(), meta: { serverTime: SERVER_NOW } })
      }),
    )
    renderPage()
    const skeleton = await screen.findByTestId('submission-review-skeleton')
    expect(skeleton).toHaveAttribute('role', 'status')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    // It is a skeleton, not a bare spinner.
    expect(screen.queryByTestId('submission-review-spinner')).not.toBeInTheDocument()
  })

  test('P2-1b success renders the review shell', async () => {
    installResult()
    renderPage()
    expect(await screen.findByTestId('submission-review-shell')).toBeInTheDocument()
    expect(screen.getByTestId('submission-review-readback')).toBeInTheDocument()
  })

  test('P2-1c a network 5xx renders an error card (role=alert) WITH a retry (transient)', async () => {
    installResult({ status: 500, errorCode: 'INTERNAL_ERROR' })
    renderPage()
    const alert = await screen.findByTestId('submission-review-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('submission-review-retry')).toBeInTheDocument()
  })
})

describe('SubmissionReviewPage — error routing (AC11)', () => {
  test('P2-2a 404 SUBMISSION_NOT_FOUND → non-retryable "not started" + attempt CTA, no retry', async () => {
    installResult({ status: 404, errorCode: 'SUBMISSION_NOT_FOUND' })
    renderPage()
    expect(await screen.findByTestId('submission-review-not-started')).toBeInTheDocument()
    expect(screen.getByTestId('submission-review-not-started-cta')).toHaveAttribute('href')
    expect(screen.queryByTestId('submission-review-retry')).not.toBeInTheDocument()
  })

  test('P2-2b in_progress → 200 CTA payload → non-retryable "resume" CTA (no terminal leaves)', async () => {
    installResult({
      payload: result({ submission: submission({ status: 'in_progress', submittedAt: null }) }),
    })
    renderPage()
    expect(await screen.findByTestId('submission-review-resume')).toBeInTheDocument()
    expect(screen.getByTestId('submission-review-resume-cta')).toHaveAttribute('href')
    // The short-circuit never mounts the terminal read-back (D10).
    expect(screen.queryByTestId('submission-review-readback')).not.toBeInTheDocument()
    expect(screen.queryByTestId('submission-review-retry')).not.toBeInTheDocument()
  })

  test('P2-2c 403 NOT_ENROLLED → non-retryable error (no retry)', async () => {
    installResult({ status: 403, errorCode: 'NOT_ENROLLED' })
    renderPage()
    await screen.findByTestId('submission-review-error')
    expect(screen.queryByTestId('submission-review-retry')).not.toBeInTheDocument()
  })

  test('P2-2d 403 INSUFFICIENT_ROLE → non-retryable error (no retry)', async () => {
    installResult({ status: 403, errorCode: 'INSUFFICIENT_ROLE' })
    renderPage()
    await screen.findByTestId('submission-review-error')
    expect(screen.queryByTestId('submission-review-retry')).not.toBeInTheDocument()
  })
})

describe('SubmissionReviewPage — identity: review, not pending (AC5/D12)', () => {
  test('P2-3 the heading is "review my submission"; the "grades not released" note is SECONDARY, read-back is the hero', async () => {
    installResult()
    renderPage()
    const heading = await screen.findByTestId('submission-review-heading')
    expect(heading).toHaveTextContent(i18n.t('submissionReview.heading'))
    // The quiet note exists...
    const note = screen.getByTestId('submission-review-not-released-note')
    expect(note).toHaveTextContent(i18n.t('submissionReview.notReleased.note'))
    // ...but it is NOT the hero: the read-back is the main region's content.
    const main = screen.getByRole('main')
    expect(within(main).getByTestId('submission-review-readback')).toBeInTheDocument()
    // The note is not the page heading.
    expect(note).not.toBe(heading)
    expectKeyInBothLocales('submissionReview.heading')
    expectKeyInBothLocales('submissionReview.notReleased.note')
    expectKeyInBothLocales('submissionReview.notReleased.horizon')
  })
})

describe('SubmissionReviewPage — on-time / late badge (AC6/D5)', () => {
  test('P2-4a on-time submission renders an explicit calm "Submitted on time" (not blank)', async () => {
    installResult() // isLate:false, submittedAt < deadline
    renderPage()
    const badge = await screen.findByTestId('submission-status-badge')
    expect(badge).toHaveTextContent(i18n.t('submissionReview.status.onTime'))
    expect(badge.getAttribute('data-tone')).not.toBe('alarm')
    expectKeyInBothLocales('submissionReview.status.onTime')
  })

  test('P2-4b late submission → "after the due date" + soft note; muted (NOT alarm/destructive); NO penalty number', async () => {
    installResult({
      payload: result({
        submission: submission({
          isLate: true,
          appliedPenalty: 15, // must NEVER render as a number in 5-5a
          submittedAt: '2026-08-22T00:00:00Z', // after DEADLINE
        }),
      }),
    })
    renderPage()
    const badge = await screen.findByTestId('submission-status-badge')
    expect(badge).toHaveTextContent(i18n.t('submissionReview.status.late'))
    expect(screen.getByTestId('submission-review-late-note')).toHaveTextContent(
      i18n.t('submissionReview.status.lateNote'),
    )
    // Neutral, not red/alarm (pinned marker: data-tone="muted"; never a destructive class).
    expect(badge).toHaveAttribute('data-tone', 'muted')
    expect(badge.className).not.toMatch(/destructive|alarm|bg-red/i)
    // NO penalty NUMBER anywhere (AC6 — penalty math is 5-5b).
    expect(screen.queryByTestId('submission-penalty')).not.toBeInTheDocument()
    expect(screen.queryByText(/15\s*(%|points?|penalty)/i)).not.toBeInTheDocument()
    expectKeyInBothLocales('submissionReview.status.late')
    expectKeyInBothLocales('submissionReview.status.lateNote')
  })
})

describe('SubmissionReviewPage — role-negative (P1-7, TEST-FE-6)', () => {
  test.each<Role>(['teacher', 'owner', 'admin'])(
    '%s is denied — the review surface is ABSENT from the DOM',
    async (role) => {
      installResult()
      renderPage(ASSIGNMENT_ID, { role })
      await waitFor(() => {
        expect(screen.queryByTestId('submission-review-shell')).not.toBeInTheDocument()
        expect(screen.queryByTestId('submission-review-readback')).not.toBeInTheDocument()
        expect(screen.queryByTestId('submission-review-heading')).not.toBeInTheDocument()
        expect(screen.queryByTestId('result-speaking-audio')).not.toBeInTheDocument()
      })
    },
  )
})

describe('SubmissionReviewPage — NO grade data anywhere (P1-8/AC7)', () => {
  test.each<[string, StudentSubmissionResult]>([
    ['success', result()],
    ['late', result({ submission: submission({ isLate: true, appliedPenalty: 15 }) })],
  ])('no class-average / band / per-Q score / correctness / feedback in the %s state', async (_label, payload) => {
    installResult({ payload })
    const { container } = renderPage()
    await screen.findByTestId('submission-review-shell')
    expect(screen.queryByTestId('class-average')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cohort-average')).not.toBeInTheDocument()
    expect(screen.queryByTestId('submission-band')).not.toBeInTheDocument()
    expect(screen.queryByTestId('submission-grade')).not.toBeInTheDocument()
    expect(screen.queryByTestId('question-score')).not.toBeInTheDocument()
    expect(screen.queryByTestId('question-correctness')).not.toBeInTheDocument()
    expect(screen.queryByTestId('grade-feedback')).not.toBeInTheDocument()
    // A single leaked data-score attribute passes a class-average-only test and still leaks (Murat).
    expect(container.querySelector('[data-score]')).toBeNull()
  })
})

describe('SubmissionReviewPage — a11y + i18n + focus + title (P2-8/P2-9/AC14)', () => {
  test('axe clean on the loading skeleton', async () => {
    server.use(
      http.get(RESULT_PATH, async () => {
        await delay('infinite')
        return HttpResponse.json({ data: result(), meta: { serverTime: SERVER_NOW } })
      }),
    )
    const { container } = renderPage()
    await screen.findByTestId('submission-review-skeleton')
    expect(await axe(container)).toHaveNoViolations()
  })

  test.each<ExerciseSkill>(['writing', 'reading', 'speaking'])(
    'axe clean on the loaded %s read-back',
    async (skill) => {
      installResult({ payload: result({ exercise: exercise(skill) }) })
      const { container } = renderPage()
      await screen.findByTestId('submission-review-shell')
      expect(await axe(container)).toHaveNoViolations()
    },
  )

  test('axe clean on the not-started and error states', async () => {
    installResult({ status: 404, errorCode: 'SUBMISSION_NOT_FOUND' })
    const { container } = renderPage()
    await screen.findByTestId('submission-review-not-started')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('focus lands on the heading on load, and document.title is set for the route', async () => {
    installResult()
    renderPage()
    const heading = await screen.findByTestId('submission-review-heading')
    await waitFor(() => expect(heading).toHaveFocus())
    expect(document.title).not.toBe('')
    expect(document.title).toContain(i18n.t('submissionReview.heading'))
  })

  test('the error and back copy exist in both locales (TEST-FE-4)', () => {
    for (const key of [
      'submissionReview.error.title',
      'submissionReview.error.body',
      'submissionReview.error.retry',
      'submissionReview.notStarted.title',
      'submissionReview.notStarted.body',
      'submissionReview.notStarted.cta',
      'submissionReview.notSubmitted.title',
      'submissionReview.notSubmitted.cta',
      'submissionReview.back',
    ]) {
      expectKeyInBothLocales(key)
    }
  })
})

describe('SubmissionReviewPage — mobile tree (P3-1/AC12)', () => {
  test('the mobile tree renders with a full-width, ≥44px audio control and legible reading measure', async () => {
    // Force the mobile breakpoint: no `min-width` query matches (see vitest-setup default).
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    try {
      installResult({
        payload: result({
          exercise: exercise('speaking'),
          submission: submission({
            content: { schemaVersion: 1, audioKey: 'c-1/rec.m4a', contentType: 'audio/mp4', durationSec: 30 },
          }),
          audioUrl: 'https://r2/inline.m4a',
        }),
      })
      renderPage()
      // Single mobile tree (never both trees → no duplicated testids).
      expect(await screen.findByTestId('submission-review-shell-mobile')).toBeInTheDocument()
      expect(screen.queryByTestId('submission-review-shell-desktop')).not.toBeInTheDocument()
      // The audio control is the invested split: full-width + a large touch target.
      const audio = screen.getByTestId('result-speaking-audio')
      expect(audio).toHaveAttribute('data-fullwidth', 'true')
      expect(audio).toHaveAttribute('data-touch-target', 'lg')
      // Reading measure ≥16px so iOS doesn't zoom (pinned marker).
      expect(screen.getByTestId('result-speaking-playback')).toHaveAttribute(
        'data-mobile-legible',
        'true',
      )
    } finally {
      window.matchMedia = original
    }
  })
})

// Story 5.5b Task 7 (WF-8, risk 5) — the graded-display integration suite, MSW-only
// seam. This is the RED-first heart of the story: XSS capability-absence on teacher
// free-text, cross-side anchor slice-equality via the SHARED WRITING_ANCHOR_FIXTURE,
// the released = RENDER gate (not visibility), deep DOM-negatives, comment
// reachability, the non-writing skill-gate (buildEssayHtml never called), the /result
// redirect, penalty math, the read-only card + ack line, mobile s79, axe, and i18n.
//
// buildEssayHtml is wrapped (not replaced) so the writing tests still paint real marks
// AND the non-writing test can assert the builder is never called.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import {
  MemoryRouter,
  Route,
  Routes,
  RouterProvider,
  createMemoryRouter,
  redirect,
} from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import type { components } from '@/lib/api/client'
import {
  WRITING_ANCHOR_COMMENTS,
  WRITING_ANCHOR_ESSAY,
  WRITING_ANCHOR_EXPECTED_SLICES,
  WRITING_ANCHOR_PAINTED_COUNT,
} from '@/lib/test/writingAnchorFixture'
import { SubmissionReviewPage } from '@/features/submission-review'

// Wrap buildEssayHtml so the non-writing gate can assert it is NEVER called, while the
// writing tests still exercise the real UTF-16/XSS-safe builder.
vi.mock('@/lib/essayAnchors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/essayAnchors')>()
  return { ...actual, buildEssayHtml: vi.fn(actual.buildEssayHtml) }
})
import { buildEssayHtml } from '@/lib/essayAnchors'

type StudentSubmissionResult = components['schemas']['StudentSubmissionResult']
type Submission = components['schemas']['Submission']
type StudentAssignmentView = components['schemas']['StudentAssignmentView']
type AttemptExercise = components['schemas']['AttemptExercise']
type ExerciseSkill = components['schemas']['ExerciseSkill']
type StudentGradeView = components['schemas']['StudentGradeView']
type CriterionScores = components['schemas']['CriterionScores']
type AnchoredComment = components['schemas']['AnchoredComment']

const ASSIGNMENT_ID = 'a-1'
const SERVER_NOW = '2026-08-14T00:00:00Z'
const DEADLINE = '2026-08-20T00:00:00Z'
const RESULT_PATH = `/api/assignments/${ASSIGNMENT_ID}/result`
const AUDIO_PATH = `/api/assignments/${ASSIGNMENT_ID}/submission/audio`

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'sub-5',
    centerId: 'c-1',
    assignmentId: ASSIGNMENT_ID,
    studentId: 'user-student',
    status: 'graded',
    isLate: false,
    appliedPenalty: 0,
    startedAt: '2026-08-13T00:00:00Z',
    submittedAt: '2026-08-13T12:00:00Z',
    timeBudgetSeconds: null,
    schemaVersion: 1,
    content: { schemaVersion: 1, text: WRITING_ANCHOR_ESSAY },
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T12:00:00Z',
    ...overrides,
  }
}

function assignment(): StudentAssignmentView {
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
        content: 'Discuss both views.',
        questionGroups: [],
      },
    ],
  }
}

const SCORES: CriterionScores = {
  taskResponse: 7,
  coherenceCohesion: 6,
  lexicalResource: 5,
  grammaticalRange: 6.5,
}

function grade(overrides: Partial<StudentGradeView> = {}): StudentGradeView {
  return {
    overallBand: 6,
    criterionScores: SCORES,
    comments: WRITING_ANCHOR_COMMENTS,
    feedback: 'Solid attempt — tighten your topic sentences.',
    gradedAt: '2026-08-14T00:00:00Z',
    ...overrides,
  }
}

function result(overrides: Partial<StudentSubmissionResult> = {}): StudentSubmissionResult {
  return {
    submission: submission(),
    assignment: assignment(),
    exercise: exercise('writing'),
    released: true,
    grade: grade(),
    audioUrl: null,
    inProgress: false,
    ...overrides,
  }
}

function installResult(payload: StudentSubmissionResult = result()) {
  server.use(
    http.get(RESULT_PATH, () =>
      HttpResponse.json({ data: payload, meta: { serverTime: SERVER_NOW } }),
    ),
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

function renderPage(path = `/assignments/${ASSIGNMENT_ID}/submission`, { role }: { role?: Role } = {}) {
  seedSession(role ?? 'student')
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
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
              <Route path="/assignments/:assignmentId/submission" element={<SubmissionReviewPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

/** Force the mobile breakpoint (no min-width query matches). */
function forceMobile(): () => void {
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
  return () => {
    window.matchMedia = original
  }
}

beforeEach(() => {
  queryClient.clear()
  vi.mocked(buildEssayHtml).mockClear()
})
afterEach(async () => {
  server.resetHandlers()
  queryClient.clear()
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

describe('5.5b — released-writing graded display (AC1/AC3/AC4/AC5)', () => {
  test('renders the band-ring hero, four criteria, feedback quote, and the ack line', async () => {
    installResult()
    renderPage()
    await screen.findByTestId('student-grade-block')

    const ring = screen.getByTestId('student-grade-band-ring')
    expect(ring).toHaveAttribute('aria-label', i18n.t('submissionReview.grade.bandAria', { band: '6.0' }))
    expect(screen.getByTestId('student-grade-band-value')).toHaveTextContent('6.0')

    for (const key of ['taskResponse', 'coherenceCohesion', 'lexicalResource', 'grammaticalRange']) {
      expect(screen.getByTestId(`student-grade-criterion-${key}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('student-grade-criterion-lexicalResource-value')).toHaveTextContent('5.0')
    expect(screen.getByTestId('student-grade-feedback')).toHaveTextContent(
      'Solid attempt — tighten your topic sentences.',
    )
    expect(screen.getByTestId('student-grade-ack')).toHaveTextContent(i18n.t('submissionReview.grade.ack'))
  })

  test('the band-ring appears-not-performs: one neutral (not band-tinted) stroke, no count-up/sweep', async () => {
    installResult()
    renderPage()
    const ring = await screen.findByTestId('student-grade-band-ring')
    // Neutral ink stroke — NOT tinted green/amber/red by the band value.
    expect(ring.className).toMatch(/border-\[var\(--cl-line\)\]/)
    expect(ring.className).not.toMatch(/green|amber|red|emerald|destructive/i)
    // No celebratory motion classes on the ring or its value.
    expect(ring.className).not.toMatch(/animate-|transition|count/i)
    expect(screen.getByTestId('student-grade-band-value').className).not.toMatch(/animate-|count/i)
  })

  test('per-criterion pinned counts annotate each criterion; an error pin borders its criterion', async () => {
    installResult()
    renderPage()
    await screen.findByTestId('student-grade-block')
    // The fixture pins one comment on lexicalResource (error) + one on taskResponse
    // (praise) + one on coherenceCohesion (suggestion) + one on grammaticalRange (error).
    expect(screen.getByTestId('student-grade-criterion-lexicalResource-pinned')).toHaveTextContent(
      i18n.t('submissionReview.grade.pinned', { count: 1 }),
    )
    // Error-pinned criteria carry the ONLY sanctioned red (a data flag, not colour-only).
    expect(screen.getByTestId('student-grade-criterion-lexicalResource')).toHaveAttribute('data-has-error', 'true')
    expect(screen.getByTestId('student-grade-criterion-taskResponse')).toHaveAttribute('data-has-error', 'false')
  })

  test('strength-first coaching: a strength AND a REQUIRED focus area are both named', async () => {
    installResult()
    renderPage()
    await screen.findByTestId('student-grade-block')
    expect(screen.getByTestId('student-grade-strength')).toHaveTextContent(i18n.t('criterion.taskResponse'))
    // Weakest is lexicalResource (5) — the focus area MUST be present (coaching, not verdict).
    expect(screen.getByTestId('student-grade-focus-area')).toHaveTextContent(i18n.t('criterion.lexicalResource'))
  })

  test('graceful degrade: a straight-8.0 essay names no manufactured weakness', async () => {
    installResult(
      result({
        grade: grade({
          overallBand: 8,
          criterionScores: { taskResponse: 8, coherenceCohesion: 8, lexicalResource: 8, grammaticalRange: 8 },
          // Clean straight-8 with no error pins — the uniform degrade is about the
          // focus-area copy, not the error border (which tracks real error comments).
          comments: [],
        }),
      }),
    )
    renderPage()
    await screen.findByTestId('student-grade-block')
    const focus = screen.getByTestId('student-grade-focus-area')
    expect(focus).toHaveTextContent(i18n.t('submissionReview.grade.focusAreaUniform'))
    // ...and NO arbitrary "strongest" is crowned when all four scores tie (AC4).
    expect(screen.queryByTestId('student-grade-strength')).not.toBeInTheDocument()
    // The focus area is NOT a manufactured weakness (no criterion named as a flaw).
    for (const key of ['taskResponse', 'coherenceCohesion', 'lexicalResource', 'grammaticalRange']) {
      expect(screen.getByTestId(`student-grade-criterion-${key}`)).toHaveAttribute('data-has-error', 'false')
    }
  })

  test('the NotReleasedNote is SUPPRESSED and the timestamp/badge still render (one document, AC12)', async () => {
    installResult()
    renderPage()
    await screen.findByTestId('student-grade-block')
    expect(screen.queryByTestId('submission-review-not-released-note')).not.toBeInTheDocument()
    // The read-back below is NOT orphaned; the badge survives the released state.
    expect(screen.getByTestId('submission-status-badge')).toBeInTheDocument()
    expect(screen.getByTestId('submission-review-readback')).toBeInTheDocument()
  })
})

describe('5.5b — anchored comments: cross-side slice-equality via the SHARED fixture (AC6/Murat)', () => {
  test('paints exactly the surviving anchors; each mark slices to the exact expected grapheme', async () => {
    installResult()
    const { container } = renderPage()
    await screen.findByTestId('graded-essay-text')
    const marks = container.querySelectorAll('mark[data-anchor-index]')
    // Two of the four fixture comments survive normalization (surrogate-safe); the
    // pair-splitting one and the null/null one demote — NOT painted.
    expect(marks).toHaveLength(WRITING_ANCHOR_PAINTED_COUNT)

    const mark0 = container.querySelector('mark[data-anchor-index="0"]')
    const mark1 = container.querySelector('mark[data-anchor-index="1"]')
    // Slice EQUALITY (not "a mark exists") — the multibyte offsets land exactly.
    expect(mark0?.textContent).toBe(WRITING_ANCHOR_EXPECTED_SLICES[0])
    expect(mark1?.textContent).toBe(WRITING_ANCHOR_EXPECTED_SLICES[1])
    // The error pin carries the error tone class (byte-identical to the teacher).
    expect(mark0?.className).toContain('cl-anchor-error')
  })

  test('every teacher comment is reachable: count parity; null/null in General notes, NOT double-painted', async () => {
    installResult()
    const { container } = renderPage()
    await screen.findByTestId('graded-essay')
    // All four comments reachable as cards (2 anchored + 2 in General notes).
    const cards = container.querySelectorAll('[data-testid^="comment-card-"]')
    expect(cards).toHaveLength(WRITING_ANCHOR_COMMENTS.length)
    // The whole-essay + demoted comments live in General notes.
    const general = screen.getByTestId('student-grade-general-notes')
    expect(within(general).getByTestId('comment-card-3')).toBeInTheDocument() // null/null
    expect(within(general).getByTestId('comment-card-2')).toBeInTheDocument() // surrogate-split demote
    // A null/null comment is NEVER painted as a <mark>.
    expect(container.querySelector('mark[data-anchor-index="3"]')).toBeNull()
    expect(container.querySelector('mark[data-anchor-index="2"]')).toBeNull()
  })

  test('a click on a highlight scrolls its card (reciprocity read-only, pin↔card)', async () => {
    installResult()
    const { container } = renderPage()
    await screen.findByTestId('graded-essay-text')
    const mark = container.querySelector<HTMLElement>('mark[data-anchor-index="0"]')
    // scrollIntoView is a guarded no-op in jsdom; the wiring must not throw.
    expect(() => mark?.click()).not.toThrow()
    expect(screen.getByTestId('comment-card-0')).toBeInTheDocument()
  })
})

describe('5.5b — XSS: the dangerous capability is ABSENT on teacher free-text (AC7b/Murat)', () => {
  test('a malicious comment text injects NO element/attribute; feedback survives as textContent', async () => {
    const malicious: AnchoredComment[] = [
      { type: 'error', criterion: 'lexicalResource', anchorStart: 0, anchorEnd: 2, text: '"><img src=x onerror=alert(1)>' },
      { type: 'suggestion', criterion: 'coherenceCohesion', anchorStart: null, anchorEnd: null, text: '</mark><script>alert(2)</script>' },
    ]
    installResult(
      result({
        submission: submission({ content: { schemaVersion: 1, text: 'AB cd ef.' } }),
        grade: grade({ comments: malicious, feedback: 'careful with < and > here' }),
      }),
    )
    const { container } = renderPage()
    await screen.findByTestId('graded-essay')
    // No injected image / onerror handler anywhere (the essay region OR the card body).
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('img[onerror]')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    // Exactly one painted mark (the first comment) — the </mark><script> text does not
    // break out into a stray <script> node.
    expect(container.querySelector('mark[data-anchor-index="0"]')?.getAttribute('onerror')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    // The card body renders the payload as escaped text.
    expect(screen.getByTestId('comment-card-0')).toHaveTextContent('"><img src=x onerror=alert(1)>')
    // feedback with a literal `<` survives as textContent, no injected element.
    expect(screen.getByTestId('student-grade-feedback')).toHaveTextContent('careful with < and > here')
  })
})

describe('5.5b — released is a RENDER gate, not a visibility gate (AC11/Murat)', () => {
  test('released:false + a fully-populated grade → band/criteria/comments ABSENT from the DOM', async () => {
    // Cannot happen from the real server (attempt_service nils grade unless released) —
    // this asserts the client's OWN invariant (defense-in-depth).
    installResult(result({ released: false, grade: grade() }))
    const { container } = renderPage()
    await screen.findByTestId('submission-review-shell')
    // The pending path renders; the grade block is not merely hidden — it is absent.
    expect(screen.queryByTestId('student-grade-block')).not.toBeInTheDocument()
    expect(screen.queryByTestId('graded-essay')).not.toBeInTheDocument()
    expect(screen.getByTestId('submission-review-not-released-note')).toBeInTheDocument()
    // The band VALUE is nowhere in the DOM text/attrs.
    expect(container.querySelector('[data-testid="student-grade-band-value"]')).toBeNull()
    expect(container.textContent).not.toContain('6.0')
  })

  test('released:true + grade:null (invalid-state) → pending path, NOT an empty grade block (AC12)', async () => {
    installResult(result({ released: true, grade: null }))
    renderPage()
    await screen.findByTestId('submission-review-shell')
    expect(screen.queryByTestId('student-grade-block')).not.toBeInTheDocument()
    expect(screen.getByTestId('submission-review-not-released-note')).toBeInTheDocument()
  })
})

describe('5.5b — permanent omissions survive released:true (AC11/Murat DOM-negatives)', () => {
  test('no class-average / graded_by / AI-confidence / data-score even when a grade renders', async () => {
    installResult()
    const { container } = renderPage()
    await screen.findByTestId('student-grade-block')
    expect(screen.queryByTestId('class-average')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cohort-average')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-confidence')).not.toBeInTheDocument()
    expect(container.querySelector('[data-score]')).toBeNull()
    expect(container.querySelector('[data-grade]')).toBeNull()
    expect(container.querySelector('[data-raw]')).toBeNull()
    // No element's attribute VALUE leaks graded_by / gradedBy.
    for (const el of Array.from(container.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.value).not.toMatch(/graded_?by/i)
      }
    }
    // No JSON hydration blob carrying the raw grade.
    expect(container.querySelector('script[type="application/json"]')).toBeNull()
    // The band-ring aria-label is EXACTLY the band label — nothing appended.
    expect(screen.getByTestId('student-grade-band-ring')).toHaveAttribute(
      'aria-label',
      i18n.t('submissionReview.grade.bandAria', { band: '6.0' }),
    )
  })
})

describe('5.5b — non-writing released: skill-gate, buildEssayHtml NEVER called (AC/D6/Winston)', () => {
  test.each<ExerciseSkill>(['speaking', 'reading'])(
    'a released %s grade renders "coming soon" and never enters the essay-anchor machinery',
    async (skill) => {
      installResult(
        result({
          exercise: exercise(skill),
          submission: submission({
            content:
              skill === 'speaking'
                ? { schemaVersion: 1, audioKey: 'c-1/rec.m4a', contentType: 'audio/mp4', durationSec: 30 }
                : { schemaVersion: 1, answers: {} },
          }),
          audioUrl: skill === 'speaking' ? 'https://r2/inline.m4a' : null,
        }),
      )
      renderPage()
      await screen.findByTestId('student-grade-coming-soon')
      expect(screen.queryByTestId('student-grade-block')).not.toBeInTheDocument()
      expect(screen.queryByTestId('graded-essay')).not.toBeInTheDocument()
      // The stronger assertion: the builder is never called on a non-writing grade.
      expect(vi.mocked(buildEssayHtml)).not.toHaveBeenCalled()
    },
  )
})

describe('5.5b — late-penalty math (AC9/FR-31)', () => {
  test('late + penalty → exact FR-31 string, neutral (never red)', async () => {
    installResult(
      result({
        submission: submission({ isLate: true, appliedPenalty: 0.5, submittedAt: '2026-08-22T00:00:00Z' }),
        grade: grade({ overallBand: 6 }),
      }),
    )
    renderPage()
    const penalty = await screen.findByTestId('student-grade-penalty')
    expect(penalty).toHaveTextContent(
      i18n.t('submissionReview.grade.penaltyBreakdown', { original: '6.0', penalty: '0.5', final: '5.5' }),
    )
    expect(penalty).toHaveAttribute('data-tone', 'muted')
    expect(penalty.className).not.toMatch(/destructive|red|alarm/i)
  })

  test('on-time (appliedPenalty === 0) → the penalty block is ABSENT (no phantom "0.0" line)', async () => {
    installResult() // on-time, appliedPenalty 0
    renderPage()
    await screen.findByTestId('student-grade-block')
    expect(screen.queryByTestId('student-grade-penalty')).not.toBeInTheDocument()
  })
})

describe('5.5b — read-only card + no dead reply affordance (AC5/AC7)', () => {
  test('the anchored comment card renders NO interactive control and no reply-shaped affordance', async () => {
    installResult()
    renderPage()
    const card = await screen.findByTestId('comment-card-0')
    // No interactive control (button → null, not merely disabled).
    expect(card.querySelectorAll('button, a, input, select, textarea')).toHaveLength(0)
    // No dead reply affordance (no "reply" text, no "Have a question?" header).
    expect(screen.queryByText(/reply|have a question/i)).not.toBeInTheDocument()
    // The one honest read-only acknowledgment line IS present.
    expect(screen.getByTestId('student-grade-ack')).toBeInTheDocument()
  })
})

describe('5.5b — mobile s79 (AC10)', () => {
  test('mobile renders comments as a full-width stack below the essay, NOT a side rail', async () => {
    const restore = forceMobile()
    try {
      installResult()
      renderPage()
      await screen.findByTestId('submission-review-shell-mobile')
      expect(screen.queryByTestId('submission-review-shell-desktop')).not.toBeInTheDocument()
      // Mobile comment placement differs: a below-essay stack, not the desktop rail.
      expect(screen.getByTestId('graded-essay-comments-mobile')).toBeInTheDocument()
      expect(screen.queryByTestId('graded-essay-rail')).not.toBeInTheDocument()
      // Every comment still reachable on mobile (no accordion tearing — flat stack).
      const cards = document.querySelectorAll('[data-testid^="comment-card-"]')
      expect(cards).toHaveLength(WRITING_ANCHOR_COMMENTS.length)
    } finally {
      restore()
    }
  })
})

describe('5.5b — a11y (AC14) + i18n (AC13)', () => {
  test.each<[string, () => StudentSubmissionResult]>([
    ['graded-writing', () => result()],
    ['graded-with-penalty', () => result({ submission: submission({ isLate: true, appliedPenalty: 0.5 }) })],
    ['released-no-comments', () => result({ grade: grade({ comments: [] }) })],
  ])('axe clean on the %s state', async (_label, make) => {
    installResult(make())
    const { container } = renderPage()
    await screen.findByTestId('student-grade-block')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('axe clean on the mobile graded state', async () => {
    const restore = forceMobile()
    try {
      installResult()
      const { container } = renderPage()
      await screen.findByTestId('student-grade-block')
      expect(await axe(container)).toHaveNoViolations()
    } finally {
      restore()
    }
  })

  test('the grade i18n keys resolve in BOTH locales', () => {
    for (const key of [
      'submissionReview.grade.heading',
      'submissionReview.grade.overallBandLabel',
      'submissionReview.grade.bandAria',
      'submissionReview.grade.criteriaLabel',
      'submissionReview.grade.pinned_one',
      'submissionReview.grade.pinned_other',
      'submissionReview.grade.strength',
      'submissionReview.grade.focusArea',
      'submissionReview.grade.focusAreaUniform',
      'submissionReview.grade.feedbackLabel',
      'submissionReview.grade.feedbackAttribution',
      'submissionReview.grade.ack',
      'submissionReview.grade.generalNotes',
      'submissionReview.grade.commentsLabel',
      'submissionReview.grade.penaltyBreakdown',
      'submissionReview.grade.penaltyExplainer',
      'submissionReview.grade.comingSoon',
    ]) {
      expect(i18n.exists(key, { lng: 'en' })).toBe(true)
      expect(i18n.exists(key, { lng: 'vi' })).toBe(true)
    }
  })
})

describe('5.5b — /result redirect alias (D-ROUTE)', () => {
  test('role-negative: a teacher is denied the graded surface (absent from the DOM)', async () => {
    installResult()
    renderPage(`/assignments/${ASSIGNMENT_ID}/submission`, { role: 'teacher' })
    await waitFor(() => {
      expect(screen.queryByTestId('student-grade-block')).not.toBeInTheDocument()
      expect(screen.queryByTestId('graded-essay')).not.toBeInTheDocument()
    })
  })

  test('/result redirects to /submission with :id preserved and renders the SAME graded data', async () => {
    installResult()
    seedSession('student')
    const client = createTestQueryClient()
    const router = createMemoryRouter(
      [
        {
          // The D-ROUTE alias — the exact loader shape registered in routes.tsx.
          path: '/assignments/:assignmentId/result',
          loader: ({ params }) => redirect(`/assignments/${params.assignmentId}/submission`),
        },
        {
          path: '/assignments/:assignmentId/submission',
          element: (
            <RouteRoleGate
              allowedRoles={['student']}
              requiredRolesForCopy={['owner', 'admin']}
              sectionNameKey="assignments"
            />
          ),
          children: [{ index: true, element: <SubmissionReviewPage /> }],
        },
      ],
      { initialEntries: [`/assignments/${ASSIGNMENT_ID}/result`] },
    )
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    )
    // The redirect resolves to /submission (:id preserved) and the graded page renders
    // the correct data — not merely "navigated".
    await screen.findByTestId('student-grade-block')
    expect(router.state.location.pathname).toBe(`/assignments/${ASSIGNMENT_ID}/submission`)
    expect(screen.getByTestId('student-grade-band-value')).toHaveTextContent('6.0')
  })
})

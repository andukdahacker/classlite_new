/**
 * Story 6.4b — Auto-Grading objective sections, FRONTEND — RED-PHASE ATDD scaffold
 * (/bmad-tea AT 6-4b · classlite-web Vitest leg). MSW-boundary component suite for
 * the teacher ObjectiveGradingPage + the GradingRoute objective dispatch branch.
 * Consumes the FROZEN 6-4a contract verbatim (TeacherGradingView.autoGrade:
 * AutoGradeView, POST /auto-grade/overrides → EnvelopeAutoGradeView, POST /release
 * → EnvelopeGrade). Mirrors SpeakingGradingPage.test.tsx exactly for: createTestQueryClient
 * (retry:false) per test, dual session seed (provider qc + module singleton for the
 * role gate), i18n via <I18nextProvider>, MSW `server.use(...)` per test, role queries,
 * vitest-axe.
 *
 * =====================================================================================
 * WHY THIS FILE IS RED (do NOT skip — real asserting tests, compile-red is the signal):
 *   The file imports modules that do NOT exist yet, so `tsc -b` + `vitest run` fail at
 *   import/compile. That is the intended RED per reference_atdd_red_convention.
 *
 * GREEN-PHASE SEAMS — the exact modules/fields that must exist for this file to compile
 * and pass (Task N, dev phase):
 *   1. `../ObjectiveGradingPage`  → export `ObjectiveGradingPage` — the objective teacher
 *      surface. Reads useGradingSubmission(sid); renders the summary band, the per-answer
 *      breakdown in flattenQuestions(exercise) document order keyed by colon questionRef,
 *      the needs_review reckoning note + resolve-nudge, per-row override buttons, the
 *      release reckoning dialog, and the post-release read-only state. Desktop-only seam
 *      reuses grading.mobileSeam.*.
 *   2. `../api/useOverrideAutoGradeAnswer` → export `useOverrideAutoGradeAnswer(sid)` —
 *      POST /api/submissions/{id}/auto-grade/overrides {questionRef, mark}; unwraps
 *      EnvelopeAutoGradeView.data; SEEDS gradingKeys.detail with the recomputed AutoGradeView
 *      (so After-overrides updates BEFORE the invalidation refetch resolves — D-seed), then
 *      invalidates. A failed override leaves the prior autoGrade standing (no dangling write).
 *   3. `../api/useReleaseAutoGrade` → export `useReleaseAutoGrade(sid)` — POST
 *      /api/submissions/{id}/release (no body); unwraps EnvelopeGrade.data; invalidates so
 *      the composite-key remount re-seeds released:true.
 *   4. `AutoGradeView.releasedProjection: { rawScore:number, band:number }` — NEW field this
 *      story adds to the generated `components['schemas']['AutoGradeView']`. The reckoning
 *      dialog reads it verbatim (UI computes nothing — D3). Until the OpenAPI regen lands,
 *      the `.releasedProjection` accesses below are compile-red on the generated type. Correct.
 *   5. `objectiveGrading.*` i18n keys in en.json AND vi.json (see story-6-4b-i18n.test.ts for
 *      the closed list). Reused verbatim (NOT re-keyed): grading.error.* / grading.release.* /
 *      grading.mobileSeam.* / grading.queue.*.
 * =====================================================================================
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, delay, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { toast } from 'sonner'
import { axe } from 'vitest-axe'
import { afterEach, describe, expect, test, vi } from 'vitest'

import RouteRoleGate from '@/components/shared/RouteRoleGate'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import i18n from '@/lib/i18n'
import type { components } from '@/lib/api/client'
import { createTestQueryClient, queryClient as singletonQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'

import { GradingRoute } from '@/features/grading'
// GREEN-PHASE SEAMS (missing today → compile-red):
import { ObjectiveGradingPage } from '../ObjectiveGradingPage'
import { useOverrideAutoGradeAnswer } from '../api/useOverrideAutoGradeAnswer'
import { useReleaseAutoGrade } from '../api/useReleaseAutoGrade'

type TeacherGradingView = components['schemas']['TeacherGradingView']
type AutoGradeView = components['schemas']['AutoGradeView']
type AutoGradeAnswerView = components['schemas']['AutoGradeAnswerView']
type AttemptExercise = components['schemas']['AttemptExercise']

const CLASS_ID = 'cl-1'
const ASSIGNMENT_ID = 'a-1'
const SUBMISSION_ID = 'sub-obj-1'
const GRADING_PATH = `/api/submissions/${SUBMISSION_ID}/grading`
const OVERRIDE_PATH = `/api/submissions/${SUBMISSION_ID}/auto-grade/overrides`
const RELEASE_PATH = `/api/submissions/${SUBMISSION_ID}/release`

// ---------------------------------------------------------------------------
// Fixtures — an objective (reading) submission with a real nested exercise so
// flattenQuestions(exercise) has a document order to key the rows against.
// ---------------------------------------------------------------------------

/** A two-section reading exercise: 3 questions in DOCUMENT order
 *  0:0:0 (Q1), 0:0:1 (Q2), 1:0:0 (Q3). AC7 relies on this order. */
function objectiveExercise(): AttemptExercise {
  return {
    id: 'ex-1',
    title: 'Reading Practice 1',
    skill: 'reading',
    settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
    sections: [
      {
        type: 'reading',
        title: 'Passage 1',
        content: 'The rainforest...',
        questionGroups: [
          {
            type: 'true_false_notgiven',
            instructions: 'TFNG',
            questions: [
              { text: 'Q1 — the forest is old', type: 'true_false_notgiven', options: [] },
              { text: 'Q2 — it rains daily', type: 'true_false_notgiven', options: [] },
            ],
          },
        ],
      },
      {
        type: 'reading',
        title: 'Passage 2',
        content: 'The ocean...',
        questionGroups: [
          {
            type: 'fill_in_blank',
            instructions: 'Fill the gap',
            questions: [{ text: 'Q3 — the tide is ____', type: 'fill_in_blank', options: [] }],
          },
        ],
      },
    ],
  } as AttemptExercise
}

function answer(overrides: Partial<AutoGradeAnswerView> & { questionRef: string }): AutoGradeAnswerView {
  return {
    questionText: 'a question',
    studentAnswer: 'student wrote this',
    studentFlagged: false,
    correctAnswer: 'the correct one',
    acceptedVariants: [],
    autoMark: 'correct',
    overrideMark: null,
    effectiveMark: 'correct',
    ...overrides,
  }
}

/**
 * The recomputed AutoGradeView the overrides/read endpoints return. Typed with the
 * NEW releasedProjection field (seam #4) so the fixture stays type-clean; the
 * generated `AutoGradeView` lacks it, so ASSERTIONS that read `view.autoGrade.releasedProjection`
 * are the intended compile-red.
 */
type AutoGradeViewFixture = AutoGradeView & {
  releasedProjection: { rawScore: number; band: number }
}

/** Objective grading view. Defaults: 3 answers, 1 wrong, no unresolved needs_review. */
function objectiveGradingView(
  autoGradeOverrides: Partial<AutoGradeViewFixture> = {},
  viewOverrides: Partial<TeacherGradingView> = {},
): TeacherGradingView {
  const autoGrade: AutoGradeViewFixture = {
    rawScore: 2,
    maxScore: 3,
    percentage: 66.7,
    provisionalBand: 5.5,
    released: false,
    releasedProjection: { rawScore: 2, band: 5.5 },
    answers: [
      answer({
        questionRef: '0:0:0',
        questionText: 'Q1 — the forest is old',
        studentAnswer: 'true',
        correctAnswer: 'true',
        autoMark: 'correct',
        effectiveMark: 'correct',
      }),
      answer({
        questionRef: '0:0:1',
        questionText: 'Q2 — it rains daily',
        studentAnswer: 'false',
        correctAnswer: 'true',
        autoMark: 'wrong',
        effectiveMark: 'wrong',
      }),
      answer({
        questionRef: '1:0:0',
        questionText: 'Q3 — the tide is ____',
        studentAnswer: 'hihg',
        correctAnswer: 'high',
        acceptedVariants: ['high tide'],
        autoMark: 'correct',
        effectiveMark: 'correct',
      }),
    ],
    ...autoGradeOverrides,
  }

  return {
    submission: {
      id: SUBMISSION_ID,
      centerId: 'c-1',
      assignmentId: ASSIGNMENT_ID,
      studentId: 'stu-1',
      status: 'submitted',
      isLate: false,
      appliedPenalty: 0,
      startedAt: '2026-08-20T00:00:00Z',
      submittedAt: '2026-08-20T12:00:00Z',
      timeBudgetSeconds: null,
      schemaVersion: 1,
      content: { schemaVersion: 1, answers: {}, flagged: [] } as never,
      createdAt: '2026-08-20T00:00:00Z',
      updatedAt: '2026-08-20T12:00:00Z',
    },
    assignment: {
      id: ASSIGNMENT_ID,
      exerciseId: 'ex-1',
      classId: CLASS_ID,
      status: 'open',
      deadlineAt: '2026-08-27T00:00:00Z',
      hardDeadlineAt: null,
      instructions: null,
      latePenalty: 0,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    },
    student: { id: 'stu-1', fullName: 'Binh Tran' },
    exercise: objectiveExercise(),
    grade: null,
    aiSuggestion: null,
    aiSpeakingSuggestion: null,
    audioUrl: null,
    audioStatus: 'none',
    autoGrade: autoGrade as AutoGradeView,
    ...viewOverrides,
  } as TeacherGradingView
}

/** A view with one unresolved needs_review (free-text near-miss) — the D9 headline risk. */
function needsReviewView(): TeacherGradingView {
  return objectiveGradingView({
    rawScore: 2,
    maxScore: 3,
    percentage: 100,
    provisionalBand: 6.5,
    // At release the unresolved needs_review counts WRONG over the full denominator →
    // released band drops BELOW the provisional band (D9). The dialog reads these verbatim.
    releasedProjection: { rawScore: 2, band: 5.0 },
    answers: [
      answer({ questionRef: '0:0:0', questionText: 'Q1 — the forest is old', autoMark: 'correct', effectiveMark: 'correct' }),
      answer({ questionRef: '0:0:1', questionText: 'Q2 — it rains daily', autoMark: 'correct', effectiveMark: 'correct' }),
      answer({
        questionRef: '1:0:0',
        questionText: 'Q3 — the tide is ____',
        studentAnswer: 'hihg',
        correctAnswer: 'high',
        acceptedVariants: ['high tide'],
        autoMark: 'needs_review',
        overrideMark: null,
        effectiveMark: 'needs_review',
      }),
    ],
  })
}

/** A fully-released view — read-only (AC12). */
function releasedView(): TeacherGradingView {
  return objectiveGradingView({
    released: true,
    rawScore: 2,
    maxScore: 3,
    provisionalBand: 5.5,
    releasedProjection: { rawScore: 2, band: 5.5 },
  })
}

// ---------------------------------------------------------------------------
// Render helpers — mirror SpeakingGradingPage.test.tsx.
// ---------------------------------------------------------------------------

function seedSession(qc: ReturnType<typeof createTestQueryClient>, role: Session['role'] = 'owner') {
  const session = {
    user: { id: 'owner-1', fullName: 'Teacher', email: 't@example.com' },
    role,
    centerId: 'c-1',
    emailVerified: true,
  } as unknown as Session
  qc.setQueryData(authKeys.session(), session)
  // RouteRoleGate's useRole() subscribes to the module-singleton queryClient, not the
  // provider client — seed both (mirrors SpeakingGradingPage.test).
  singletonQueryClient.setQueryData(authKeys.session(), session)
}

/** Render the GradingRoute dispatcher behind the staff role gate at the real route path. */
function renderDispatch(view: TeacherGradingView, role: Session['role'] = 'owner') {
  const qc = createTestQueryClient()
  seedSession(qc, role)
  server.use(http.get(GRADING_PATH, () => HttpResponse.json({ data: view })))
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
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
              <Route path="/classes/:id/grading/:aid/:sid" element={<GradingRoute />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

/** Render ObjectiveGradingPage directly (the page re-runs the grading read; cache dedups). */
function renderPage(view?: TeacherGradingView) {
  const qc = createTestQueryClient()
  seedSession(qc)
  if (view) server.use(http.get(GRADING_PATH, () => HttpResponse.json({ data: view })))
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/classes/${CLASS_ID}/grading/${ASSIGNMENT_ID}/${SUBMISSION_ID}`]}>
          <Routes>
            <Route path="/classes/:id/grading/:aid/:sid" element={<ObjectiveGradingPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  singletonQueryClient.clear()
})

// A stable way to read the "After overrides" score cell text. The page renders the
// server-provided rawScore/maxScore verbatim into a labelled region (no client math).
async function afterOverridesRegion() {
  return screen.findByTestId('objective-after-overrides')
}

// ===========================================================================
// AC1 — GradingRoute dispatch by autoGrade presence (objective branch inserted
// BEFORE the skill check).
// ===========================================================================
describe('GradingRoute — objective dispatch (AC1)', () => {
  test('[P0] AC1 dispatch — autoGrade != null renders ObjectiveGradingPage, not the unsupported dead-end', async () => {
    renderDispatch(objectiveGradingView())
    // The objective summary band renders (server rawScore/maxScore).
    expect(await screen.findByTestId('objective-summary')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('grading.error.unsupportedSkill'))).not.toBeInTheDocument()
  })

  test('[P1] AC1 regression — a WRITING view (autoGrade null) still dispatches to WritingGradingPage', async () => {
    const view = objectiveGradingView(
      {},
      {
        exercise: { id: 'ex-1', title: 'Essay 1', skill: 'writing', sections: [], settings: {} as never },
        autoGrade: null,
      },
    )
    renderDispatch(view)
    // Objective surface must NOT render for a writing payload.
    await waitFor(() => expect(screen.queryByTestId('grading-dispatch-skeleton')).not.toBeInTheDocument())
    expect(screen.queryByTestId('objective-summary')).not.toBeInTheDocument()
  })

  test('[P1] AC1 regression — a SPEAKING view (autoGrade null) still dispatches to SpeakingGradingPage', async () => {
    const view = objectiveGradingView(
      {},
      {
        exercise: { id: 'ex-1', title: 'Speaking 1', skill: 'speaking', sections: [], settings: {} as never },
        autoGrade: null,
      },
    )
    renderDispatch(view)
    await waitFor(() => expect(screen.queryByTestId('grading-dispatch-skeleton')).not.toBeInTheDocument())
    expect(screen.queryByTestId('objective-summary')).not.toBeInTheDocument()
  })

  test('[P1] AC1 unsupported — no autoGrade + a non-objective/non-writing/speaking skill → grading.error.unsupportedSkill', async () => {
    const view = objectiveGradingView(
      {},
      {
        exercise: { id: 'ex-1', title: 'General 1', skill: 'general', sections: [], settings: {} as never },
        autoGrade: null,
      },
    )
    renderDispatch(view)
    expect(await screen.findByText(i18n.t('grading.error.unsupportedSkill'))).toBeInTheDocument()
    expect(screen.queryByTestId('objective-summary')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// AC16 — objective skill with autoGrade == null → autoGradeUnavailable (NOT unsupportedSkill).
// ===========================================================================
describe('GradingRoute — AC16 autoGradeUnavailable fall-through', () => {
  test.each(['en', 'vi'] as const)(
    '[P0] AC16 — reading skill + autoGrade null shows objectiveGrading.autoGradeUnavailable + retry, NOT unsupportedSkill [%s]',
    async (lng) => {
      await i18n.changeLanguage(lng)
      const view = objectiveGradingView(
        {},
        {
          exercise: { id: 'ex-1', title: 'Reading 1', skill: 'reading', sections: [], settings: {} as never },
          autoGrade: null,
        },
      )
      renderDispatch(view)
      expect(await screen.findByText(i18n.t('objectiveGrading.autoGradeUnavailable.title'))).toBeInTheDocument()
      expect(screen.getByRole('button', { name: i18n.t('objectiveGrading.autoGradeUnavailable.retry') })).toBeInTheDocument()
      // NEGATIVE — the generic unsupported-skill copy must NOT appear.
      expect(screen.queryByText(i18n.t('grading.error.unsupportedSkill'))).not.toBeInTheDocument()
      await i18n.changeLanguage('en')
    },
  )
})

// ===========================================================================
// AC2 — L / E / E trilogy.
// ===========================================================================
describe('ObjectiveGradingPage — loading/error/desktop trilogy (AC2)', () => {
  test('[P1] AC2 loading — a role="status" skeleton renders while the grading read is in flight', async () => {
    const qc = createTestQueryClient()
    seedSession(qc)
    server.use(
      http.get(GRADING_PATH, async () => {
        await delay(50)
        return HttpResponse.json({ data: objectiveGradingView() })
      }),
    )
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[`/classes/${CLASS_ID}/grading/${ASSIGNMENT_ID}/${SUBMISSION_ID}`]}>
            <Routes>
              <Route path="/classes/:id/grading/:aid/:sid" element={<ObjectiveGradingPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  test('[P1] AC2 error — a 500 renders role="alert" + a retry control', async () => {
    const qc = createTestQueryClient()
    seedSession(qc)
    server.use(http.get(GRADING_PATH, () => new HttpResponse(null, { status: 500 })))
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[`/classes/${CLASS_ID}/grading/${ASSIGNMENT_ID}/${SUBMISSION_ID}`]}>
            <Routes>
              <Route path="/classes/:id/grading/:aid/:sid" element={<ObjectiveGradingPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('grading.error.retry') })).toBeInTheDocument()
  })

  test('[P1] AC2 desktop-only — a non-desktop viewport shows the mobile seam (grading.mobileSeam.*)', async () => {
    // Force the mobile tree: min-width queries no longer match (vitest-setup defaults desktop).
    vi.stubGlobal(
      'matchMedia',
      ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof globalThis.matchMedia,
    )
    renderPage(objectiveGradingView())
    expect(await screen.findByText(i18n.t('grading.mobileSeam.title'))).toBeInTheDocument()
    // The grading surface itself is withheld on mobile.
    expect(screen.queryByTestId('objective-summary')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// AC3 — summary band renders server numbers (no client math).
// ===========================================================================
describe('ObjectiveGradingPage — summary band (AC3)', () => {
  test('[P1] AC3 — renders server rawScore/maxScore, provisionalBand, and the After-overrides score verbatim', async () => {
    const view = objectiveGradingView({ rawScore: 2, maxScore: 3, provisionalBand: 5.5 })
    renderPage(view)
    const summary = await screen.findByTestId('objective-summary')
    // rawScore / maxScore straight from the fixture — the UI never recomputes.
    expect(within(summary).getByText(/\b2\b/)).toBeInTheDocument()
    expect(within(summary).getByText(/\b3\b/)).toBeInTheDocument()
    expect(within(summary).getByText(new RegExp(String(5.5)))).toBeInTheDocument()
    const after = await afterOverridesRegion()
    // After-overrides mirrors the current (provisional) rawScore before any override.
    expect(after).toHaveTextContent('2')
  })
})

// ===========================================================================
// AC4 — needs_review reckoning note + resolve nudge.
// ===========================================================================
describe('ObjectiveGradingPage — needs_review reckoning (AC4)', () => {
  test.each(['en', 'vi'] as const)(
    '[P0] AC4 — an unresolved needs_review renders the provisional band, the "counts as wrong at release" note, and the jump-to-first nudge [%s]',
    async (lng) => {
      await i18n.changeLanguage(lng)
      renderPage(needsReviewView())
      const summary = await screen.findByTestId('objective-summary')
      // (a) provisional band still renders.
      expect(within(summary).getByText(new RegExp(String(6.5)))).toBeInTheDocument()
      // (b) the reckoning note resolves (count-interpolated) — releasing counts unresolved as wrong.
      expect(screen.getByText(i18n.t('objectiveGrading.summary.needsReviewNote', { count: 1 }))).toBeInTheDocument()
      // (c) the resolve nudge with a jump-to-first affordance.
      expect(
        screen.getByRole('button', { name: i18n.t('objectiveGrading.summary.resolveNudge', { count: 1 }) }),
      ).toBeInTheDocument()
      await i18n.changeLanguage('en')
    },
  )
})

// ===========================================================================
// AC5 — answer row.
// ===========================================================================
describe('ObjectiveGradingPage — answer row (AC5)', () => {
  test('[P1] AC5 — a WRONG row shows q text, studentAnswer, correctAnswer, a mark chip, and override buttons', async () => {
    renderPage(objectiveGradingView())
    const wrongRow = await screen.findByTestId('objective-row-0:0:1')
    expect(within(wrongRow).getByText('Q2 — it rains daily')).toBeInTheDocument()
    expect(within(wrongRow).getByText('false')).toBeInTheDocument() // studentAnswer
    expect(within(wrongRow).getByText('true')).toBeInTheDocument() // correctAnswer revealed on wrong
    // The result chip is driven by effectiveMark.
    expect(within(wrongRow).getByText(i18n.t('objectiveGrading.mark.wrong'))).toBeInTheDocument()
    expect(within(wrongRow).getByRole('button', { name: i18n.t('objectiveGrading.row.acceptCorrect') })).toBeInTheDocument()
    expect(within(wrongRow).getByRole('button', { name: i18n.t('objectiveGrading.row.markWrong') })).toBeInTheDocument()
  })

  test('[P1] AC5 — a CORRECT row hides the correctAnswer reveal (only shown on wrong/needs_review)', async () => {
    renderPage(objectiveGradingView())
    const correctRow = await screen.findByTestId('objective-row-0:0:0')
    expect(within(correctRow).getByText(i18n.t('objectiveGrading.mark.correct'))).toBeInTheDocument()
    // correctAnswer label not surfaced on a correct row.
    expect(within(correctRow).queryByText(i18n.t('objectiveGrading.row.correctAnswer'))).not.toBeInTheDocument()
  })

  test('[P1] AC5 — studentFlagged + the "edited" affordance (D10) render when set', async () => {
    const view = objectiveGradingView({
      answers: [
        answer({
          questionRef: '0:0:0',
          questionText: 'Q1 — the forest is old',
          studentFlagged: true,
          autoMark: 'wrong',
          overrideMark: 'correct', // teacher overrode → "edited" affordance
          effectiveMark: 'correct',
        }),
        answer({ questionRef: '0:0:1', questionText: 'Q2 — it rains daily', autoMark: 'correct', effectiveMark: 'correct' }),
        answer({ questionRef: '1:0:0', questionText: 'Q3 — the tide is ____', autoMark: 'correct', effectiveMark: 'correct' }),
      ],
    })
    renderPage(view)
    const row = await screen.findByTestId('objective-row-0:0:0')
    expect(within(row).getByText(i18n.t('objectiveGrading.row.studentFlagged'))).toBeInTheDocument()
    expect(within(row).getByText(i18n.t('objectiveGrading.row.edited'))).toBeInTheDocument()
  })
})

// ===========================================================================
// AC6 — needs_review resolution row (teacher view only).
// ===========================================================================
describe('ObjectiveGradingPage — needs_review resolution row (AC6)', () => {
  test('[P1] AC6 — a flagged row shows studentAnswer + correctAnswer/acceptedVariants side by side with Accept/Mark-wrong', async () => {
    renderPage(needsReviewView())
    const row = await screen.findByTestId('objective-row-1:0:0')
    expect(within(row).getByText('hihg')).toBeInTheDocument() // studentAnswer
    expect(within(row).getByText('high')).toBeInTheDocument() // correctAnswer
    expect(within(row).getByText('high tide')).toBeInTheDocument() // acceptedVariant
    expect(within(row).getByRole('button', { name: i18n.t('objectiveGrading.row.acceptCorrect') })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: i18n.t('objectiveGrading.row.markWrong') })).toBeInTheDocument()
    expect(within(row).getByText(i18n.t('objectiveGrading.mark.needsReview'))).toBeInTheDocument()
  })

  test('[P1] AC6 NEGATIVE — no student-facing surface leaks into the teacher view', async () => {
    renderPage(needsReviewView())
    await screen.findByTestId('objective-row-1:0:0')
    // Teacher-only page: no student result heading / self-review controls.
    expect(screen.queryByTestId('student-result')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /flag for review/i })).not.toBeInTheDocument()
  })
})

// ===========================================================================
// AC7 — rows render in flattenQuestions(exercise) document order.
// ===========================================================================
describe('ObjectiveGradingPage — row order (AC7)', () => {
  test('[P1] AC7 — rows follow exercise document order even when autoGrade.answers array order differs', async () => {
    // answers array deliberately SCRAMBLED (1:0:0, 0:0:1, 0:0:0). The page must key by
    // colon questionRef and render in document order 0:0:0 → 0:0:1 → 1:0:0.
    const view = objectiveGradingView({
      answers: [
        answer({ questionRef: '1:0:0', questionText: 'Q3 — the tide is ____', autoMark: 'correct', effectiveMark: 'correct' }),
        answer({ questionRef: '0:0:1', questionText: 'Q2 — it rains daily', autoMark: 'wrong', effectiveMark: 'wrong' }),
        answer({ questionRef: '0:0:0', questionText: 'Q1 — the forest is old', autoMark: 'correct', effectiveMark: 'correct' }),
      ],
    })
    renderPage(view)
    await screen.findByTestId('objective-row-0:0:0')
    const rows = screen.getAllByTestId(/^objective-row-/)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'objective-row-0:0:0',
      'objective-row-0:0:1',
      'objective-row-1:0:0',
    ])
  })
})

// ===========================================================================
// AC8 — override seed-vs-refetch + in-flight disable.
// ===========================================================================
describe('ObjectiveGradingPage — override optimistic seed (AC8)', () => {
  test('[P1] AC8 — the recomputed AutoGradeView seeds the cache so After-overrides updates BEFORE the invalidation refetch resolves', async () => {
    const user = userEvent.setup()
    // Recomputed view after accepting the wrong Q2 as correct → rawScore 3/3, band 6.5.
    const recomputed: AutoGradeViewFixture = {
      rawScore: 3,
      maxScore: 3,
      percentage: 100,
      provisionalBand: 6.5,
      released: false,
      releasedProjection: { rawScore: 3, band: 6.5 },
      answers: [
        answer({ questionRef: '0:0:0', questionText: 'Q1 — the forest is old', autoMark: 'correct', effectiveMark: 'correct' }),
        answer({
          questionRef: '0:0:1',
          questionText: 'Q2 — it rains daily',
          autoMark: 'wrong',
          overrideMark: 'correct',
          effectiveMark: 'correct',
        }),
        answer({ questionRef: '1:0:0', questionText: 'Q3 — the tide is ____', autoMark: 'correct', effectiveMark: 'correct' }),
      ],
    }
    let gradingReadCount = 0
    server.use(
      http.get(GRADING_PATH, async () => {
        gradingReadCount += 1
        if (gradingReadCount === 1) {
          return HttpResponse.json({ data: objectiveGradingView() })
        }
        // FLAKE PIN: the invalidation refetch returns the SAME recomputed view, but DELAYED,
        // so a green After-overrides can ONLY have come from the mutation seed.
        await delay(300)
        return HttpResponse.json({ data: objectiveGradingView(recomputed) })
      }),
      // FLAKE PIN: the override endpoint returns the SAME recomputed breakdown as the refetch.
      http.post(OVERRIDE_PATH, () => HttpResponse.json({ data: recomputed, meta: {} })),
    )
    renderPage()
    const wrongRow = await screen.findByTestId('objective-row-0:0:1')
    await user.click(within(wrongRow).getByRole('button', { name: i18n.t('objectiveGrading.row.acceptCorrect') }))
    // Seed renders the recomputed After-overrides (3) before the 300ms refetch resolves.
    const after = await afterOverridesRegion()
    await waitFor(() => expect(after).toHaveTextContent('3'))
  })

  test('[P1] AC8 — during the override round-trip the clicked row buttons are disabled', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(GRADING_PATH, () => HttpResponse.json({ data: objectiveGradingView() })),
      http.post(OVERRIDE_PATH, async () => {
        await delay(200)
        return HttpResponse.json({ data: objectiveGradingView().autoGrade, meta: {} })
      }),
    )
    renderPage()
    const wrongRow = await screen.findByTestId('objective-row-0:0:1')
    const acceptBtn = within(wrongRow).getByRole('button', { name: i18n.t('objectiveGrading.row.acceptCorrect') })
    await user.click(acceptBtn)
    await waitFor(() => expect(acceptBtn).toBeDisabled())
    expect(within(wrongRow).getByRole('button', { name: i18n.t('objectiveGrading.row.markWrong') })).toBeDisabled()
  })
})

// ===========================================================================
// AC9 — cache integrity after a failed override.
// ===========================================================================
describe('ObjectiveGradingPage — cache integrity on failed override (AC9)', () => {
  test('[P0] AC9 — a failed override (422) leaves the prior autoGrade standing; no dangling write; breakdown uncorrupted', async () => {
    const user = userEvent.setup()
    const errorSpy = vi.spyOn(toast, 'error')
    server.use(
      http.get(GRADING_PATH, () => HttpResponse.json({ data: objectiveGradingView() })),
      http.post(OVERRIDE_PATH, () =>
        HttpResponse.json({ error: { code: 'INVALID_QUESTION_REF', message: 'bad ref' } }, { status: 422 }),
      ),
    )
    renderPage()
    const wrongRow = await screen.findByTestId('objective-row-0:0:1')
    const after = await afterOverridesRegion()
    expect(after).toHaveTextContent('2') // pre-override
    await user.click(within(wrongRow).getByRole('button', { name: i18n.t('objectiveGrading.row.acceptCorrect') }))
    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(i18n.t('objectiveGrading.error.invalidQuestionRef')),
    )
    // The prior breakdown is intact — the wrong mark still stands, the score unchanged.
    expect(within(wrongRow).getByText(i18n.t('objectiveGrading.mark.wrong'))).toBeInTheDocument()
    expect(after).toHaveTextContent('2')
  })
})

// ===========================================================================
// AC9 / AC11 — the six distinct error codes (discriminate on error.code, not status).
// ===========================================================================
describe('ObjectiveGradingPage — override + release error codes (AC9/AC11)', () => {
  const OVERRIDE_CASES: Array<{ name: string; status: number; code: string; key: string }> = [
    { name: '409 SUBMISSION_ALREADY_RELEASED', status: 409, code: 'SUBMISSION_ALREADY_RELEASED', key: 'objectiveGrading.error.alreadyReleased' },
    { name: '409 SUBMISSION_NOT_OBJECTIVE', status: 409, code: 'SUBMISSION_NOT_OBJECTIVE', key: 'objectiveGrading.error.notObjective' },
    { name: '409 AUTO_GRADE_NOT_FOUND', status: 409, code: 'AUTO_GRADE_NOT_FOUND', key: 'objectiveGrading.error.autoGradeNotFound' },
    { name: '422 INVALID_QUESTION_REF', status: 422, code: 'INVALID_QUESTION_REF', key: 'objectiveGrading.error.invalidQuestionRef' },
    { name: '404 SUBMISSION_NOT_FOUND', status: 404, code: 'SUBMISSION_NOT_FOUND', key: 'objectiveGrading.error.submissionNotFound' },
  ]

  test.each(OVERRIDE_CASES)(
    '[P1] AC11 override $name → its DISTINCT i18n toast (not a generic fallback), cache uncorrupted',
    async ({ status, code, key }) => {
      const user = userEvent.setup()
      const errorSpy = vi.spyOn(toast, 'error')
      server.use(
        http.get(GRADING_PATH, () => HttpResponse.json({ data: objectiveGradingView() })),
        http.post(OVERRIDE_PATH, () => HttpResponse.json({ error: { code, message: code } }, { status })),
      )
      renderPage()
      const wrongRow = await screen.findByTestId('objective-row-0:0:1')
      await user.click(within(wrongRow).getByRole('button', { name: i18n.t('objectiveGrading.row.acceptCorrect') }))
      await waitFor(() => expect(errorSpy).toHaveBeenCalledWith(i18n.t(key)))
      // The three 409s share a status but resolve to DISTINCT messages — never the generic.
      expect(errorSpy).not.toHaveBeenCalledWith(i18n.t('grading.error.generic'))
      // Breakdown uncorrupted — the wrong mark still stands.
      expect(within(wrongRow).getByText(i18n.t('objectiveGrading.mark.wrong'))).toBeInTheDocument()
    },
  )

  test('[P1] AC11 release 409 trio → the distinct alreadyReleased toast (release path, not override)', async () => {
    const user = userEvent.setup()
    const errorSpy = vi.spyOn(toast, 'error')
    server.use(
      http.get(GRADING_PATH, () => HttpResponse.json({ data: objectiveGradingView() })),
      http.post(RELEASE_PATH, () =>
        HttpResponse.json({ error: { code: 'SUBMISSION_ALREADY_RELEASED', message: 'x' } }, { status: 409 }),
      ),
    )
    renderPage()
    await user.click(await screen.findByRole('button', { name: i18n.t('objectiveGrading.release.cta') }))
    // Confirm the reckoning dialog.
    await user.click(await screen.findByRole('button', { name: i18n.t('grading.release.confirm') }))
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith(i18n.t('objectiveGrading.error.alreadyReleased')))
    expect(errorSpy).not.toHaveBeenCalledWith(i18n.t('grading.error.generic'))
  })
})

// ===========================================================================
// AC10 — release reckoning dialog (provisional → releasedProjection, released number LAST).
// ===========================================================================
describe('ObjectiveGradingPage — release reckoning dialog (AC10)', () => {
  test('[P1] AC10 — with unresolved needs_review the dialog shows the flagged count + the provisional→released delta, released LAST; confirm releases + remounts read-only', async () => {
    const user = userEvent.setup()
    const view = needsReviewView()
    let released = false
    server.use(
      http.get(GRADING_PATH, () => HttpResponse.json({ data: released ? { ...view, autoGrade: { ...view.autoGrade, released: true } } : view })),
      http.post(RELEASE_PATH, () => {
        released = true
        return HttpResponse.json({
          data: {
            id: 'g-1',
            submissionId: SUBMISSION_ID,
            version: 1,
            criterionScores: {} as never,
            overallBand: 5.0,
            comments: [],
            feedback: null,
            gradedBy: 'owner-1',
            releasedAt: '2026-08-27T00:00:00Z',
            createdAt: '2026-08-27T00:00:00Z',
          },
          meta: {},
        })
      }),
    )
    const successSpy = vi.spyOn(toast, 'success')
    renderPage()
    await user.click(await screen.findByRole('button', { name: i18n.t('objectiveGrading.release.cta') }))
    const dialog = await screen.findByRole('dialog')
    // The dialog reads releasedProjection VERBATIM (seam #4 — intended compile-red on the
    // generated AutoGradeView which lacks releasedProjection).
    const projection = view.autoGrade!.releasedProjection
    expect(within(dialog).getByText(i18n.t('objectiveGrading.release.reckoning', { count: 1 }))).toBeInTheDocument()
    // The projected released band (5.0, dropped BELOW the provisional 6.5 — D9) is shown,
    // and appears AFTER the provisional band in the delta line.
    const delta = within(dialog).getByTestId('objective-release-projection')
    expect(delta).toHaveTextContent(String(view.autoGrade!.provisionalBand))
    expect(delta).toHaveTextContent(String(projection.band))
    const provIdx = delta.textContent!.indexOf(String(view.autoGrade!.provisionalBand))
    const relIdx = delta.textContent!.lastIndexOf(String(projection.band))
    expect(relIdx).toBeGreaterThan(provIdx)

    await user.click(within(dialog).getByRole('button', { name: i18n.t('grading.release.confirm') }))
    await waitFor(() => expect(successSpy).toHaveBeenCalledWith(i18n.t('grading.release.success')))
    // FLAKE PIN: assert the POST-remount read-only tree via findBy (never the pre-remount tree).
    expect(await screen.findByTestId('objective-released-badge')).toBeInTheDocument()
  })
})

// ===========================================================================
// AC12 — post-release read-only.
// ===========================================================================
describe('ObjectiveGradingPage — post-release read-only (AC12)', () => {
  test('[P1] AC12 — a released view hides override buttons + the release CTA and shows the definitive band', async () => {
    renderPage(releasedView())
    expect(await screen.findByTestId('objective-released-badge')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: i18n.t('objectiveGrading.row.acceptCorrect') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: i18n.t('objectiveGrading.row.markWrong') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: i18n.t('objectiveGrading.release.cta') })).not.toBeInTheDocument()
  })

  test('[P1] AC12 regression — re-rendering a released view stays read-only', async () => {
    const { rerender } = renderPage(releasedView())
    await screen.findByTestId('objective-released-badge')
    rerender(
      <QueryClientProvider client={createTestQueryClient()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[`/classes/${CLASS_ID}/grading/${ASSIGNMENT_ID}/${SUBMISSION_ID}`]}>
            <Routes>
              <Route path="/classes/:id/grading/:aid/:sid" element={<ObjectiveGradingPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('button', { name: i18n.t('objectiveGrading.row.acceptCorrect') })).not.toBeInTheDocument()
  })
})

// ===========================================================================
// AC14 — role gate + a11y.
// ===========================================================================
describe('ObjectiveGradingPage — role gate + a11y (AC14)', () => {
  test('[P1] AC14 role-absent — a student cannot reach the objective grading route (staff-gated)', async () => {
    renderDispatch(objectiveGradingView(), 'student')
    // The staff gate denies before the objective surface mounts.
    expect(await screen.findByTestId('permission-denied-section-header')).toBeInTheDocument()
    expect(screen.queryByTestId('objective-summary')).not.toBeInTheDocument()
  })

  test('[P1] AC14 a11y — the loaded objective page has no axe violations', async () => {
    const { container } = renderPage(objectiveGradingView())
    await screen.findByTestId('objective-summary')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('[P1] AC8-seam — the override + release hooks exist and are functions (green-phase seam guard)', () => {
    expect(typeof useOverrideAutoGradeAnswer).toBe('function')
    expect(typeof useReleaseAutoGrade).toBe('function')
  })
})

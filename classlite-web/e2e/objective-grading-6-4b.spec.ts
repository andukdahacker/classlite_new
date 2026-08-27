/**
 * Story 6.4b (AC17b) — Objective auto-grading teacher flow, mocked-API E2E leg.
 *
 * This is the UI-DRIVES-THE-FLOW proof. It asserts the teacher's objective grading
 * screen renders the breakdown, drives overrides, shows the release reckoning, and locks
 * to read-only after the composite-key remount. It does NOT prove immutability through
 * real infra — that is the Go integration leg (auto_grade_e2e_6_4b_atdd_test.go, AC17a),
 * which round-trips a real submit hook + release + the P0001→409 immutability trigger.
 *
 * HARNESS (per e2e/route-role-gate.spec.ts + e2e/dashboard-first-run.spec.ts): the API is
 * MOCKED with `page.route('**\/api/...')`. Real login is deferred (Story 1.5) and there is
 * NO backend seed/reset endpoint (`/api/__test/seed` is a documented no-op), so every
 * response the page needs is fulfilled here as a JSON envelope.
 *
 * Ships as `test.describe.skip()` — SAME infra precedent as e2e/route-role-gate.spec.ts and
 * e2e/dashboard-first-run.spec.ts (the FU-2-5-N session-cache seed gap + real login deferred
 * to Story 1.5). This route sits behind the staff `RouteRoleGate`, which reads the role from
 * the `['auth','session']` QueryClient slot; the mocked-API design-system harness has no way
 * to seed that slot (a stubbed /api/auth/refresh alone does not admit the gate — verified
 * 2026-08-27: the bodies below run but the gate withholds the grading surface). Building that
 * seed path is a separate infra investment this story places OUT OF SCOPE; the substantive
 * end-to-end proof lives in the Go integration leg (auto_grade_e2e_6_4b_atdd_test.go, AC17a)
 * and the reliable UI-behavior proof in the MSW component suite (ObjectiveGradingPage.test).
 *
 * The bodies are correct-by-construction (green-ready) so they un-skip cleanly when the
 * FU-2-5-N session-cache seed harness lands: the `/classes/{id}/grading/{aid}/{sid}` route
 * renders the objective page from GET .../grading; the After-overrides panel reads the
 * recomputed view from POST .../auto-grade/overrides; the reckoning dialog reads the
 * provisional→releasedProjection delta; Release remounts the subtree on the grade composite
 * key into a read-only state. The grading mock is STATEFUL where the flow mutates it so the
 * invalidation refetch agrees with the optimistic seed (no oscillation).
 */
import { expect, test, type Page, type Route } from '@playwright/test'

const CLASS_ID = 'class-e2e'
const ASSIGNMENT_ID = 'assignment-e2e'
const SUBMISSION_ID = 'submission-e2e'
const GRADING_URL = `/classes/${CLASS_ID}/grading/${ASSIGNMENT_ID}/${SUBMISSION_ID}`

function jsonEnvelope<T>(data: T, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: {} }),
  }
}

function errorEnvelope(code: string, status: number, message = code) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code, message }, meta: {} }),
  }
}

// One objective answer that is exact-correct + one unresolved needs_review — the same
// near-miss shape the Go leg drives end-to-end. Provisional excludes the needs_review
// (raw 1 / denom 1 = 100% → band 9.0); releasedProjection counts it wrong over the full
// denominator (raw 1 / max 2 = 50% → band 6.0).
function autoGradeView(overrides?: {
  released?: boolean
  answers?: Array<Record<string, unknown>>
  rawScore?: number
  provisionalBand?: number
}) {
  return {
    rawScore: overrides?.rawScore ?? 1,
    maxScore: 2,
    percentage: 100,
    provisionalBand: overrides?.provisionalBand ?? 9.0,
    released: overrides?.released ?? false,
    releasedProjection: { rawScore: 1, maxScore: 2, percentage: 50, band: 6.0 },
    answers: overrides?.answers ?? [
      {
        questionRef: '0:0:0',
        questionText: 'Who is quick?',
        studentAnswer: 'The fox',
        studentFlagged: false,
        correctAnswer: 'The fox',
        acceptedVariants: [],
        autoMark: 'correct',
        overrideMark: null,
        effectiveMark: 'correct',
      },
      {
        questionRef: '0:1:0',
        questionText: 'Spell the word',
        studentAnswer: 'nesessary',
        studentFlagged: false,
        correctAnswer: 'necessary',
        acceptedVariants: [],
        autoMark: 'needs_review',
        overrideMark: null,
        effectiveMark: 'needs_review',
      },
    ],
  }
}

// A teacher grading read envelope carrying the objective autoGrade block.
function teacherGradingView(auto: ReturnType<typeof autoGradeView>) {
  return {
    submission: { id: SUBMISSION_ID, status: auto.released ? 'graded' : 'submitted' },
    assignment: { id: ASSIGNMENT_ID, classId: CLASS_ID },
    student: { id: 'student-e2e', fullName: 'Mai' },
    exercise: { id: 'exercise-e2e', title: 'Reading Quiz', skill: 'reading' },
    grade: auto.released
      ? { id: 'grade-e2e', version: 1, overallBand: 6.0, releasedAt: '2026-08-27T00:00:00.000Z' }
      : null,
    aiSuggestion: null,
    aiSpeakingSuggestion: null,
    audioUrl: null,
    audioStatus: 'none',
    autoGrade: auto,
  }
}

// Boot-probe refresh so the layout guard admits the page (mirrors dashboard-first-run).
async function stubAuth(page: Page): Promise<void> {
  await page.route('**/api/auth/refresh', async (route: Route) => {
    await route.fulfill(
      jsonEnvelope({
        user: {
          id: 'user-1',
          email: 'owner@example.com',
          displayName: 'Trang',
          fullName: 'Trang',
          emailVerified: true,
        },
        accessToken: 'e2e.jwt.token',
        center: {
          id: 'center-e2e',
          name: 'E2E Center',
          shortCode: 'e2e-center',
          brandColor: 'indigo',
          logoUrl: null,
          timezone: 'Asia/Ho_Chi_Minh',
          role: 'owner',
        },
      }),
    )
  })
}

test.describe.skip('Story 6.4b — Objective grading teacher flow (mocked API · FU-2-5-N session-cache seed pending)', () => {
  test('summary band + per-answer breakdown render from the grading read', async ({
    page,
  }) => {
    await stubAuth(page)
    await page.route('**/api/submissions/*/grading', async (route: Route) => {
      await route.fulfill(jsonEnvelope(teacherGradingView(autoGradeView())))
    })

    await page.goto(GRADING_URL)

    // Provisional summary band + the needs_review answer are both visible.
    await expect(page.getByText(/9\.0/)).toBeVisible()
    await expect(page.getByText('nesessary')).toBeVisible()
    await expect(page.getByText(/needs review/i)).toBeVisible()
    await expect(page.getByText('necessary')).toBeVisible()
  })

  test('override recomputes the After-overrides panel + shows the edited affordance', async ({
    page,
  }) => {
    await stubAuth(page)
    // Override 0:1:0 → wrong: both answers resolved, raw 1 / max 2 = 50% → band 6.0.
    const recomputed = autoGradeView({
      rawScore: 1,
      provisionalBand: 6.0,
      answers: [
        {
          questionRef: '0:0:0',
          questionText: 'Who is quick?',
          studentAnswer: 'The fox',
          studentFlagged: false,
          correctAnswer: 'The fox',
          acceptedVariants: [],
          autoMark: 'correct',
          overrideMark: null,
          effectiveMark: 'correct',
        },
        {
          questionRef: '0:1:0',
          questionText: 'Spell the word',
          studentAnswer: 'nesessary',
          studentFlagged: false,
          correctAnswer: 'necessary',
          acceptedVariants: [],
          autoMark: 'needs_review',
          overrideMark: 'wrong',
          effectiveMark: 'wrong',
        },
      ],
    })
    // Stateful: after the override the grading read (invalidation refetch) returns the
    // recomputed view too, so the seeded After-overrides band never oscillates back.
    let overridden = false
    await page.route('**/api/submissions/*/grading', async (route: Route) => {
      await route.fulfill(jsonEnvelope(teacherGradingView(overridden ? recomputed : autoGradeView())))
    })
    await page.route('**/api/submissions/*/auto-grade/overrides', async (route: Route) => {
      overridden = true
      await route.fulfill(jsonEnvelope(recomputed))
    })

    await page.goto(GRADING_URL)
    await page
      .getByRole('button', { name: /mark wrong/i })
      .first()
      .click()

    // After-overrides band updates to the resolved 6.0 and the answer shows an edited badge.
    await expect(page.getByText(/6\.0/)).toBeVisible()
    await expect(page.getByText(/edited/i)).toBeVisible()
  })

  test('an override that races a release surfaces the distinct already-released toast', async ({
    page,
  }) => {
    await stubAuth(page)
    await page.route('**/api/submissions/*/grading', async (route: Route) => {
      await route.fulfill(jsonEnvelope(teacherGradingView(autoGradeView())))
    })
    await page.route('**/api/submissions/*/auto-grade/overrides', async (route: Route) => {
      await route.fulfill(errorEnvelope('SUBMISSION_ALREADY_RELEASED', 409))
    })

    await page.goto(GRADING_URL)
    await page
      .getByRole('button', { name: /mark wrong/i })
      .first()
      .click()

    // Distinct 409 copy — not the generic error toast.
    await expect(page.getByText(/already been released/i)).toBeVisible()
  })

  test('release confirms via the reckoning delta then remounts to read-only', async ({
    page,
  }) => {
    await stubAuth(page)
    // Stateful: after release the grading read returns the released view, so the
    // composite-key remount lands on the definitive read-only state.
    let released = false
    await page.route('**/api/submissions/*/grading', async (route: Route) => {
      await route.fulfill(jsonEnvelope(teacherGradingView(autoGradeView({ released }))))
    })
    await page.route('**/api/submissions/*/release', async (route: Route) => {
      released = true
      await route.fulfill(
        jsonEnvelope({
          id: 'grade-e2e',
          version: 1,
          overallBand: 6.0,
          releasedAt: '2026-08-27T00:00:00.000Z',
        }),
      )
    })

    await page.goto(GRADING_URL)
    await page.getByRole('button', { name: /^release/i }).click()

    // Reckoning dialog shows the provisional → releasedProjection delta (needs_review
    // unresolved will count wrong): 9.0 down to 6.0.
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/9\.0/)).toBeVisible()
    await expect(dialog.getByText(/6\.0/)).toBeVisible()
    await expect(dialog.getByText(/1 (answer|question).*needs review/i)).toBeVisible()

    await dialog.getByRole('button', { name: /confirm|release/i }).click()

    // FLAKE PIN: assert the POST-remount (grade composite-key) read-only tree, never the
    // pre-remount controls. The read-only markers must be visible; the override + release
    // CTAs must be gone.
    await expect(page.getByText(/released/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /^release/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /mark wrong/i })).toHaveCount(0)
  })
})

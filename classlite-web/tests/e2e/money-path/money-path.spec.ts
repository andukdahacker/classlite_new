/**
 * THE money-path smoke (Story 11-5a) — the first full-stack journey ever
 * exercised: owner/teacher login → OPEN the seeded active class → author +
 * assign one exercise per attempt type → student attempts all four → DETERMINISTIC
 * grade → student reads each result, against the REAL running API on :8080 (no
 * `page.route` mocking). Four months and 100+ stories, and not one test drove
 * real auth → RLS → submission lifecycle → grading → result read as one living
 * journey. This is it.
 *
 * TRUTH-IN-LABELING: this is the DETERMINISTIC money path. AI auto-grade
 * (`/ai-grade`, Gemini) is uncovered by design (Out of Scope → 11-4/11-5b); a
 * green run means "the deterministic plumbing is wired," NOT "the AI value claim
 * works." Class-create + enrollment is also uncovered (the smoke OPENS the
 * seeded class) → 11-5b.
 *
 * DRIVE MODES (AC1 hybrid, Ducdo rulings 2026-10-13):
 *   • Browser-driven (real UI): teacher opens the seeded class; the WHOLE student
 *     journey — all 4 attempts + the result render reads.
 *   • API-driven (authed Bearer): exercise authoring + content, assignment create
 *     (no teacher assign UI exists — FU-11-5A-ASSIGN-UI), teacher grade/release,
 *     owner billing. The student RESULT ORACLES also read the API via the
 *     student's OWN captured token (robust vs the 30s list staleTime).
 *
 * SINGLE-CONTEXT NAVIGATION RULE (AC2, MANDATORY — the #1 flake landmine): within
 * the student context there is EXACTLY ONE `page.goto` (the SPA boot); every later
 * hop is in-app client-side navigation (a `<Link>`/button click). A second
 * `page.goto` hits the `classlite_last_refreshed_at` debounce → guest shell.
 *
 * LOGIN BUDGET (AC5): 3 logins — teacher (shared browser+API via
 * `staffApiOverContext`), owner (API), student (browser). 3 × (1 + CI retry ×1)
 * = 6 < burst-8 (auth_handler.go:329).
 *
 * GREEN-PHASE SEAMS: see moneyPath.ts header (S1–S6) for the one list to
 * reconcile against a live seeded stack. This spec is a smoke over already-shipped
 * features; its only red is the compile red (TS2307) on the page-object import
 * (AC9) — there is no behavioral red to hunt.
 *
 * PRECONDITIONS (hard; the spec is meaningless without them): a running, SEEDED
 * API on :8080; COOKIE_DOMAIN=.classlite.localhost + APP_ENV=development on the
 * API; run at --workers=1; chromium launched with the fake-media flags (see
 * playwright.config.ts money-path project) so the speaking MediaRecorder captures
 * the committed .wav fixture deterministically headless.
 */
import { expect, test, type Page } from '@playwright/test'
import { guardNotProduction, loadCredentials, originOf } from '../lib/auth-harness'
import {
  EXPECTED_OBJECTIVE_BAND,
  EXPECTED_SPEAKING_BAND,
  EXPECTED_WRITING_BAND,
  MONEY_PATH_SKILLS,
  OBJECTIVE_KEY,
  SPEAKING_SCORES,
  WRITING_ESSAY,
  WRITING_SCORES,
  authedApi,
  createAssignment,
  createExerciseWithContent,
  freshAuthedContext,
  getAssignmentResult,
  gradeManual,
  installNoAiGradeGuard,
  isObjectiveSkill,
  objectiveContent,
  promptContent,
  releaseObjective,
  requireSeedIdentity,
  resolveActiveClassId,
  rowReviewCta,
  rowStartCta,
  staffApiOverContext,
  studentApiFromToken,
  waitForSubmissionId,
  type MoneyPathSkill,
} from './moneyPath'

const REFRESH_PATH = '/api/auth/refresh'

/** A deadline comfortably in the future so no attempt is late. */
const DEADLINE_AT = '2099-01-01T00:00:00.000Z'

/** Drive one objective (reading/listening) attempt to `submitted`: answer the known key, submit. */
async function driveObjectiveAttempt(page: Page): Promise<void> {
  await expect(page.getByTestId('attempt-shell')).toBeVisible()
  // MCQ: the known-correct option (handle 0:0:0). Correctness is the oracle (AC4).
  await page.getByTestId(`choice-${OBJECTIVE_KEY.mcqRef}-${OBJECTIVE_KEY.mcqCorrect}`).click()
  // Fill-in-blank (handle 0:1:0): the known-correct word.
  await page.getByTestId(`gap-input-${OBJECTIVE_KEY.gapRef}`).fill(OBJECTIVE_KEY.gapCorrect)
  // Open submit → confirm. The finalizer flushes the latest autosave first.
  await page.getByTestId('attempt-submit-open').click()
  await expect(page.getByTestId('submit-confirm-dialog')).toBeVisible()
  await page.getByTestId('submit-confirm').click()
  await expect(page.getByTestId('submission-confirmation')).toBeVisible()
}

/** Drive the writing attempt to `submitted`: type the essay, submit. */
async function driveWritingAttempt(page: Page): Promise<void> {
  const editor = page.getByTestId('writing-editor-leaf')
  await expect(editor).toBeVisible()
  await editor.fill(WRITING_ESSAY)
  // Let the debounced autosave flush so the submit finalizer carries the text.
  await expect(page.getByTestId('writing-word-count-value')).not.toHaveText('0')
  await page.getByTestId('writing-submit-open').click()
  await expect(page.getByTestId('writing-submit-dialog')).toBeVisible()
  await page.getByTestId('writing-submit-confirm').click()
  await expect(page.getByTestId('submission-confirmation')).toBeVisible()
}

/**
 * Drive the speaking attempt to `submitted` through the REAL R2 leg (presign→PUT
 * →confirm, via the dev mock-R2 sink). The chromium fake-media flags feed the
 * committed .wav so MediaRecorder captures deterministically headless (AC2 — a
 * real audio fixture, NOT the no-audio fallback).
 */
async function driveSpeakingAttempt(page: Page): Promise<void> {
  await expect(page.getByTestId('speaking-recorder-leaf')).toBeVisible()
  // Skip the prep countdown if it is showing, then record a short take.
  const prepSkip = page.getByTestId('speaking-prep-skip')
  if (await prepSkip.isVisible().catch(() => false)) {
    await prepSkip.click()
  }
  await page.getByTestId('speaking-record-button').click()
  await expect(page.getByTestId('speaking-stop-button')).toBeVisible()
  // Wait on a REAL readiness signal, not a blind sleep (code-review P8): the elapsed
  // timer ticks off the recorder's own 1s clock, so waiting for it to advance past its
  // first-rendered value proves ≥1s of genuine capture — a cold CI chromium whose
  // fake-audio pipeline lags can otherwise yield an empty blob under a fixed timeout.
  const elapsed = page.getByTestId('speaking-elapsed')
  const initialElapsed = (await elapsed.textContent()) ?? ''
  await expect(elapsed, 'MediaRecorder must have recorded ≥1s before stop').not.toHaveText(
    initialElapsed,
    { timeout: 10_000 },
  )
  await page.getByTestId('speaking-stop-button').click()
  await expect(page.getByTestId('speaking-preview')).toBeVisible()
  // The preview must carry a real captured take (object-URL src), not an empty blob.
  await expect(page.getByTestId('speaking-preview-audio')).toHaveAttribute('src', /.+/)
  await page.getByTestId('speaking-submit-open').click()
  await expect(page.getByTestId('speaking-submit-dialog')).toBeVisible()
  await page.getByTestId('speaking-submit-confirm').click()
  // The confirm fires presign→PUT→confirm→progress→submit; the confirmation
  // end-state proves the whole real-R2 leg round-tripped.
  await expect(page.getByTestId('submission-confirmation')).toBeVisible({ timeout: 30_000 })
}

async function driveAttempt(page: Page, skill: MoneyPathSkill): Promise<void> {
  if (isObjectiveSkill(skill)) return driveObjectiveAttempt(page)
  if (skill === 'writing') return driveWritingAttempt(page)
  return driveSpeakingAttempt(page)
}

test.describe.configure({ mode: 'serial' })

test('11-5a — deterministic money path: login → class → assign → 4 attempts → grade → result', async ({
  browser,
  playwright,
  baseURL,
}) => {
  test.slow() // the full journey (4 attempts incl. a real recording) is long.

  // AC5 (11-2 debt 3) — real logins may only aim at a dev/staging host
  // (localhost / *.classlite.localhost / *.classlite.app-staging). The real
  // deploy/staging host is confirmed against `ALLOWED_HOST_BASES`; coordinate
  // with 11-8a/11-8b if the staging hostname differs.
  guardNotProduction({ baseURL })

  const origin = originOf(baseURL)
  const creds = loadCredentials()
  const teacherCred = requireSeedIdentity(creds, 'teacher', (c) => !c.email.includes('teacher2'), 'owning teacher')
  const ownerCred = requireSeedIdentity(creds, 'owner')
  const studentCred = requireSeedIdentity(creds, 'student', (c) => c.email.includes('student1'), 'student1')

  // ---- Context 1: teacher — ONE login shared by the browser (open class) + API (authoring) ----
  const teacherContext = await browser.newContext({ baseURL })
  const teacherApi = await staffApiOverContext(teacherContext, baseURL, teacherCred)
  const classId = await resolveActiveClassId(teacherApi)

  // AC1 — the teacher OPENS the seeded active class browser-driven (proves staff
  // auth + RLS + the staff shell). The one goto for this context.
  const teacherPage = await teacherContext.newPage()
  // Watch the teacher context too (code-review P11): the no-/ai-grade oracle must cover
  // every browser page in the journey, not only the student's — a staff surface that
  // ever routed through /ai-grade would otherwise slip the gate.
  const noAiGuardTeacher = installNoAiGradeGuard(teacherPage)
  await teacherPage.goto(`/classes/${classId}`)
  await expect(teacherPage, 'staff boot must not bounce to /login').not.toHaveURL(/\/login/)
  await expect(teacherPage.getByTestId('class-detail-head')).toBeVisible()

  // AC1 — author one exercise per skill + assign it to the class (API).
  const assignmentIdBySkill: Record<MoneyPathSkill, string> = {} as Record<MoneyPathSkill, string>
  for (const skill of MONEY_PATH_SKILLS) {
    const content = isObjectiveSkill(skill)
      ? objectiveContent(skill)
      : promptContent(skill, skill === 'writing' ? 'Describe the chart in at least 150 words.' : 'Describe a memorable journey you have taken.')
    const exerciseId = await createExerciseWithContent(teacherApi, {
      title: `E2E money-path ${skill}`,
      skill,
      content,
    })
    assignmentIdBySkill[skill] = await createAssignment(teacherApi, { exerciseId, classId, deadlineAt: DEADLINE_AT })
  }

  // ---- Context 2: owner — API only (owner-only billing). Credit balance BEFORE. ----
  const ownerApi = await authedApi(playwright, baseURL, ownerCred)
  const creditsBefore = await ownerApi.request
    .get('/api/billing', { headers: { Authorization: `Bearer ${ownerApi.accessToken}`, ...(origin ? { Origin: origin } : {}) } })
    .then(async (r) => {
      expect(r.ok(), 'owner GET /api/billing must be 200').toBeTruthy()
      const body = (await r.json()) as { data: { usage: { aiCredits: { available: number } } } }
      const available = body.data.usage.aiCredits.available
      // Guard the oracle against a vacuous pass (code-review P7): if the billing shape
      // ever drifts so `available` is undefined, `undefined === undefined` would pass
      // while asserting nothing. Pin it to a real number first.
      expect(typeof available, 'billing aiCredits.available must be a number').toBe('number')
      return available
    })

  // ---- Context 3: student — ONE browser login + ONE page.goto (the SPA boot) ----
  const studentContext = await freshAuthedContext(browser, baseURL, studentCred)
  const studentPage = await studentContext.newPage()
  const noAiGuard = installNoAiGradeGuard(studentPage)

  // Capture the student's access token from the boot-refresh so the result
  // ORACLES can read GET /result as the student via the SAME login (no extra
  // login; robust against the 30s list staleTime that gates the UI review CTA).
  const bootRefresh = studentPage.waitForResponse(
    (r) => r.url().includes(REFRESH_PATH) && r.request().method() === 'POST',
  )
  await studentPage.goto('/assignments') // THE one goto.
  const studentBootAt = Date.now() // when the assignments-list cache was seeded (staleTime clock)
  expect((await bootRefresh).status(), 'student boot-refresh must be 200').toBe(200)
  await expect(studentPage, 'student boot must not bounce to /login').not.toHaveURL(/\/login/)
  const refreshBody = (await (await bootRefresh).json()) as { data: { accessToken: string } }
  const studentApi = studentApiFromToken(studentContext.request, refreshBody.data.accessToken, origin, studentCred.centerId)

  // ---- Per skill: attempt (browser) → 200-pending → grade (API) → released + correctness ----
  for (const skill of MONEY_PATH_SKILLS) {
    const assignmentId = assignmentIdBySkill[skill]

    // Start the attempt via the id-keyed row CTA (in-app nav). Capture the
    // submission id the SPA mints so the teacher can grade/release it.
    const submissionIdPromise = waitForSubmissionId(studentPage)
    await studentPage.getByTestId(rowStartCta(assignmentId)).click()
    const submissionId = await submissionIdPromise

    await driveAttempt(studentPage, skill)

    // AC4 — 200-pending BEFORE grading (never 404; released:false).
    const pending = await getAssignmentResult(studentApi, assignmentId)
    expect(pending.status, `${skill}: /result must be 200-pending, never 404`).toBe(200)
    expect(pending.released, `${skill}: must be unreleased before grading`).toBe(false)

    // AC3 — deterministic, Gemini-free grading.
    if (isObjectiveSkill(skill)) {
      await releaseObjective(teacherApi, submissionId) // 200
    } else {
      await gradeManual(teacherApi, submissionId, skill === 'writing' ? WRITING_SCORES : SPEAKING_SCORES) // 201, released in one call
    }

    // AC4 — released + the band is CORRECT (not merely non-null), via the student token.
    const released = await getAssignmentResult(studentApi, assignmentId)
    expect(released.status).toBe(200)
    expect(released.released, `${skill}: must be released after grading`).toBe(true)
    const expectedBand = isObjectiveSkill(skill)
      ? EXPECTED_OBJECTIVE_BAND
      : skill === 'writing'
        ? EXPECTED_WRITING_BAND
        : EXPECTED_SPEAKING_BAND
    expect(released.overallBand, `${skill}: computed band must match the expected value`).toBe(expectedBand)
    // AC4 — teacher identity (graded_by) absent from the student grade view (privacy D1).
    const gradeKeys = Object.keys(released.rawGrade ?? {})
    expect(gradeKeys, `${skill}: student grade view must not leak the grader identity`).not.toContain('gradedBy')
    expect(gradeKeys).not.toContain('graded_by')
    // Writing AND speaking: the manual criterionScores round-trip VERBATIM to the
    // student view. Story 11-5a AC4 (closes FU-11-5A-SPEAKING-GRADEVIEW): the student
    // result now passes the stored criterion_scores JSONB through skill-polymorphically
    // (mirroring the teacher read), so speaking's fluencyCoherence + pronunciation are
    // no longer dropped by a writing-only projection.
    if (skill === 'writing') {
      expect(released.criterionScores, 'writing: criterionScores must round-trip verbatim').toMatchObject(WRITING_SCORES)
    } else if (skill === 'speaking') {
      expect(released.criterionScores, 'speaking: criterionScores must round-trip verbatim').toMatchObject(SPEAKING_SCORES)
    }
    // Speaking proves the real-R2 leg produced a playable object (audioUrl present).
    if (skill === 'speaking') {
      expect(released.audioUrl, 'speaking result must carry a presigned audio URL').toBeTruthy()
    }

    // Return to the list (in-app) for the next attempt's Start CTA.
    await studentPage.getByTestId('done-back-to-assignments').click()
    await expect(studentPage).toHaveURL(/\/assignments$/)
  }

  // ---- AC4 — the student READS each released result in-app (the rendered grade view) ----
  // The student-assignments list has a 30s staleTime and is NOT invalidated on
  // submit (SEAM / minor product wart — FU-11-5A-ASSIGN-LIST-STALE). Its cache is
  // the boot snapshot (all notStarted) and `dataUpdatedAt` never advances (every
  // remount within staleTime serves cache), so the list becomes stale EXACTLY at
  // boot+30s — only THEN does a remount refetch. The journey can finish in <30s,
  // so first wait out the remaining staleTime (bounded; test.slow() covers it),
  // THEN a single in-app round-trip (dashboard → assignments) remounts /assignments
  // → refetch → every graded row exposes its review CTA, and that refreshed cache
  // carries through the per-review `review-back` remounts below. In-app nav only.
  const STALE_TIME_MS = 30_000
  const sinceBoot = Date.now() - studentBootAt
  if (sinceBoot < STALE_TIME_MS + 1_000) {
    await studentPage.waitForTimeout(STALE_TIME_MS + 1_000 - sinceBoot)
  }
  // Scope nav clicks to the primary sidebar (code-review P10): `.first()` on a bare
  // `a[href=…]` masks the real node count and silently re-breaks when a second matching
  // anchor appears. The primary-nav link is unique within its landmark.
  const sidebarNav = studentPage.getByTestId('sidebar-nav-primary')
  await sidebarNav.locator('a[href="/dashboard"]').click()
  await expect(studentPage).toHaveURL(/\/dashboard/)
  await sidebarNav.locator('a[href="/assignments"]').click()
  await expect(studentPage).toHaveURL(/\/assignments$/)
  for (const skill of MONEY_PATH_SKILLS) {
    const assignmentId = assignmentIdBySkill[skill]
    const reviewCta = studentPage.getByTestId(rowReviewCta(assignmentId))
    await expect(reviewCta, `${skill}: review CTA should appear once the list refetches`).toBeVisible({ timeout: 35_000 })
    await reviewCta.click()
    await expect(studentPage.getByTestId('submission-review-page')).toBeVisible()
    // The released-state render differs by skill (SubmissionReviewShell). Objective
    // (reading/listening) grade LAYOUTS remain a D6 follow-up (receipt only); writing
    // and speaking both render a band-block hero (Story 11-5a AC4 shipped speaking):
    if (isObjectiveSkill(skill)) {
      // reading/listening → the de-ticked correctness RECEIPT (no band block).
      await expect(
        studentPage.getByTestId('result-quiz-receipt'),
        `${skill}: objective result receipt must render`,
      ).toBeVisible()
    } else if (skill === 'writing') {
      // writing → the full band block + the graded essay read-back (GradedEssay
      // replaces the pre-grade ResultWritingReadback once released).
      await expect(studentPage.getByTestId('student-grade-block'), 'writing: band block must render').toBeVisible()
      await expect(studentPage.getByTestId('student-grade-band-value')).toBeVisible()
      await expect(studentPage.getByTestId('graded-essay'), 'writing: graded essay read-back must render').toBeVisible()
    } else {
      // speaking → the speaking band-block hero (Story 11-5a AC4 — the four speaking
      // criteria + band) ABOVE the audio playback read-back. No "coming soon" placeholder.
      await expect(
        studentPage.getByTestId('student-grade-block-speaking'),
        'speaking: band block must render',
      ).toBeVisible()
      await expect(studentPage.getByTestId('student-grade-band-value')).toBeVisible()
      await expect(
        studentPage.getByTestId('student-grade-coming-soon'),
        'speaking: the coming-soon placeholder must be gone',
      ).toHaveCount(0)
      await expect(
        studentPage.getByTestId('result-speaking-playback'),
        'speaking: audio playback must render',
      ).toBeVisible()
    }
    // Back to the list (in-app) for the next review.
    await studentPage.getByTestId('submission-review-back').click()
    await expect(studentPage).toHaveURL(/\/assignments$/)
  }

  // ---- AC3 — observable no-Gemini oracles ----
  noAiGuard.assertNoAiGrade() // no student-page request ever hit /ai-grade
  noAiGuardTeacher.assertNoAiGrade() // nor any teacher-page request (P11)
  const creditsAfter = await ownerApi.request
    .get('/api/billing', { headers: { Authorization: `Bearer ${ownerApi.accessToken}`, ...(origin ? { Origin: origin } : {}) } })
    .then(async (r) => {
      expect(r.ok(), 'owner GET /api/billing (after) must be 200').toBeTruthy()
      const body = (await r.json()) as { data: { usage: { aiCredits: { available: number } } } }
      const available = body.data.usage.aiCredits.available
      expect(typeof available, 'billing aiCredits.available must be a number').toBe('number')
      return available
    })
  expect(creditsAfter, 'AC3: the deterministic path must burn ZERO AI credits').toBe(creditsBefore)

  // ---- teardown ----
  await studentContext.close()
  await teacherContext.close()
  await ownerApi.dispose()
})

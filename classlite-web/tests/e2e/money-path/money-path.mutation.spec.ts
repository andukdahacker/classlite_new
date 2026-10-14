/**
 * Money-path MUTATION fixture (Story 11-5a, AC6 — "the gate is PROVEN to bite,
 * durably"). This is a committed, `test.skip`-tagged variant of the money path
 * with ONE step deliberately broken: the student answers the objective MCQ with
 * the KNOWN-WRONG distractor, yet the spec still asserts the released band is the
 * all-correct band (9.0). Against the real stack that assertion MUST fail RED —
 * a 1/2 objective score releases a lower band — which proves the AC4 correctness
 * oracle actually bites and is not a tautology that would sleep through "the pipe
 * delivers garbage."
 *
 * WHY committed + skipped (not a throwaway revert): the proof must not evaporate.
 * Any reviewer can flip `test.skip` → `test` (or run `--grep @mutation`), point
 * it at a seeded stack, and watch it go RED on demand. The completion notes pin
 * the CI-run URL + this diff as the re-checkable evidence.
 *
 * It runs under the SAME `money-path` project (same seeded preview + fake-media
 * flags). It is `.skip` so CI's green run never executes it.
 */
import { expect, test, type Page } from '@playwright/test'
import { loadCredentials, originOf } from '../lib/auth-harness'
import {
  EXPECTED_OBJECTIVE_BAND,
  OBJECTIVE_KEY,
  createAssignment,
  createExerciseWithContent,
  freshAuthedContext,
  getAssignmentResult,
  objectiveContent,
  releaseObjective,
  requireSeedIdentity,
  resolveActiveClassId,
  rowStartCta,
  staffApiOverContext,
  studentApiFromToken,
  waitForSubmissionId,
} from './moneyPath'

const DEADLINE_AT = '2099-01-01T00:00:00.000Z'
const REFRESH_PATH = '/api/auth/refresh'

/** Answer the reading MCQ with the DISTRACTOR (the injected defect) + submit. */
async function driveReadingWithWrongAnswer(page: Page): Promise<void> {
  await expect(page.getByTestId('attempt-shell')).toBeVisible()
  // MUTATION: pick the known-WRONG option instead of OBJECTIVE_KEY.mcqCorrect.
  await page.getByTestId(`choice-${OBJECTIVE_KEY.mcqRef}-${OBJECTIVE_KEY.mcqDistractor}`).click()
  await page.getByTestId(`gap-input-${OBJECTIVE_KEY.gapRef}`).fill('wrong-on-purpose')
  await page.getByTestId('attempt-submit-open').click()
  await expect(page.getByTestId('submit-confirm-dialog')).toBeVisible()
  await page.getByTestId('submit-confirm').click()
  await expect(page.getByTestId('submission-confirmation')).toBeVisible()
}

// SKIPPED by design — flip to `test(` to watch the gate bite against a seeded stack.
test.skip('@mutation 11-5a — injected wrong answer must FAIL the band oracle (gate bites)', async ({
  browser,
  baseURL,
}) => {
  test.slow()
  const origin = originOf(baseURL)
  const creds = loadCredentials()
  const teacherCred = requireSeedIdentity(creds, 'teacher', (c) => !c.email.includes('teacher2'), 'owning teacher')
  const studentCred = requireSeedIdentity(creds, 'student', (c) => c.email.includes('student1'), 'student1')

  const teacherContext = await browser.newContext({ baseURL })
  const teacherApi = await staffApiOverContext(teacherContext, baseURL, teacherCred)
  const classId = await resolveActiveClassId(teacherApi)
  const exerciseId = await createExerciseWithContent(teacherApi, {
    title: 'E2E mutation reading',
    skill: 'reading',
    content: objectiveContent('reading'),
  })
  const assignmentId = await createAssignment(teacherApi, { exerciseId, classId, deadlineAt: DEADLINE_AT })

  const studentContext = await freshAuthedContext(browser, baseURL, studentCred)
  const studentPage = await studentContext.newPage()
  const bootRefresh = studentPage.waitForResponse(
    (r) => r.url().includes(REFRESH_PATH) && r.request().method() === 'POST',
  )
  await studentPage.goto('/assignments')
  const refreshBody = (await (await bootRefresh).json()) as { data: { accessToken: string } }
  const studentApi = studentApiFromToken(studentContext.request, refreshBody.data.accessToken, origin, studentCred.centerId)

  const submissionIdPromise = waitForSubmissionId(studentPage)
  await studentPage.getByTestId(rowStartCta(assignmentId)).click()
  const submissionId = await submissionIdPromise
  await driveReadingWithWrongAnswer(studentPage)
  await releaseObjective(teacherApi, submissionId)

  const released = await getAssignmentResult(studentApi, assignmentId)
  // THE INJECTED FAILURE: a wrong answer cannot release the all-correct band.
  // This assertion goes RED against the real stack — proving the oracle bites.
  expect(released.overallBand).toBe(EXPECTED_OBJECTIVE_BAND)

  await studentContext.close()
  await teacherContext.close()
})

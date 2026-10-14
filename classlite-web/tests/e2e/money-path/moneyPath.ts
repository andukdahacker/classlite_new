/**
 * Money-path page objects + authenticated-API helpers (Story 11-5a, Tasks 1–4).
 *
 * This module is the ONE place the money-path spec reconciles with the real
 * backend + the real attempt UIs. It never imports from `src/**` (keeps
 * `harness-unreachable.test.ts` green — only `auth-harness` is scanned, but we
 * hold the same invariant), and it never fabricates a session cookie (the
 * no-stub guard forbids it — every session originates from a real login).
 *
 * TWO DRIVE MODES, by design (AC1 hybrid scaffolding, Ducdo rulings 2026-10-13):
 *   • API-driven (authed `APIRequestContext` carrying a real Bearer): staff
 *     authoring the plumbing that has NO shipped UI — exercise create + content
 *     PATCH, assignment create (FU-11-5A-ASSIGN-UI: no teacher assign UI exists
 *     yet), teacher grade/release, owner billing read.
 *   • Browser-driven (a real Chromium page): the legs that DO have UI and are
 *     the valuable coverage — teacher opening the seeded class, and the whole
 *     student journey (all 4 attempt types + the result read-backs).
 *
 * GREEN-PHASE SEAMS (the single list to reconcile against a live seeded stack,
 * since this spec is a smoke over already-shipped features and cannot be
 * rehearsed in the DB-less unit CI — E2E red convention):
 *   S1. Exercise content v1 schema (sections/questionGroups/questions) —
 *       classlite-api/internal/store/exercise_content.go; the golden objective
 *       shape mirrors auto_grade_override_release_atdd_test.go.
 *   S2. questionRef handle = `${si}:${gi}:${qi}` (ExerciseAttemptShell.tsx:319),
 *       so the MCQ option testid is `choice-0:0:0-<optionText>` (ChoiceOption.tsx:71)
 *       and the gap input is `gap-input-0:1:0` (GapInput.tsx:41).
 *   S3. Listening authored WITHOUT an audio stimulus — the MCQ/gap questions are
 *       answerable without audio; if the shell hard-requires audio for listening,
 *       attach a stimulus key here.
 *   S4. Objective 2/2 correct ⇒ 100% ⇒ band 9.0 (autograde.go bandCutoffs).
 *   S5. Writing min-words — the essay below is ~110 words to clear any
 *       `writing-submit-underlength` gate.
 *   S6. Speaking upload rides the dev mock-R2 sink (main.go, APP_ENV=development
 *       + no R2) so presign→PUT→confirm round-trips; the chromium fake-media
 *       flags feed the committed .wav fixture to MediaRecorder.
 */
import {
  type APIRequestContext,
  type Browser,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import {
  loginAndCaptureSession,
  originOf,
  type CredentialsEntry,
} from '../lib/auth-harness'

/** The Playwright fixture handle (`{ playwright }`) used to mint API contexts. */
type PlaywrightFixture = PlaywrightWorkerArgs['playwright']

/** The seeded tenant the money path runs in (11-1a). */
export const TENANT_A_SHORT_CODE = 'SEEDFAKEA'

/**
 * The four money-path skills, in attempt order. reading+listening are objective
 * (auto-grade + release); writing+speaking are teacher-manual grade.
 */
export const MONEY_PATH_SKILLS = ['reading', 'listening', 'writing', 'speaking'] as const
export type MoneyPathSkill = (typeof MONEY_PATH_SKILLS)[number]

/**
 * Objective skills grade via auto-grade + POST /release; the rest are manual. A
 * type predicate so callers narrow `MoneyPathSkill` → the `objectiveContent` /
 * `promptContent` builders' input unions in each branch.
 */
export function isObjectiveSkill(skill: MoneyPathSkill): skill is 'reading' | 'listening' {
  return skill === 'reading' || skill === 'listening'
}

/**
 * The known objective answer key (S2/S4). Two questions — one MCQ, one
 * fill-in-blank — both answered correctly ⇒ 2/2 ⇒ 100% ⇒ band 9.0. This is the
 * correctness oracle AC4 demands: a gate that sleeps through "the pipe delivers
 * garbage" is the exact failure a center can't survive.
 */
export const OBJECTIVE_KEY = {
  mcqRef: '0:0:0',
  mcqCorrect: 'The fox',
  mcqDistractor: 'The dog',
  gapRef: '0:1:0',
  gapCorrect: 'necessary',
} as const

/** 2/2 objective ⇒ 100% ⇒ PercentageToBand(100) === 9.0 (autograde.go). */
export const EXPECTED_OBJECTIVE_BAND = 9.0

/** The committed teacher-manual writing scores (round-tripped verbatim to the student view, AC4). */
export const WRITING_SCORES = {
  taskResponse: 7,
  coherenceCohesion: 6.5,
  lexicalResource: 7,
  grammaticalRange: 6.5,
} as const
/** overallBand the server computes from WRITING_SCORES (mean 6.75 → rounded to a .0/.5 band). */
export const EXPECTED_WRITING_BAND = 7.0

/** The committed teacher-manual speaking scores. */
export const SPEAKING_SCORES = {
  fluencyCoherence: 7,
  lexicalResource: 6.5,
  grammaticalRange: 7,
  pronunciation: 6.5,
} as const
export const EXPECTED_SPEAKING_BAND = 7.0

/** A ~110-word essay — clears any client min-word gate (S5). */
export const WRITING_ESSAY =
  'The chart illustrates a clear upward trend in the number of students enrolling ' +
  'in English language centres across the region over the past five years. In the ' +
  'first year, enrolment remained relatively modest, but each subsequent period saw ' +
  'a steady and pronounced increase. By the final year shown, the total had more ' +
  'than doubled compared with the starting point. This growth suggests rising demand ' +
  'for structured language instruction, possibly driven by employment and study ' +
  'opportunities abroad. Although the data does not explain the underlying causes, ' +
  'the overall pattern is unambiguous: participation grew consistently year on year, ' +
  'with no period of decline recorded at any stage throughout the entire timeframe.'

/* -------------------------------------------------------------------------- */
/* Exercise content builders (S1)                                             */
/* -------------------------------------------------------------------------- */

interface ExerciseQuestion {
  text: string
  type: string
  options: string[]
  correctAnswer: string
  acceptedVariants: string[]
}
interface QuestionGroup {
  type: string
  instructions: string
  questions: ExerciseQuestion[]
}
interface ExerciseSection {
  type: string
  title: string
  content: string
  questionGroups: QuestionGroup[]
}
export interface ExerciseContent {
  sections: ExerciseSection[]
  settings: { timeLimitEnabled: boolean; timeLimitMinutes: number; caseSensitive: boolean }
}

const NO_TIME_LIMIT = { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false }

/**
 * objectiveContent builds the golden scorable objective exercise for a reading
 * or listening skill: one MCQ (ref 0:0:0) + one fill-in-blank (ref 0:1:0), each
 * with a known correct answer (OBJECTIVE_KEY). Mirrors the shape the Go
 * auto-grade E2E seeds directly (S1).
 */
export function objectiveContent(skill: 'reading' | 'listening'): ExerciseContent {
  return {
    sections: [
      {
        type: skill,
        title: 'Passage',
        content:
          'A quick brown fox jumped over the lazy dog. Preparation is necessary for success.',
        questionGroups: [
          {
            type: 'multiple_choice',
            instructions: 'Choose the best answer.',
            questions: [
              {
                text: 'Which animal jumped?',
                type: 'multiple_choice',
                options: [OBJECTIVE_KEY.mcqCorrect, OBJECTIVE_KEY.mcqDistractor],
                correctAnswer: OBJECTIVE_KEY.mcqCorrect,
                acceptedVariants: [],
              },
            ],
          },
          {
            type: 'fill_in_blank',
            instructions: 'Fill the blank with one word.',
            questions: [
              {
                text: 'Preparation is _____ for success.',
                type: 'fill_in_blank',
                options: [],
                correctAnswer: OBJECTIVE_KEY.gapCorrect,
                acceptedVariants: [],
              },
            ],
          },
        ],
      },
    ],
    settings: NO_TIME_LIMIT,
  }
}

/** promptContent builds a manual-graded writing/speaking exercise — a prompt, no gradable questions. */
export function promptContent(skill: 'writing' | 'speaking', prompt: string): ExerciseContent {
  return {
    sections: [{ type: skill, title: 'Task 1', content: prompt, questionGroups: [] }],
    settings: NO_TIME_LIMIT,
  }
}

/* -------------------------------------------------------------------------- */
/* Seed identity resolution                                                   */
/* -------------------------------------------------------------------------- */

/**
 * requireSeedIdentity resolves a tenant-A identity from the manifest or throws
 * the same directive error the harness uses — never slip an `undefined` into a
 * login and surface a cryptic `undefined.email`.
 */
export function requireSeedIdentity(
  creds: CredentialsEntry[],
  role: string,
  predicate: (c: CredentialsEntry) => boolean = () => true,
  which = role,
): CredentialsEntry {
  const found = creds.find(
    (c) => c.centerShortCode === TENANT_A_SHORT_CODE && c.role === role && predicate(c),
  )
  if (!found) {
    throw new Error(
      `money-path: credentials.json is missing tenant-A ${which}. Re-run the seed ` +
        `(scripts/seed.sh) so it emits classlite-web/tests/e2e/.auth/credentials.json.`,
    )
  }
  return found
}

/* -------------------------------------------------------------------------- */
/* Authenticated API context (TS-8: protected endpoints need a Bearer token)  */
/* -------------------------------------------------------------------------- */

/**
 * StaffApi is an authed caller: an APIRequestContext plus the Bearer token +
 * dev Origin to attach on every state-changing call. The token+origin are
 * attached PER CALL (not via extraHTTPHeaders) so the SAME handle works whether
 * `request` is a dedicated API context (owner) or a browser context's
 * `context.request` (teacher — shared with the SPA boot to spend ONE login, AC5).
 */
export interface StaffApi {
  request: APIRequestContext
  accessToken: string
  origin?: string
  centerId: string
  dispose: () => Promise<void>
}

interface Envelope<T> {
  data: T
}

/** authHeaders builds the Bearer + Origin headers every authed staff call attaches (TS-8 + OriginCheck). */
export function authHeaders(api: StaffApi): Record<string, string> {
  return {
    Authorization: `Bearer ${api.accessToken}`,
    ...(api.origin ? { Origin: api.origin } : {}),
  }
}

/**
 * loginForAccessToken performs a real login via `request` THEN a refresh, and
 * returns the access token from the REFRESH response — NOT the login response.
 *
 * WHY login-then-refresh: `/api/auth/login` mints a CENTER-LESS token
 * (`{user_id,exp,iat,jti}`, with `role:null, center:null` in the body) — a
 * protected endpoint like `/api/classes` then 403s `CENTER_REQUIRED`. The
 * center claim is auto-bound only in `buildAccessToken`, which runs on
 * `/api/auth/refresh` (auth_refresh.go:94) and emits the center when the user
 * has exactly one membership — exactly what the SPA's boot-refresh does. The
 * login lands the `refresh_token` cookie in `request`'s jar; the refresh reads
 * it (same jar) and returns the center-bearing token. Refresh is NOT on the
 * burst-8 login limiter, so this is still ONE login per context (AC5).
 *
 * (NOTE: the auto-bind reads `center_members` UNSCOPED, so it needs a
 * BYPASSRLS DB role — the API must run as such for login center-resolution;
 * documented in the completion notes / FU.)
 */
async function loginForAccessToken(
  request: APIRequestContext,
  cred: CredentialsEntry,
  origin: string | undefined,
): Promise<string> {
  const headers = origin ? { Origin: origin } : undefined
  const login = await request.post('/api/auth/login', {
    data: { email: cred.email, password: cred.password, rememberMe: true },
    headers,
  })
  if (!login.ok()) {
    throw new Error(`login failed for ${cred.email}: HTTP ${login.status()} ${await login.text()}`)
  }
  // Refresh binds the single-membership center into the token (the login token
  // is center-less → CENTER_REQUIRED on protected reads).
  const refresh = await request.post('/api/auth/refresh', { headers })
  if (!refresh.ok()) {
    throw new Error(`refresh failed for ${cred.email}: HTTP ${refresh.status()} ${await refresh.text()}`)
  }
  const body = (await refresh.json()) as Envelope<{ accessToken: string }>
  if (!body.data.accessToken) {
    throw new Error(`refresh for ${cred.email} returned 200 but no accessToken in the body`)
  }
  return body.data.accessToken
}

/**
 * authedApi mints a dedicated API context + real login for `cred` (one login).
 * Used for the owner billing read — the owner never drives a browser page, so a
 * pure API context is right and spends exactly one login.
 */
export async function authedApi(
  playwright: PlaywrightFixture,
  baseURL: string | undefined,
  cred: CredentialsEntry,
): Promise<StaffApi> {
  const origin = originOf(baseURL)
  const request = await playwright.request.newContext({ baseURL })
  const accessToken = await loginForAccessToken(request, cred, origin)
  return { request, accessToken, origin, centerId: cred.centerId, dispose: () => request.dispose() }
}

/**
 * staffApiOverContext logs in over an EXISTING browser context's request jar:
 * the one login lands the refresh cookie (so the SAME context's page.goto boots
 * authenticated — the teacher opening the class, AC1) AND yields the access
 * token for the authoring calls. ONE login serves both the browser + API legs,
 * holding the lane to ≤3 total logins (AC5). dispose is a no-op (the caller owns
 * the browser context lifecycle).
 */
export async function staffApiOverContext(
  context: { request: APIRequestContext },
  baseURL: string | undefined,
  cred: CredentialsEntry,
): Promise<StaffApi> {
  const origin = originOf(baseURL)
  const accessToken = await loginForAccessToken(context.request, cred, origin)
  return {
    request: context.request,
    accessToken,
    origin,
    centerId: cred.centerId,
    dispose: async () => {},
  }
}

async function okJson<T>(label: string, p: Awaited<ReturnType<APIRequestContext['post']>>): Promise<T> {
  if (!p.ok()) {
    throw new Error(`${label} failed: HTTP ${p.status()} ${await p.text()}`)
  }
  const body = (await p.json()) as Envelope<T>
  return body.data
}

/* -------------------------------------------------------------------------- */
/* Staff authoring (API-driven)                                               */
/* -------------------------------------------------------------------------- */

interface ExerciseResponse {
  id: string
  updatedAt: string
}
interface AssignmentResponse {
  id: string
}
interface ClassListItem {
  id: string
  name: string
  status: string
}

/**
 * resolveActiveClassId finds the seeded active class the teacher teaches
 * (`GET /api/classes` → the `active`, `SEED_FAKE_`-marked class). The smoke
 * OPENS this class (AC1) rather than creating one — class-create + enrollment
 * coverage is owed (Out of Scope → 11-5b). On a persistent local dev DB the
 * `SEED_FAKE_` marker disambiguates it from accumulated real classes.
 */
export async function resolveActiveClassId(api: StaffApi): Promise<string> {
  const response = await api.request.get('/api/classes?page=1&pageSize=50', { headers: authHeaders(api) })
  if (!response.ok()) {
    throw new Error(`GET /api/classes expected 200, got ${response.status()} ${await response.text()}`)
  }
  const body = (await response.json()) as Envelope<ClassListItem[]>
  const active = body.data.filter((c) => c.status === 'active')
  // FAIL FAST on a missing seed marker (code-review P6): the earlier `?? active[0]`
  // fallback would silently author four throwaway exercises/assignments into an
  // arbitrary real teacher's class on a persistent dev DB (data pollution + confusing
  // downstream failures). The SEED_FAKE_ marker is the ONLY class this smoke may drive.
  const seeded = active.find((c) => c.name.startsWith('SEED_FAKE_'))
  if (!seeded) {
    throw new Error(
      'money-path: no SEED_FAKE_ active class found for the teacher — re-run the seed (scripts/seed.sh)',
    )
  }
  return seeded.id
}

/**
 * createExerciseWithContent authors an exercise (metadata) then PATCHes its
 * scorable content (POST ignores content; content is a separate PATCH gated by
 * an If-Match / updatedAt precondition — S1). Returns the exercise id.
 */
export async function createExerciseWithContent(
  api: StaffApi,
  input: { title: string; skill: MoneyPathSkill; content: ExerciseContent },
): Promise<string> {
  const created = await okJson<ExerciseResponse>(
    'create exercise',
    await api.request.post('/api/exercises', {
      headers: authHeaders(api),
      data: { title: input.title, skill: input.skill, tags: ['e2e', 'money-path'], description: null, targetBand: 6.5 },
    }),
  )
  await okJson<ExerciseResponse>(
    'patch exercise content',
    await api.request.patch(`/api/exercises/${created.id}`, {
      headers: authHeaders(api),
      data: { content: input.content, updatedAt: created.updatedAt },
    }),
  )
  return created.id
}

/** createAssignment binds an exercise to the class for all enrollees (API — no UI exists, FU-11-5A-ASSIGN-UI). */
export async function createAssignment(
  api: StaffApi,
  input: { exerciseId: string; classId: string; deadlineAt: string },
): Promise<string> {
  const created = await okJson<AssignmentResponse>(
    'create assignment',
    await api.request.post('/api/assignments', {
      headers: authHeaders(api),
      data: {
        exerciseId: input.exerciseId,
        classId: input.classId,
        deadlineAt: input.deadlineAt,
        hardDeadlineAt: null,
        instructions: null,
        latePenalty: null,
      },
    }),
  )
  return created.id
}

/** releaseObjective publishes an auto-graded objective submission (reading/listening) → 200. */
export async function releaseObjective(api: StaffApi, submissionId: string): Promise<void> {
  const response = await api.request.post(`/api/submissions/${submissionId}/release`, {
    headers: authHeaders(api),
  })
  if (response.status() !== 200) {
    throw new Error(`release ${submissionId} expected 200, got ${response.status()} ${await response.text()}`)
  }
}

/**
 * gradeManual teacher-grades a writing or speaking submission with literal
 * criterionScores (AC3) — NO `skill` field in the body (the server resolves it;
 * a `skill` → 409 SUBMISSION_SKILL_MISMATCH). Expects 201 (grade is created AND
 * released in one call — grading_service.go GradeWriting/GradeSpeaking).
 */
export async function gradeManual(
  api: StaffApi,
  submissionId: string,
  criterionScores: Record<string, number>,
): Promise<void> {
  const response = await api.request.post(`/api/submissions/${submissionId}/grade`, {
    headers: authHeaders(api),
    data: { criterionScores, comments: [], feedback: 'Solid effort — clear structure.' },
  })
  if (response.status() !== 201) {
    throw new Error(`grade ${submissionId} expected 201, got ${response.status()} ${await response.text()}`)
  }
}

interface BillingSummary {
  usage: { aiCredits: { available: number } }
}

/** readAiCreditsAvailable reads the owner-only billing summary's spendable AI-credit balance (AC3 delta oracle). */
export async function readAiCreditsAvailable(ownerApi: StaffApi): Promise<number> {
  const response = await ownerApi.request.get('/api/billing', { headers: authHeaders(ownerApi) })
  if (!response.ok()) {
    throw new Error(`GET /api/billing expected 200, got ${response.status()} ${await response.text()}`)
  }
  const body = (await response.json()) as Envelope<BillingSummary>
  return body.data.usage.aiCredits.available
}

/* -------------------------------------------------------------------------- */
/* Student result read (API, via the student's OWN captured access token)     */
/* -------------------------------------------------------------------------- */

/**
 * StudentGradeView mirrors the student-facing grade (attempt_handler.go:142) —
 * CRUCIALLY it carries NO teacher-identity field. The spec asserts `gradedBy`
 * is absent by reading the raw JSON for the key (privacy D1, AC4). `grade` is
 * non-null only once the grade is RELEASED.
 */
export interface StudentResult {
  status: number
  released: boolean
  inProgress: boolean
  overallBand: number | null
  criterionScores: Record<string, number> | null
  audioUrl: string | null
  /** the raw `grade` object (or null) — used to assert `graded_by`/`gradedBy` is absent. */
  rawGrade: Record<string, unknown> | null
}

/**
 * getAssignmentResult reads `GET /api/assignments/{id}/result` as the student
 * (their OWN captured Bearer token — robust against the 30s list staleTime that
 * gates the UI review-CTA). Returns the status + the released/grade view. A
 * started submission returns 200 throughout the lifecycle (200-pending, never
 * 404 — attempt_handler.go:204); a never-started assignment is 404, so the smoke
 * always Starts first.
 */
export async function getAssignmentResult(
  studentApi: StaffApi,
  assignmentId: string,
): Promise<StudentResult> {
  const response = await studentApi.request.get(
    `/api/assignments/${assignmentId}/result`,
    { headers: authHeaders(studentApi) },
  )
  const status = response.status()
  if (status !== 200) {
    return { status, released: false, inProgress: false, overallBand: null, criterionScores: null, audioUrl: null, rawGrade: null }
  }
  const body = (await response.json()) as Envelope<{
    released: boolean
    inProgress: boolean
    audioUrl: string | null
    grade: { overallBand?: number; criterionScores?: Record<string, number> } | null
  }>
  const grade = body.data.grade
  return {
    status,
    released: body.data.released,
    inProgress: body.data.inProgress,
    overallBand: grade?.overallBand ?? null,
    criterionScores: grade?.criterionScores ?? null,
    audioUrl: body.data.audioUrl,
    rawGrade: (grade as Record<string, unknown> | null) ?? null,
  }
}

/**
 * studentApiFromToken wraps the student's captured access token as a StaffApi so
 * the result-read helper can attach the Bearer. The token is minted by the
 * SPA's boot-refresh (captured from the /api/auth/refresh response), so this
 * spends NO extra login — it reuses the student's single browser login.
 */
export function studentApiFromToken(
  request: APIRequestContext,
  accessToken: string,
  origin: string | undefined,
  centerId: string,
): StaffApi {
  return { request, accessToken, origin, centerId, dispose: async () => {} }
}

/* -------------------------------------------------------------------------- */
/* Browser helpers (student + staff-opens-class)                              */
/* -------------------------------------------------------------------------- */

/**
 * freshAuthedContext mints a NEW live session in a fresh browser context (the
 * rotation-proof pattern — a persisted refresh_token is single-use; role-scope.spec.ts:89).
 * Logging in via `context.request` lands the real refresh_token in the shared
 * jar, so the first (and ONLY) page.goto boots authenticated via the SPA's
 * boot-refresh.
 */
export async function freshAuthedContext(browser: Browser, baseURL: string | undefined, cred: CredentialsEntry) {
  const context = await browser.newContext({ baseURL })
  await loginAndCaptureSession(context.request, cred, { origin: originOf(baseURL) })
  return context
}

/** The student result route for an assignment (`/result` is a redirect alias → `/submission`). */
export function resultRoute(assignmentId: string): string {
  return `/assignments/${assignmentId}/submission`
}

/** The student attempt list row CTA testid (id-keyed → no title-matching fragility). */
export function rowStartCta(assignmentId: string): string {
  return `assignment-cta-${assignmentId}`
}
export function rowReviewCta(assignmentId: string): string {
  return `assignment-review-cta-${assignmentId}`
}

/**
 * waitForSubmissionId captures the submission id the browser mints on attempt
 * Start (POST /api/submissions → 201/200), so the teacher API can grade/release
 * that exact submission. Matched on pathname (not a `**` glob) + POST method so
 * a lifecycle PUT/GET can never satisfy it first.
 */
export async function waitForSubmissionId(page: Page): Promise<string> {
  const response = await page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/submissions' && r.request().method() === 'POST',
  )
  const body = (await response.json()) as Envelope<{ id: string }>
  return body.data.id
}

/**
 * installNoAiGradeGuard wires an observable AC3 oracle: a `page.on('request')`
 * listener records any request whose path hits `/ai-grade`. It returns an
 * `assertNoAiGrade()` the spec calls at the end — a throw inside a request
 * listener does NOT fail a Playwright test, so the gate must be a real assertion
 * at a checkpoint, over a recorded list (not the unfalsifiable "no job enqueued").
 */
export function installNoAiGradeGuard(page: Page): { assertNoAiGrade: () => void } {
  const offenders: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (/\/ai-grade(\b|\/|$)/.test(path)) offenders.push(path)
  })
  return {
    assertNoAiGrade: () => {
      if (offenders.length > 0) {
        throw new Error(
          `AC3 VIOLATION: the deterministic money path must NEVER call /ai-grade, but saw: ${offenders.join(', ')}`,
        )
      }
    },
  }
}

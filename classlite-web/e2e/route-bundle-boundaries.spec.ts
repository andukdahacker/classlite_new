/**
 * AC2 — Route-bundle boundary contract.
 *
 * The three lazy bundle groups (auth / student / teacher) must produce
 * distinct chunks that visiting one boundary does NOT pull in from
 * another. Without this assertion every IDE auto-import that drops
 * `import { LoginPage } from '@/features/auth/...'` at the top of
 * routes.tsx would silently merge chunks, breaking the 4G-Vietnam
 * bundle target (architecture line 253) until someone runs a manual
 * size audit months later.
 *
 * The production-bundle dev-route absence is verified by the Task 11.7
 * grep gate on `dist/`, NOT by Playwright (the dev server serves dev
 * chunks by design).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const DIST_DIR = resolve(HERE, '..', 'dist', 'assets')

test.describe('Route bundle boundaries — auth / student / teacher (AC2)', () => {
  test('navigating to /dashboard does NOT request the auth chunk', async ({
    page,
  }) => {
    const requests: string[] = []
    page.on('request', (req) => requests.push(req.url()))
    await page.goto('/dashboard')
    // Deterministic post-load signal: TeacherDashboard renders this testid
    // (features/dashboard/TeacherDashboard.tsx) once the lazy chunk has
    // resolved AND its i18n key has bound. Replaces the prior
    // `waitForLoadState('networkidle')` which is unreliable in this SPA
    // (HMR WebSocket keeps the connection counter non-zero in dev). By the
    // time the heading is visible, every chunk needed for the dashboard
    // render has been requested — any auth-chunk leak would already be in
    // `requests`.
    await expect(page.getByTestId('teacher-dashboard-heading')).toBeVisible()

    const sawAuthLayout = requests.some((url) =>
      /\/AuthLayout-[\w-]+\.js/.test(url),
    )
    const sawLoginPage = requests.some((url) =>
      /\/LoginPage-[\w-]+\.js/.test(url),
    )
    expect(sawAuthLayout, 'auth layout chunk leaked into /dashboard').toBe(
      false,
    )
    expect(
      sawLoginPage,
      'login page chunk leaked into /dashboard',
    ).toBe(false)
  })

  test('navigating to /login does NOT request the dashboard chunks', async ({
    page,
  }) => {
    const requests: string[] = []
    page.on('request', (req) => requests.push(req.url()))
    await page.goto('/login')
    // Deterministic post-load signal: LoginPage renders this testid
    // (features/auth/LoginPage.tsx — `login-heading`) once the AuthLayout +
    // LoginPage chunks have resolved and the title binds. Same rationale as
    // the /dashboard test above: replaces the brittle `networkidle` wait.
    await expect(page.getByTestId('login-heading')).toBeVisible()

    const sawStudent = requests.some((url) =>
      /\/StudentDashboard-[\w-]+\.js/.test(url),
    )
    const sawTeacher = requests.some((url) =>
      /\/TeacherDashboard-[\w-]+\.js/.test(url),
    )
    expect(sawStudent, 'student dashboard chunk leaked into /login').toBe(false)
    expect(sawTeacher, 'teacher dashboard chunk leaked into /login').toBe(false)
  })

  test('Story 1-9a — auth chunk includes VerifyEmailPage; dashboard chunks do NOT', async () => {
    // Rolldown emits one .js file per dynamic-import target, named
    // after the imported module (e.g. `VerifyEmailPage-xxxxx.js`). The
    // positive contract: a VerifyEmailPage-*.js file MUST exist in
    // dist/assets. The negative contract: VerifyEmailPage's module
    // contents (referenced by `i18nextProvider`/feature-internal
    // imports it threads) MUST NOT have been folded into a dashboard
    // chunk. The party-mode 2026-06-25 amendment asks for explicit
    // negative assertions; we encode that as "the dashboard chunks
    // don't import any verify-email-related symbol from a sibling
    // chunk that would create a transitive dependency."
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)
    // Positive: dedicated VerifyEmailPage chunk exists.
    const verifyChunks = files.filter((file: string) =>
      /^VerifyEmailPage-[\w-]+\.js$/.test(file),
    )
    expect(
      verifyChunks.length,
      'expected a dedicated VerifyEmailPage chunk under dist/assets/',
    ).toBeGreaterThan(0)
    // Negative: dashboard chunks must not statically import the verify
    // chunk's filename. The Rolldown import maps the chunk filename
    // verbatim into the manifest of any sibling chunk that imports it.
    // Iterate ALL verify chunks (not just [0]) so a future vendor-split
    // emitting multiple verify chunks doesn't sneak a second leak past
    // this contract.
    const studentChunkFiles = files.filter((file: string) =>
      /^StudentDashboard-[\w-]+\.js$/.test(file),
    )
    const teacherChunkFiles = files.filter((file: string) =>
      /^TeacherDashboard-[\w-]+\.js$/.test(file),
    )
    // Vacuous-pass guard: an empty chunk array would let the
    // not.toContain pass silently against an empty join. Hard-fail if
    // the dashboard chunks are absent — that's a build problem, not a
    // boundary win.
    expect(
      studentChunkFiles.length,
      'student dashboard chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      teacherChunkFiles.length,
      'teacher dashboard chunk missing from dist/',
    ).toBeGreaterThan(0)
    const studentContents = studentChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')
    const teacherContents = teacherChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')
    for (const verifyChunkBasename of verifyChunks) {
      expect(studentContents).not.toContain(verifyChunkBasename)
      expect(teacherContents).not.toContain(verifyChunkBasename)
    }
  })

  test('Story 1-9b — auth chunk includes ForgotPasswordPage + ResetPasswordPage; dashboard chunks do NOT', async () => {
    // Mirrors the Story 1-9a contract above with explicit iteration shape
    // per AC1 (Murat BLOCKER fix): 4 vacuous-pass guards + 2 iterated
    // negative loops covering each forgot/reset chunk × each dashboard
    // chunk = 4 cross-chunk leak checks.
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)
    const forgotChunks = files.filter((f: string) =>
      /^ForgotPasswordPage-[\w-]+\.js$/.test(f),
    )
    const resetChunks = files.filter((f: string) =>
      /^ResetPasswordPage-[\w-]+\.js$/.test(f),
    )
    const studentChunkFiles = files.filter((f: string) =>
      /^StudentDashboard-[\w-]+\.js$/.test(f),
    )
    const teacherChunkFiles = files.filter((f: string) =>
      /^TeacherDashboard-[\w-]+\.js$/.test(f),
    )

    // FOUR vacuous-pass guards — hard-fail if any input array is empty
    // (catches missing builds rather than silently passing on empty .join).
    expect(
      forgotChunks.length,
      'ForgotPasswordPage chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      resetChunks.length,
      'ResetPasswordPage chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      studentChunkFiles.length,
      'student dashboard chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      teacherChunkFiles.length,
      'teacher dashboard chunk missing from dist/',
    ).toBeGreaterThan(0)

    const studentContents = studentChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')
    const teacherContents = teacherChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')

    // TWO iterated negative assertions × 2 dashboards = 4 leak checks.
    for (const forgotChunkBasename of forgotChunks) {
      expect(studentContents).not.toContain(forgotChunkBasename)
      expect(teacherContents).not.toContain(forgotChunkBasename)
    }
    for (const resetChunkBasename of resetChunks) {
      expect(studentContents).not.toContain(resetChunkBasename)
      expect(teacherContents).not.toContain(resetChunkBasename)
    }
  })

  test('Story 1-9c — auth chunk includes InviteAcceptancePage; dashboard chunks do NOT', async () => {
    // Mirrors the Story 1-9b contract above: vacuous-pass guard on the
    // InviteAcceptancePage chunk count + iterated negative assertions
    // across the dashboard chunks.
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)
    const inviteChunks = files.filter((f: string) =>
      /^InviteAcceptancePage-[\w-]+\.js$/.test(f),
    )
    const studentChunkFiles = files.filter((f: string) =>
      /^StudentDashboard-[\w-]+\.js$/.test(f),
    )
    const teacherChunkFiles = files.filter((f: string) =>
      /^TeacherDashboard-[\w-]+\.js$/.test(f),
    )

    expect(
      inviteChunks.length,
      'InviteAcceptancePage chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      studentChunkFiles.length,
      'student dashboard chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      teacherChunkFiles.length,
      'teacher dashboard chunk missing from dist/',
    ).toBeGreaterThan(0)

    const studentContents = studentChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')
    const teacherContents = teacherChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')

    for (const inviteChunkBasename of inviteChunks) {
      expect(studentContents).not.toContain(inviteChunkBasename)
      expect(teacherContents).not.toContain(inviteChunkBasename)
    }
  })

  test('Story 2-3a — onboarding chunk includes OnboardingLayout + PersonaSelectPage + CenterSetupPage; dashboard chunks do NOT', async () => {
    // Winston-W5 fold — the onboarding wizard must stay in its own chunk so
    // pre-auth visits (`/login`) never pull in the wizard code, and the
    // teacher dashboard never bloats with `/welcome` or `/setup/center`
    // components. Mirrors the Story 1-9a/b/c iteration pattern.
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)
    const onboardingLayoutChunks = files.filter((f: string) =>
      /^OnboardingLayout-[\w-]+\.js$/.test(f),
    )
    const personaSelectChunks = files.filter((f: string) =>
      /^PersonaSelectPage-[\w-]+\.js$/.test(f),
    )
    const centerSetupChunks = files.filter((f: string) =>
      /^CenterSetupPage-[\w-]+\.js$/.test(f),
    )
    const studentChunkFiles = files.filter((f: string) =>
      /^StudentDashboard-[\w-]+\.js$/.test(f),
    )
    const teacherChunkFiles = files.filter((f: string) =>
      /^TeacherDashboard-[\w-]+\.js$/.test(f),
    )
    const loginChunkFiles = files.filter((f: string) =>
      /^LoginPage-[\w-]+\.js$/.test(f),
    )

    expect(
      onboardingLayoutChunks.length,
      'OnboardingLayout chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      personaSelectChunks.length,
      'PersonaSelectPage chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      centerSetupChunks.length,
      'CenterSetupPage chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      studentChunkFiles.length,
      'student dashboard chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      teacherChunkFiles.length,
      'teacher dashboard chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      loginChunkFiles.length,
      'login page chunk missing from dist/',
    ).toBeGreaterThan(0)

    const studentContents = studentChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')
    const teacherContents = teacherChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')
    const loginContents = loginChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')

    for (const chunk of [
      ...onboardingLayoutChunks,
      ...personaSelectChunks,
      ...centerSetupChunks,
    ]) {
      expect(studentContents).not.toContain(chunk)
      expect(teacherContents).not.toContain(chunk)
      expect(loginContents).not.toContain(chunk)
    }
  })

  test('production dist/ does NOT include any dev-only route module', async () => {
    // Read-only audit of the build artifact. The dev server serves dev
    // chunks by design, so this assertion runs against `dist/` (built by
    // `npm run build` in Task 11.6) rather than the running dev server.
    // FAIL hard (not skip) so a CI pipeline that forgets to run the
    // build before invoking Playwright surfaces the gap loudly — a
    // silent skip masquerading as coverage is exactly the regression
    // this contract exists to catch.
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)
    const offending = files.filter(
      (file: string) =>
        /MultiTabTestPage|ThemeResolutionPage|__theme-resolution|__multi-tab-test-bait/.test(
          file,
        ),
    )
    expect(
      offending,
      `dev-only files leaked into dist/assets/: ${offending.join(', ')}`,
    ).toEqual([])
    for (const file of files as string[]) {
      const content = readFileSync(resolve(DIST_DIR, file))
      const text = content.toString('utf8')
      const flagged = [
        '__theme-resolution',
        '__multi-tab-test-bait',
        'ThemeResolutionPage',
        'MultiTabTestPage',
      ].filter((needle) => text.includes(needle))
      expect(
        flagged,
        `${file} contained dev-only references: ${flagged.join(', ')}`,
      ).toEqual([])
    }
  })
})

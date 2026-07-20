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

  test('Story 2-3b — template/spawn/first-class chunks isolated from login+dashboard AND from each other (Winston-S6)', async () => {
    // Story 2-3b Task 8.2 fold — each of the 3 new post-center wizard pages
    // gets its own lazy chunk; the load-bearing negative is that:
    //   (a) none co-appears with login / dashboard bundles (standard
    //       isolation belt), AND
    //   (b) TemplateSelectPage does NOT statically import the ClassSpawnPage
    //       chunk via a barrel leak (Winston-S6 — shared TemplateCard could
    //       transitively pull the spawn page in).
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)
    const templateChunks = files.filter((f: string) =>
      /^TemplateSelectPage-[\w-]+\.js$/.test(f),
    )
    const spawnChunks = files.filter((f: string) =>
      /^ClassSpawnPage-[\w-]+\.js$/.test(f),
    )
    const soloChunks = files.filter((f: string) =>
      /^SoloFirstClassPage-[\w-]+\.js$/.test(f),
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
      templateChunks.length,
      'TemplateSelectPage chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      spawnChunks.length,
      'ClassSpawnPage chunk missing from dist/',
    ).toBeGreaterThan(0)
    expect(
      soloChunks.length,
      'SoloFirstClassPage chunk missing from dist/',
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

    // (a) — no cross-bundle leaks into login / dashboards.
    for (const chunk of [
      ...templateChunks,
      ...spawnChunks,
      ...soloChunks,
    ]) {
      expect(studentContents).not.toContain(chunk)
      expect(teacherContents).not.toContain(chunk)
      expect(loginContents).not.toContain(chunk)
    }

    // (b) Winston-S6 — TemplateSelectPage chunk must NOT statically import
    // the ClassSpawnPage chunk (or vice versa). Rolldown writes the peer
    // chunk filename verbatim into any importer's manifest.
    const templateContents = templateChunks
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')
    const spawnContents = spawnChunks
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')
    for (const spawnChunkBasename of spawnChunks) {
      expect(templateContents).not.toContain(spawnChunkBasename)
    }
    for (const templateChunkBasename of templateChunks) {
      expect(spawnContents).not.toContain(templateChunkBasename)
    }
  })

  test('Story 2-3c — /setup/done chunk isolated from login+dashboard AND from spawn+first-class (Task 4.2)', async () => {
    // Story 2-3c Task 4.2 fold — the celebration page ships its own lazy
    // chunk. Load-bearing negatives:
    //   (a) OnboardingDonePage chunk does NOT co-appear with login or
    //       dashboard bundle groups (standard isolation belt).
    //   (b) Does NOT co-appear with ClassSpawnPage or SoloFirstClassPage
    //       chunks — a shared component leak (not the type-only
    //       TemplateDraftPayload import, which tree-shakes) would drag the
    //       spawn chunk in via the barrel.
    // Deep-import discipline per TS-7 + W-S4:
    //   `useOnboardingProgress` MUST be deep-imported from
    //   `@/features/onboarding/api/useOnboardingProgress` — NOT via the
    //   `@/features/onboarding` barrel — else OnboardingLayout +
    //   PersonaSelectPage + CenterSetupPage would leak into the done chunk.
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)
    const doneChunks = files.filter((f: string) =>
      /^OnboardingDonePage-[\w-]+\.js$/.test(f),
    )
    const spawnChunks = files.filter((f: string) =>
      /^ClassSpawnPage-[\w-]+\.js$/.test(f),
    )
    const soloChunks = files.filter((f: string) =>
      /^SoloFirstClassPage-[\w-]+\.js$/.test(f),
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
      doneChunks.length,
      'OnboardingDonePage chunk missing from dist/',
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

    // (a) — no cross-bundle leaks into login / dashboards.
    for (const chunk of doneChunks) {
      expect(studentContents).not.toContain(chunk)
      expect(teacherContents).not.toContain(chunk)
      expect(loginContents).not.toContain(chunk)
    }

    // (b) — done chunk does NOT statically import spawn or first-class.
    const doneContents = doneChunks
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')
    for (const spawnChunkBasename of spawnChunks) {
      expect(doneContents).not.toContain(spawnChunkBasename)
    }
    for (const soloChunkBasename of soloChunks) {
      expect(doneContents).not.toContain(soloChunkBasename)
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

  test('Story 2-4 — TeacherDashboard chunk contains checklist testid + dashboard testids are NOT in onboarding chunks (AC15)', async () => {
    // Story 2-4 AC15 fold [A-STRONG-11] — Rolldown minifies identifiers, so
    // `toContain('FinishSetupCard')` on chunk bytes would false-negative.
    // Instead we assert on the `data-testid="dashboard-checklist-card"`
    // string literal, which survives minification.
    //
    // The 3 dashboard-owned testids (checklist-card / first-ai-grade-card /
    // sample-preview) MUST appear in the TeacherDashboard chunk and MUST NOT
    // appear in ANY onboarding chunk (deep-import discipline W-S4 + AC15).
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)

    const teacherChunkFiles = files.filter((f: string) =>
      /^TeacherDashboard-[\w-]+\.js$/.test(f),
    )
    const onboardingChunkFiles = files.filter((f: string) =>
      /^(OnboardingLayout|PersonaSelectPage|CenterSetupPage|TemplateSelectPage|ClassSpawnPage|SoloFirstClassPage|OnboardingDonePage)-[\w-]+\.js$/.test(
        f,
      ),
    )

    expect(
      teacherChunkFiles.length,
      'TeacherDashboard chunk missing from dist/',
    ).toBeGreaterThan(0)

    const teacherContents = teacherChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')

    // TeacherDashboard chunk MUST contain the checklist card testid
    expect(
      teacherContents,
      'TeacherDashboard chunk missing `dashboard-checklist-card` testid — FinishSetupCard did not co-locate into the dashboard chunk',
    ).toContain('dashboard-checklist-card')

    // Onboarding chunks MUST NOT contain ANY of the 3 dashboard testids
    const DASHBOARD_TESTIDS_LEAK_CHECK = [
      'dashboard-checklist-card',
      'dashboard-first-ai-grade-card',
      'dashboard-sample-preview',
    ]
    for (const chunkFile of onboardingChunkFiles) {
      const content = readFileSync(resolve(DIST_DIR, chunkFile)).toString('utf8')
      for (const testid of DASHBOARD_TESTIDS_LEAK_CHECK) {
        expect(
          content,
          `onboarding chunk ${chunkFile} leaked dashboard testid "${testid}" — deep-import discipline violated`,
        ).not.toContain(testid)
      }
    }
  })

  test('Story 2-5a — SettingsPage chunk contains settings-tab-strip testid; onboarding + dashboard chunks do NOT (AC14)', async () => {
    // Story 2-5a AC14 [John-S16 cross-chunk sharpening]. The SettingsPage
    // chunk shares only the deep-imported `useChecklistState` hook with
    // the dashboard chunk — no full-page-testid overlap. Assert filename
    // regex + testid substring positive; testid-negative on onboarding +
    // dashboard chunks.
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)

    const settingsChunkFiles = files.filter((f: string) =>
      /^SettingsPage-[\w-]+\.js$/.test(f),
    )
    expect(
      settingsChunkFiles.length,
      'SettingsPage chunk missing from dist/',
    ).toBeGreaterThan(0)

    const settingsContents = settingsChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')

    // Positive: settings chunk MUST include the tab-strip testid.
    expect(
      settingsContents,
      'SettingsPage chunk missing `settings-tab-strip` testid',
    ).toContain('settings-tab-strip')

    // Negative: onboarding + dashboard chunks MUST NOT include the
    // settings-tab-strip testid — deep-import discipline check.
    const onboardingChunkFiles = files.filter((f: string) =>
      /^(OnboardingLayout|PersonaSelectPage|CenterSetupPage|TemplateSelectPage|ClassSpawnPage|SoloFirstClassPage|OnboardingDonePage)-[\w-]+\.js$/.test(
        f,
      ),
    )
    const dashboardChunkFiles = files.filter((f: string) =>
      /^TeacherDashboard-[\w-]+\.js$/.test(f),
    )
    for (const chunkFile of [...onboardingChunkFiles, ...dashboardChunkFiles]) {
      const content = readFileSync(resolve(DIST_DIR, chunkFile)).toString('utf8')
      expect(
        content,
        `${chunkFile} leaked settings testid "settings-tab-strip"`,
      ).not.toContain('settings-tab-strip')
    }
  })

  test('Story 2-5b — SettingsPage chunk contains terms + rooms tabpanel testids (AC14)', async () => {
    // Story 2-5b AC14. After 2-5b lands, the Terms + Rooms tab body components
    // load-hop into the SettingsPage chunk (via feature-directory deep import,
    // no barrel — same discipline as 2-5a). Positive: the shipped chunk must
    // now contain `settings-tabpanel-terms` + `settings-tabpanel-rooms`
    // testids. Negative: those testids must NOT appear in onboarding /
    // dashboard chunks.
    //
    // Red signal (2026-07-15 expected): as of the ATDD landing, 2-5b ships
    // placeholder testids (`settings-tab-placeholder-terms` etc.) inside the
    // SettingsPage chunk — the tabpanel-terms testid does NOT yet appear.
    // Amelia flips green when `TermCalendarTab.tsx` + `RoomsTab.tsx` land in
    // Task 6 with `data-testid="settings-tabpanel-{terms|rooms}"` on the
    // tabpanel container.
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)

    const settingsChunkFiles = files.filter((f: string) =>
      /^SettingsPage-[\w-]+\.js$/.test(f),
    )
    expect(
      settingsChunkFiles.length,
      'SettingsPage chunk missing from dist/',
    ).toBeGreaterThan(0)

    const settingsContents = settingsChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')

    // Positive: 2-5b tabpanel testids present in the shipped chunk.
    for (const testid of [
      'settings-tabpanel-terms',
      'settings-tabpanel-rooms',
    ]) {
      expect(
        settingsContents,
        `SettingsPage chunk missing 2-5b tabpanel testid "${testid}"`,
      ).toContain(testid)
    }

    // Negative: no cross-chunk leakage into onboarding / dashboard chunks.
    const onboardingChunkFiles = files.filter((f: string) =>
      /^(OnboardingLayout|PersonaSelectPage|CenterSetupPage|TemplateSelectPage|ClassSpawnPage|SoloFirstClassPage|OnboardingDonePage)-[\w-]+\.js$/.test(
        f,
      ),
    )
    const dashboardChunkFiles = files.filter((f: string) =>
      /^TeacherDashboard-[\w-]+\.js$/.test(f),
    )
    for (const chunkFile of [
      ...onboardingChunkFiles,
      ...dashboardChunkFiles,
    ]) {
      const content = readFileSync(resolve(DIST_DIR, chunkFile)).toString(
        'utf8',
      )
      for (const testid of [
        'settings-tabpanel-terms',
        'settings-tabpanel-rooms',
      ]) {
        expect(
          content,
          `${chunkFile} leaked 2-5b settings testid "${testid}"`,
        ).not.toContain(testid)
      }
    }
  })

  test('Story 2-5c — SettingsPage chunk contains Integrations tabpanel + Connect button testids (AC16)', async () => {
    // Story 2-5c AC16. IntegrationsTab.tsx + ConnectGoogleMeetButton land in
    // the SettingsPage chunk (deep import, no barrel — Winston-S3 discipline).
    // Positive: shipped chunk must contain the tabpanel + connect-button
    // testids. Negative: those testids must NOT appear in onboarding /
    // dashboard chunks.
    //
    // Google OAuth libs live in the API tree, NOT the web bundle — the
    // frontend only talks to the API endpoint.
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)

    const settingsChunkFiles = files.filter((f: string) =>
      /^SettingsPage-[\w-]+\.js$/.test(f),
    )
    expect(
      settingsChunkFiles.length,
      'SettingsPage chunk missing from dist/',
    ).toBeGreaterThan(0)

    const settingsContents = settingsChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')

    for (const testid of [
      'settings-tabpanel-integrations',
      'settings-connect-google-meet-button',
    ]) {
      expect(
        settingsContents,
        `SettingsPage chunk missing 2-5c testid "${testid}"`,
      ).toContain(testid)
    }

    const onboardingChunkFiles = files.filter((f: string) =>
      /^(OnboardingLayout|PersonaSelectPage|CenterSetupPage|TemplateSelectPage|ClassSpawnPage|SoloFirstClassPage|OnboardingDonePage)-[\w-]+\.js$/.test(
        f,
      ),
    )
    const dashboardChunkFiles = files.filter((f: string) =>
      /^TeacherDashboard-[\w-]+\.js$/.test(f),
    )
    for (const chunkFile of [
      ...onboardingChunkFiles,
      ...dashboardChunkFiles,
    ]) {
      const content = readFileSync(resolve(DIST_DIR, chunkFile)).toString(
        'utf8',
      )
      for (const testid of [
        'settings-tabpanel-integrations',
        'settings-connect-google-meet-button',
      ]) {
        expect(
          content,
          `${chunkFile} leaked 2-5c settings testid "${testid}"`,
        ).not.toContain(testid)
      }
    }
  })

  test('Story 3.1 — ClassesPage ships its own chunk; classes-page testid absent from onboarding + dashboard + settings chunks', async () => {
    // Story 3.1 Task 7. The /classes index is a dedicated lazy chunk under the
    // AppLayout group (the create/edit form is a Dialog, not a /classes/new
    // child route, so a single boundary covers the feature). Positive: the
    // ClassesPage chunk contains the `classes-page` root testid. Negative: that
    // testid must NOT leak into onboarding / dashboard / settings chunks
    // (deep-import discipline — the feature barrel must not drag ClassesPage in).
    expect(
      existsSync(DIST_DIR),
      'dist/assets/ not built — run `npm run build` before this Playwright spec',
    ).toBe(true)
    const files = readdirSync(DIST_DIR)

    const classesChunkFiles = files.filter((f: string) =>
      /^ClassesPage-[\w-]+\.js$/.test(f),
    )
    expect(
      classesChunkFiles.length,
      'ClassesPage chunk missing from dist/',
    ).toBeGreaterThan(0)

    const classesContents = classesChunkFiles
      .map((f: string) => readFileSync(resolve(DIST_DIR, f)).toString('utf8'))
      .join('\n')
    expect(
      classesContents,
      'ClassesPage chunk missing `classes-page` root testid',
    ).toContain('classes-page')

    const otherChunkFiles = files.filter((f: string) =>
      /^(OnboardingLayout|PersonaSelectPage|CenterSetupPage|TemplateSelectPage|ClassSpawnPage|SoloFirstClassPage|OnboardingDonePage|TeacherDashboard|StudentDashboard|SettingsPage)-[\w-]+\.js$/.test(
        f,
      ),
    )
    for (const chunkFile of otherChunkFiles) {
      const content = readFileSync(resolve(DIST_DIR, chunkFile)).toString('utf8')
      expect(
        content,
        `${chunkFile} leaked classes testid "classes-page"`,
      ).not.toContain('classes-page')
    }
  })
})

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
    await page.waitForLoadState('networkidle')

    const sawAuthLayout = requests.some((url) =>
      /\/AuthLayout-[\w-]+\.js/.test(url),
    )
    const sawLoginPlaceholder = requests.some((url) =>
      /\/LoginPagePlaceholder-[\w-]+\.js/.test(url),
    )
    expect(sawAuthLayout, 'auth layout chunk leaked into /dashboard').toBe(
      false,
    )
    expect(
      sawLoginPlaceholder,
      'login placeholder chunk leaked into /dashboard',
    ).toBe(false)
  })

  test('navigating to /login does NOT request the dashboard chunks', async ({
    page,
  }) => {
    const requests: string[] = []
    page.on('request', (req) => requests.push(req.url()))
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    const sawStudent = requests.some((url) =>
      /\/StudentDashboard-[\w-]+\.js/.test(url),
    )
    const sawTeacher = requests.some((url) =>
      /\/TeacherDashboard-[\w-]+\.js/.test(url),
    )
    expect(sawStudent, 'student dashboard chunk leaked into /login').toBe(false)
    expect(sawTeacher, 'teacher dashboard chunk leaked into /login').toBe(false)
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
      (file) =>
        /MultiTabTestPage|ThemeResolutionPage|__theme-resolution|__multi-tab-test-bait/.test(
          file,
        ),
    )
    expect(
      offending,
      `dev-only files leaked into dist/assets/: ${offending.join(', ')}`,
    ).toEqual([])
    for (const file of files) {
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

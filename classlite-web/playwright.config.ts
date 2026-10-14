import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { sessionSlug } from './tests/e2e/lib/auth-harness'

// Story 11-5a — the committed speaking audio fixture fed to chromium's fake
// audio capture so `MediaRecorder` produces a deterministic non-empty blob
// headless (AC2: a real audio fixture through the real R2 leg, not a no-audio
// fallback). Absolute path (ESM-safe) so the flag resolves regardless of cwd.
const SPEAKING_AUDIO_FIXTURE = fileURLToPath(
  new URL('./tests/e2e/money-path/fixtures/speaking-fixture.wav', import.meta.url),
)
const FAKE_MEDIA_ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${SPEAKING_AUDIO_FIXTURE}`,
]

/**
 * Playwright config.
 *
 * Two test surface families share this config:
 *
 *   A) Cross-subdomain auth foundation (Phase 0.4 / Story 1.5 work)
 *      - Projects: setup / landing / dashboard / cross-subdomain / mobile-*
 *      - Test files under `tests/e2e/`
 *      - Requires dev servers on `*.classlite.localhost` hostnames + a
 *        running, seeded API on :8080 (Story 11-2)
 *      - Real login via `auth.setup.ts` (per-identity storageState)
 *
 *   B) Design system contracts (Story 1.7a — theme + typography resolution)
 *      - Project: `design-system`
 *      - Test files under `e2e/`
 *      - Auto-starts vite dev server on plain localhost:5173
 *      - No auth dependency — exercises a public dev-only route
 *
 * Run a single surface:
 *   npx playwright test --project=design-system
 *   npx playwright test --project=dashboard
 */

const BASE_URL_LANDING =
  process.env.BASE_URL_LANDING ?? 'http://classlite.localhost:4321'
const BASE_URL_DASHBOARD =
  process.env.BASE_URL_DASHBOARD ?? 'http://my.classlite.localhost:5173'
const BASE_URL_DESIGN_SYSTEM =
  process.env.BASE_URL_DESIGN_SYSTEM ?? 'http://localhost:5173'
const BASE_URL_STORYBOOK =
  process.env.BASE_URL_STORYBOOK ?? 'http://127.0.0.1:6006'

// Story 11-2 retired the shared rotating `.playwright/auth.json` stub (the
// family-revocation landmine). Each authenticated project reads a REAL
// per-identity storageState written by `auth.setup.ts`. The tenant-A `teacher`
// state is the shared read-only default for projects whose specs only inspect
// the cookie jar (cross-subdomain) or mint their own fresh per-context session
// (dashboard/role-scope). A persisted token is single-use against the rotating
// refresh endpoint, so a SPA-booting spec must NOT reuse a frozen file — it
// mints fresh via the harness. Run the authenticated lane with `--workers=1`
// (see tests/e2e/README.md + docs/manual-setup.md) so these projects serialize.
const AUTH_STATE_TEACHER = `.playwright/${sessionSlug(
  'SEEDFAKEA',
  'seed-fake-teacher-a@example.test',
)}.json`

export default defineConfig({
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testDir: './tests/e2e',
      testMatch: /.*\.setup\.ts/,
      use: {
        baseURL: BASE_URL_DASHBOARD,
      },
    },
    {
      name: 'landing',
      testDir: './tests/e2e',
      dependencies: ['setup'],
      testMatch: /landing\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL_LANDING,
        storageState: AUTH_STATE_TEACHER,
      },
    },
    {
      name: 'dashboard',
      testDir: './tests/e2e',
      dependencies: ['setup'],
      testMatch: /dashboard\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL_DASHBOARD,
        storageState: AUTH_STATE_TEACHER,
      },
    },
    {
      name: 'cross-subdomain',
      testDir: './tests/e2e',
      dependencies: ['setup'],
      testMatch: /cross-subdomain\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL_DASHBOARD,
        storageState: AUTH_STATE_TEACHER,
      },
    },
    {
      name: 'mobile-safari',
      testDir: './tests/e2e',
      dependencies: ['setup'],
      testMatch: /mobile\/.*\.spec\.ts/,
      use: {
        ...devices['iPhone 13'],
        baseURL: BASE_URL_DASHBOARD,
        storageState: AUTH_STATE_TEACHER,
      },
    },
    {
      name: 'mobile-chrome',
      testDir: './tests/e2e',
      dependencies: ['setup'],
      testMatch: /mobile\/.*\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: BASE_URL_DASHBOARD,
        storageState: AUTH_STATE_TEACHER,
      },
    },
    {
      // Story 11-5a — THE deterministic money-path smoke (real seeded stack).
      // Runs ONLY this spec dir, against a BUILT preview (AC5, not the dev
      // server — OOM budget). Deliberately NO `dependencies: ['setup']`: the
      // lane mints its OWN fresh per-context sessions (auth.setup consumes only
      // teacher+teacher2 and would burn 2 logins this lane never uses, AC5).
      // `retries` is PROJECT-SCOPED CI×1 / local 0 — editing the global l52
      // (CI?2) would regress design-system/storybook-a11y (party-mode Amelia F5).
      // Launches chromium with the fake-media flags so the speaking MediaRecorder
      // captures the committed .wav deterministically (AC2).
      name: 'money-path',
      testDir: './tests/e2e',
      testMatch: /money-path\/.*\.spec\.ts/,
      retries: process.env.CI ? 1 : 0,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL_DASHBOARD,
        launchOptions: { args: FAKE_MEDIA_ARGS },
      },
    },
    {
      // Story 1.7a — design system contract project.
      // Uses plain localhost:5173 to avoid the cross-subdomain wiring; the
      // theme-resolution route is dev-only and does not exercise auth.
      name: 'design-system',
      testDir: './e2e',
      testMatch: /.*\.spec\.ts/,
      // The `storybook/` subdir hosts the storybook-a11y project's specs;
      // exclude here so design-system doesn't try to run them against the
      // vite dev server (they expect Storybook static at :6006).
      testIgnore: /storybook\//,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL_DESIGN_SYSTEM,
      },
    },
    {
      // Story 1d-3 — Storybook a11y runtime contracts (party-mode review
      // 2026-06-21). The Storybook test-runner asserts attribute-presence
      // and axe-static; these specs assert runtime browser behavior that
      // test-runner can't reach: real keyboard focus + tooltip in a11y
      // tree (AC9 — Vietnamese truncation reveal path), real bounding
      // boxes at 375×667 (AC7 + AC8 — touch target + mobile-hides-sidebar).
      // Runs against Storybook static at http://127.0.0.1:6006 — `npm run
      // storybook:build && npm run storybook:serve` pre-flight required, OR
      // the storybook webServer entry below builds + serves automatically.
      name: 'storybook-a11y',
      testDir: './e2e/storybook',
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL_STORYBOOK,
      },
    },
  ],
  // Auto-start a local vite ONLY when no explicit BASE_URL_DESIGN_SYSTEM
  // override is provided. An explicit override (CI preview deployments,
  // staging) always wins; running the server alongside it would race on
  // port 5173 and never reach the override URL.
  //
  // No --host pin: vite defaults to all interfaces, so the same instance
  // serves localhost AND my.classlite.localhost (which both resolve to
  // 127.0.0.1) — the cross-subdomain projects can reuse it without a
  // Host-header rejection.
  // Story 11-5a — when MONEY_PATH_PREVIEW is set (the money-path CI lane), serve
  // ONLY the BUILT Vite preview (AC5) and suppress the dev + storybook servers
  // so nothing else races port 5173. Playwright polls `url` for readiness, so no
  // separate readiness step is needed. The preview must serve under the
  // `*.classlite.localhost` host + proxy `/api` → :8080 — configured in
  // vite.config.ts (`preview.allowedHosts` + `preview.proxy`), so the captured
  // refresh cookie (Domain=.classlite.localhost) carries and every `/api` call
  // (incl. the dev mock-R2 PUT sink) stays same-origin.
  webServer: process.env.MONEY_PATH_PREVIEW
    ? [
        {
          command: 'npm run build && npm run preview',
          url: BASE_URL_DASHBOARD,
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
        },
      ]
    : [
    ...(process.env.BASE_URL_DESIGN_SYSTEM
      ? []
      : [
          {
            command: 'npm run dev -- --port 5173',
            url: BASE_URL_DESIGN_SYSTEM,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
        ]),
    // Storybook static build + serve for the storybook-a11y project.
    // `reuseExistingServer` lets local dev pre-build once and iterate
    // quickly; CI does a fresh build every run. The build is slow
    // (~25s) so timeout is generous.
    ...(process.env.BASE_URL_STORYBOOK
      ? []
      : [
          {
            command:
              'npm run storybook:build && npx http-server storybook-static --port 6006 --silent',
            url: `${BASE_URL_STORYBOOK}/iframe.html`,
            reuseExistingServer: !process.env.CI,
            timeout: 180_000,
          },
        ]),
  ],
})

import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config.
 *
 * Two test surface families share this config:
 *
 *   A) Cross-subdomain auth foundation (Phase 0.4 / Story 1.5 work)
 *      - Projects: setup / landing / dashboard / cross-subdomain / mobile-*
 *      - Test files under `tests/e2e/`
 *      - Requires dev servers on `*.classlite.localhost` hostnames
 *      - Auth stub via `auth.setup.ts`
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

const STORAGE_STATE = '.playwright/auth.json'

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
        storageState: STORAGE_STATE,
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
        storageState: STORAGE_STATE,
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
        storageState: STORAGE_STATE,
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
        storageState: STORAGE_STATE,
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
        storageState: STORAGE_STATE,
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
  webServer: [
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

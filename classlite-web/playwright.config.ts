import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config — cross-subdomain auth foundation (Phase 0.4 / A3).
 *
 * Two main projects:
 *   - `landing`   — visits classlite.app (Astro)
 *   - `dashboard` — visits my.classlite.app (React/Vite)
 *
 * Both depend on a `setup` project that performs login ONCE and persists
 * cookies on the `.classlite.app` Domain so the dashboard project picks up
 * the session without a second login.
 *
 * Local URLs:
 *   - Landing dev server (Astro):   http://classlite.localhost:4321
 *   - Dashboard dev server (Vite):  http://my.classlite.localhost:5173
 *
 * To make `.classlite.localhost` cookies work cross-subdomain, run both
 * dev servers on `*.classlite.localhost` hostnames (browsers treat
 * `*.localhost` as loopback per RFC 6761). The setup project writes a
 * cookie on `.classlite.localhost` so both projects see it.
 *
 * Real environments override BASE_URL_LANDING and BASE_URL_DASHBOARD via
 * env vars (e.g. CI staging).
 */

const BASE_URL_LANDING =
  process.env.BASE_URL_LANDING ?? 'http://classlite.localhost:4321'
const BASE_URL_DASHBOARD =
  process.env.BASE_URL_DASHBOARD ?? 'http://my.classlite.localhost:5173'

const STORAGE_STATE = '.playwright/auth.json'

export default defineConfig({
  testDir: './tests/e2e',
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
      testMatch: /.*\.setup\.ts/,
      use: {
        baseURL: BASE_URL_DASHBOARD,
      },
    },
    {
      name: 'landing',
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
      dependencies: ['setup'],
      testMatch: /cross-subdomain\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // Both base URLs are reachable; tests navigate explicitly via
        // page.goto(BASE_URL_LANDING) and page.goto(BASE_URL_DASHBOARD).
        baseURL: BASE_URL_DASHBOARD,
        storageState: STORAGE_STATE,
      },
    },
    {
      name: 'mobile-safari',
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
      dependencies: ['setup'],
      testMatch: /mobile\/.*\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: BASE_URL_DASHBOARD,
        storageState: STORAGE_STATE,
      },
    },
  ],
})

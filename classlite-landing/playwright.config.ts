import { defineConfig, devices } from '@playwright/test'

/**
 * Story 1.10 Task 9.2. Two projects:
 *
 *   - `desktop` — 1280×800 chromium, the SEO-critical viewport.
 *   - `mobile`  — 390×844 chromium emulating iPhone 14 (project-context UX-4).
 *
 * BaseURL is `http://classlite.localhost:4321` — NOT `localhost` per Murat
 * BLOCKER #3, because `Domain=.classlite.localhost` cookies do not match
 * `localhost`. Local dev requires the `/etc/hosts` entry documented in
 * `docs/landing-deploy.md`.
 *
 * The locale-redirect spec (R-NEW-54 ATDD) needs the CF Pages Function
 * running — that requires `wrangler pages dev` against the built `dist/`.
 * Locally:
 *
 *   npm run build
 *   npx wrangler pages dev dist --port 8788
 *   npx playwright test e2e/locale-redirect.spec.ts
 *
 * The `webServer` config below boots wrangler in CI.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    /* baseURL points at the wrangler dev server below. The `classlite.localhost`
       hostname (not `127.0.0.1`) is required so cookies scoped to
       `Domain=.classlite.localhost` actually attach to outgoing requests —
       browsers refuse to send `.classlite.localhost` cookies on a literal
       IP. Local dev requires the `/etc/hosts` entry mapping
       `classlite.localhost → 127.0.0.1` documented in
       `docs/landing-deploy.md`. P5 from code review 2026-06-30. */
    baseURL: 'http://classlite.localhost:8788',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['iPhone 14'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: [
    {
      // CF Pages Function emulation via wrangler against built `dist/`.
      // Used by `e2e/locale-redirect.spec.ts` (R-NEW-54 ATDD) and
      // `e2e/dashboard-url-validation.spec.ts` (R-NEW-55 child-process tests).
      // `landing.spec.ts` exercises the static pages via the same surface.
      command: 'npx wrangler pages dev dist --port 8788 --ip 127.0.0.1',
      url: 'http://127.0.0.1:8788',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})

import { test as setup } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const STORAGE_STATE = '.playwright/auth.json'

/**
 * auth.setup — runs ONCE before every Playwright run and persists a
 * `.classlite.localhost` (or `.classlite.app` in staging) Domain cookie
 * to STORAGE_STATE so every downstream project (`landing`, `dashboard`,
 * `cross-subdomain`) inherits the session without re-logging-in.
 *
 * REAL LOGIN VS STUB
 *
 * Until Story 1.5 (login API) ships, this setup writes a stub session
 * cookie that mimics the production shape. When 1.5 lands, replace the
 * stub with a real API call that:
 *   1. POSTs to /api/auth/login with seeded test credentials
 *   2. Receives Set-Cookie with Domain=.classlite.app
 *   3. Lets Playwright capture the cookie in the context
 *
 * The storageState file is gitignored — see tests/e2e/.gitignore.
 */

setup('authenticate', async ({ context }) => {
  mkdirSync(dirname(STORAGE_STATE), { recursive: true })

  // STUB session cookie. The Domain is set explicitly so the cookie is
  // visible on both classlite.localhost AND my.classlite.localhost.
  // When Story 1.5 ships, replace this block with a real login request.
  await context.addCookies([
    {
      name: 'classlite_session',
      value: 'stub-session-token-for-phase-0',
      domain: '.classlite.localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      // No `secure` flag in localhost. In staging/production this MUST
      // be true. The real /auth/login handler emits it via Set-Cookie.
    },
    {
      // Language preference cookie shared across the same Domain.
      name: 'lang',
      value: 'en',
      domain: '.classlite.localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ])

  await context.storageState({ path: STORAGE_STATE })
})

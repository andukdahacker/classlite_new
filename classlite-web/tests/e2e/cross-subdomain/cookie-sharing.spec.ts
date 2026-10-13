import { expect, test } from '@playwright/test'
import {
  EXPECTED_COOKIE_DOMAIN,
  REFRESH_COOKIE_NAME,
} from '../lib/auth-harness'

/**
 * Cross-subdomain cookie sharing — proves the real `refresh_token` session
 * (Story 11-2) and the `lang` preference are scoped to `.classlite.localhost`
 * so both `classlite.localhost` (landing) and `my.classlite.localhost`
 * (dashboard) see them.
 *
 * This spec ONLY inspects the cookie jar inherited from `auth.setup.ts`'s
 * persisted storageState — it never navigates the SPA, so it does NOT trigger a
 * boot-refresh and therefore does NOT rotate the single-use refresh token. That
 * is why it may read a persisted state without minting a fresh one.
 *
 * Hard precondition: COOKIE_DOMAIN=.classlite.localhost must be set on the API
 * (and exported in the runner shell). Without it the captured cookie's domain
 * is wrong; we skip-with-reason rather than report a misleading failure so a
 * forgotten env var reads as a skip, not a code regression.
 */
test.describe('cross-subdomain cookie foundation', () => {
  test.skip(
    !process.env.COOKIE_DOMAIN,
    `COOKIE_DOMAIN unset — the authenticated E2E lane requires COOKIE_DOMAIN=${EXPECTED_COOKIE_DOMAIN} on the API and the runner shell`,
  )

  test('refresh_token session cookie is scoped to .classlite.localhost', async ({
    context,
  }) => {
    const cookies = await context.cookies()
    const session = cookies.find((c) => c.name === REFRESH_COOKIE_NAME)

    expect(session, 'refresh_token should be present after auth.setup').toBeDefined()
    expect(session!.domain).toBe(EXPECTED_COOKIE_DOMAIN)
    expect(session!.httpOnly).toBe(true)
    expect(session!.sameSite).toBe('Lax')
  })

  test('language cookie is scoped to .classlite.localhost', async ({ context }) => {
    const cookies = await context.cookies()
    const lang = cookies.find((c) => c.name === 'lang')

    expect(lang, 'lang cookie should be present after auth.setup').toBeDefined()
    expect(lang!.domain).toBe(EXPECTED_COOKIE_DOMAIN)
    expect(lang!.value).toBe('en')
  })

  test('both subdomains can see the refresh_token cookie', async ({ context }) => {
    const landingCookies = await context.cookies('http://classlite.localhost:4321/')
    const dashboardCookies = await context.cookies(
      'http://my.classlite.localhost:5173/',
    )

    const landingSession = landingCookies.find((c) => c.name === REFRESH_COOKIE_NAME)
    const dashboardSession = dashboardCookies.find(
      (c) => c.name === REFRESH_COOKIE_NAME,
    )

    expect(landingSession, 'landing should see refresh_token').toBeDefined()
    expect(dashboardSession, 'dashboard should see refresh_token').toBeDefined()
    // Same jar → identical value. (No fixed stub value is asserted — the real
    // token is opaque and rotates; we only prove both hosts see the same one.)
    expect(landingSession!.value).toBe(dashboardSession!.value)
  })
})

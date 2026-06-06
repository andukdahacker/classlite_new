import { test, expect } from '@playwright/test'

/**
 * Cross-subdomain cookie sharing test — proves the foundation that
 * landing → dashboard SSO works once both dev servers are running.
 *
 * Reads cookies from the browser context (which inherited storageState
 * from auth.setup) and asserts the session + language cookies are
 * present and scoped to `.classlite.localhost` so both subdomains see
 * them.
 *
 * Skips network calls so the test passes even before Astro and Vite
 * dev servers are configured for `*.classlite.localhost`. When Story
 * 1.5 + Epic 1C ship, this file gets a partner test that actually
 * navigates between hostnames and asserts UI state.
 */

test.describe('cross-subdomain cookie foundation', () => {
  test('session cookie is scoped to .classlite.localhost', async ({ context }) => {
    const cookies = await context.cookies()
    const session = cookies.find((c) => c.name === 'classlite_session')

    expect(session, 'session cookie should be present after auth.setup').toBeDefined()
    expect(session!.domain).toBe('.classlite.localhost')
    expect(session!.httpOnly).toBe(true)
    expect(session!.sameSite).toBe('Lax')
  })

  test('language cookie is scoped to .classlite.localhost', async ({ context }) => {
    const cookies = await context.cookies()
    const lang = cookies.find((c) => c.name === 'lang')

    expect(lang, 'lang cookie should be present after auth.setup').toBeDefined()
    expect(lang!.domain).toBe('.classlite.localhost')
    expect(lang!.value).toBe('en')
  })

  test('both subdomains can see the session cookie', async ({ context }) => {
    const landingCookies = await context.cookies('http://classlite.localhost:4321/')
    const dashboardCookies = await context.cookies('http://my.classlite.localhost:5173/')

    const landingSession = landingCookies.find((c) => c.name === 'classlite_session')
    const dashboardSession = dashboardCookies.find((c) => c.name === 'classlite_session')

    expect(landingSession, 'landing should see session cookie').toBeDefined()
    expect(dashboardSession, 'dashboard should see session cookie').toBeDefined()
    expect(landingSession!.value).toBe(dashboardSession!.value)
  })
})

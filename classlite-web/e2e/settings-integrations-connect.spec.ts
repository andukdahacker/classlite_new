/**
 * Story 2-5c — Playwright smoke: Settings → Integrations → Connect flow.
 *
 * Covers AC2 + AC14 + AC18 per Task 8. Uses `page.route()` intercept to stub
 * the authorize endpoint (matching Murat-S4 + John ACCEPT pattern) so the
 * spec doesn't need real Google OAuth infrastructure. The full backend
 * OAuth round-trip is deferred to FU-2-5-N — same session-cache seeding
 * concern as FU-2-4-J.
 *
 * Flow tested:
 *   1. Owner navigates to /settings?tab=integrations
 *   2. IntegrationsTab renders with Meet row in disconnected state
 *   3. Click Connect → useConnectGoogleMeet fires GET .../authorize
 *   4. Spy verifies the request was made + browser navigation intercepted
 *   5. Simulate callback return by navigating to
 *      /settings?tab=integrations&status=connected with sessionStorage marker
 *   6. Assert Sonner success toast + query param stripped + toggle refreshed
 *
 * ATDD contract: this file WILL fail at runtime until the same
 * session-cache seeding infra shipped in FU-2-4-J / FU-2-5-N lands. Marked
 * `test.describe.skip()` per Story 2-4 dashboard-first-run.spec.ts precedent
 * so CI's Playwright project match doesn't trip.
 */
import { expect, test, type Page, type Route } from '@playwright/test'

const CENTER_ID = '11111111-2222-3333-4444-555555555599'
const STUB_AUTHORIZE_URL = 'https://fake-google.local/oauth?state=stub'

async function stubMeetIntegrationBackend(page: Page): Promise<void> {
  await page.route(`**/api/centers/${CENTER_ID}/integrations/google-meet/authorize`,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            authorizeUrl: STUB_AUTHORIZE_URL,
            expiresAt: '2026-07-16T13:00:00.000Z',
          },
          meta: { serverTime: '2026-07-16T12:00:00.000Z' },
        }),
      })
    },
  )
  // Center profile handler — Meet disconnected on first load.
  await page.route(`**/api/centers/${CENTER_ID}`, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: CENTER_ID,
          name: 'Saigon English Center',
          shortCode: 'saigon-english-center',
          contactEmail: null,
          // eslint-disable-next-line no-restricted-syntax -- brand-color wire value fixture (FU-2-3a-C)
          brandColor: '#1e3a8a',
          logoUrl: null,
          timezone: 'Asia/Ho_Chi_Minh',
          googleMeetConnected: false,
          createdAt: '2026-07-01T09:00:00.000Z',
        },
        meta: { serverTime: '2026-07-16T12:00:00.000Z' },
      }),
    })
  })
}

test.describe.skip('Story 2-5c — Settings Integrations Connect flow (FU-2-5-N session-cache infra pending)', () => {
  test('Owner clicks Connect → authorize URL requested → browser navigation intercepted', async ({
    page,
  }) => {
    await stubMeetIntegrationBackend(page)

    // Intercept the browser navigation to Google so the test stays put.
    let assignedUrl: string | null = null
    await page.exposeFunction('__captureAssign', (url: string) => {
      assignedUrl = url
    })
    await page.addInitScript(() => {
      const original = window.location.assign
      Object.defineProperty(window.location, 'assign', {
        writable: true,
        value: (url: string) => {
          // @ts-expect-error injected by exposeFunction above
          window.__captureAssign(url)
        },
      })
      // Reference `original` so it's not tree-shaken.
      void original
    })

    await page.goto('/settings?tab=integrations')

    const connectBtn = page.getByTestId('settings-connect-google-meet-button')
    await expect(connectBtn).toBeVisible()
    await connectBtn.click()

    await expect
      .poll(() => assignedUrl, { timeout: 5_000 })
      .toBe(STUB_AUTHORIZE_URL)
  })

  test('Callback return with sessionStorage marker fires success toast + strips query param', async ({
    page,
  }) => {
    await stubMeetIntegrationBackend(page)
    // Seed the in-flight marker as if Connect had just fired.
    await page.addInitScript(() => {
      window.sessionStorage.setItem('meet-connect-in-flight', '1')
    })

    await page.goto('/settings?tab=integrations&status=connected')

    // Success toast should surface (Sonner renders with role="status").
    await expect(page.getByRole('status')).toContainText(/Google Meet connected/i)

    // Query param should be stripped by useLayoutEffect replace-navigate.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('status'))
      .toBeNull()
  })
})

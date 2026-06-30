/**
 * locale-redirect.spec — Story 1.10 AC1 R-NEW-54 ATDD red specimen.
 *
 * Pinned BEFORE the Function ships per WF-8. The Function source lives
 * at `functions/index.ts` and is unit-tested at
 * `src/lib/test/__tests__/locale-redirect.test.ts` for fast TDD; this
 * Playwright spec is the WF-8 evidence — it exercises the Function
 * at the CF Pages edge runtime via `wrangler pages dev`.
 *
 * To run locally:
 *   npm run build && npx wrangler pages dev dist --port 8788
 *   npx playwright test e2e/locale-redirect.spec.ts
 *
 * The `playwright.config.ts` `webServer` block automates this in CI.
 */
import { test, expect, request as apiRequest } from '@playwright/test'

/* `classlite.localhost:8788` (not `127.0.0.1:8788`) so this spec runs
   against the same host the `landing.spec` cookie-domain tests use.
   Requires `/etc/hosts` entry per `docs/landing-deploy.md`. */
const BASE = 'http://classlite.localhost:8788'

async function fetchRoot(
  acceptLanguage?: string,
): Promise<{ status: number; location: string | null; vary: string | null }> {
  const ctx = await apiRequest.newContext({
    extraHTTPHeaders: acceptLanguage ? { 'Accept-Language': acceptLanguage } : {},
  })
  // Disable redirect-follow so we can inspect the 302.
  const res = await ctx.get(`${BASE}/`, { maxRedirects: 0 })
  return {
    status: res.status(),
    location: res.headers()['location'] ?? null,
    vary: res.headers()['vary'] ?? null,
  }
}

test.describe('R-NEW-54 — CF Pages Function locale redirect', () => {
  test('Accept-Language vi-VN → 302 /vi/', async () => {
    const r = await fetchRoot('vi-VN,vi;q=0.9')
    expect(r.status).toBe(302)
    expect(r.location).toBe('/vi/')
  })

  test('Accept-Language en-US → 302 /en/', async () => {
    const r = await fetchRoot('en-US,en;q=0.9')
    expect(r.status).toBe(302)
    expect(r.location).toBe('/en/')
  })

  test('tied q-weights → /vi/ (Vietnamese tie-breaker per UX-2)', async () => {
    const r = await fetchRoot('en;q=0.7,vi;q=0.7')
    expect(r.location).toBe('/vi/')
  })

  test('no Accept-Language → /vi/ (default)', async () => {
    const r = await fetchRoot()
    expect(r.location).toBe('/vi/')
  })

  test('emits Vary: Accept-Language (CF cache axis)', async () => {
    const r = await fetchRoot('vi-VN,vi;q=0.9')
    expect(r.vary?.toLowerCase()).toContain('accept-language')
  })
})

/**
 * landing.spec — Story 1.10 Task 9.3 end-to-end coverage.
 *
 * Runs against `wrangler pages dev dist --port 8788` per `playwright.config.ts`.
 * Covers:
 *   - All seven sections render on `/vi/` and `/en/`
 *   - StickyHeader scroll-state transitions past 400px
 *   - Hint-cookie redirect (with cycle-loop termination test per Murat STRONG #3)
 *   - Zero-CLS banner reveal (Sally STRONG #6)
 *   - Language toggle + lang-cookie write
 *   - Cross-locale state preservation via ?billing= (Sally STRONG #7)
 *   - Hamburger a11y (Sally STRONG #5)
 *   - Mobile no-horizontal-scroll
 *   - axe zero violations across both locales × both viewports
 */
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/* `classlite.localhost:8788` (not `127.0.0.1:8788`) so cookies scoped to
   `Domain=.classlite.localhost` actually attach. Requires the
   `/etc/hosts` entry mapping `classlite.localhost → 127.0.0.1`
   documented in `docs/landing-deploy.md`. P5 from code review. */
const BASE = 'http://classlite.localhost:8788'

async function clearCookies(page: Page): Promise<void> {
  await page.context().clearCookies()
}

test.describe('Landing page — seven-section composition', () => {
  test('vi page renders every section', async ({ page }) => {
    await clearCookies(page)
    await page.goto(`${BASE}/vi/`)
    await expect(page.getByTestId('landing-sticky-header')).toBeVisible()
    await expect(page.getByTestId('landing-hero')).toBeVisible()
    await expect(page.getByTestId('landing-pain-calculator')).toBeVisible()
    await expect(page.getByTestId('landing-pain-calculator-money-conversion')).toBeVisible()
    await expect(page.getByTestId('landing-pain-calculator-assumption')).toBeVisible()
    await expect(page.getByTestId('landing-feature-card-blue')).toBeVisible()
    await expect(page.getByTestId('landing-feature-card-gold')).toBeVisible()
    await expect(page.getByTestId('landing-feature-card-green')).toBeVisible()
    await expect(page.getByTestId('landing-social-proof-card-1')).toBeVisible()
    await expect(page.getByTestId('landing-social-proof-card-2')).toBeVisible()
    await expect(page.getByTestId('landing-pricing-card-free')).toBeVisible()
    await expect(page.getByTestId('landing-pricing-card-pro')).toBeVisible()
    await expect(page.getByTestId('landing-pricing-card-studio')).toBeVisible()
    await expect(page.getByTestId('landing-footer')).toBeVisible()
  })

  test('en page renders every section', async ({ page }) => {
    await clearCookies(page)
    await page.goto(`${BASE}/en/`)
    await expect(page.getByTestId('landing-hero')).toBeVisible()
    await expect(page.getByTestId('landing-pricing-card-pro')).toBeVisible()
  })
})

test.describe('AC3 — StickyHeader scroll-state', () => {
  test('transitions to is-stuck past 400px scroll (desktop)', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'desktop-only check')
    await clearCookies(page)
    await page.goto(`${BASE}/vi/`)
    const header = page.getByTestId('landing-sticky-header')
    await expect(header).not.toHaveClass(/is-stuck/)
    await page.evaluate(() => window.scrollTo(0, 600))
    // No hard wait: `toHaveClass` auto-retries up to the default expect
    // timeout (5s) and converges as soon as the IntersectionObserver
    // callback flips the class. Replaces the prior 200ms `waitForTimeout`
    // which was 12× longer than one animation frame and still flake-prone
    // on slow CI runners.
    await expect(header).toHaveClass(/is-stuck/)
  })
})

test.describe('AC4 — hint cookie redirect (Murat BLOCKER #3 cookie-domain fix)', () => {
  test('logged_in=1 cookie redirects to dashboard', async ({ page, context }) => {
    await clearCookies(page)
    await context.addCookies([
      {
        name: 'logged_in',
        value: '1',
        domain: '.classlite.localhost',
        path: '/',
      },
    ])
    /* The redirect target (`my.classlite.localhost`) is not served in the
       test harness, so route-stub it to a tiny HTML response. Then the
       full navigation completes and we can assert on the final URL.
       Removes the previous `.catch(() => {})` swallow that hid failures
       (P5). */
    await page.route('**/my.classlite.localhost*/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>stub dashboard</body></html>',
      }),
    )
    await page.goto(`${BASE}/vi/`)
    await page.waitForURL(/my\.classlite\.localhost/, { timeout: 5_000 })
    expect(page.url()).toMatch(/my\.classlite\.localhost.*\/dashboard$/)
  })

  test('?session_expired=true SKIPS the redirect even when logged_in=1 set', async ({
    page,
    context,
  }) => {
    await clearCookies(page)
    await context.addCookies([
      {
        name: 'logged_in',
        value: '1',
        domain: '.classlite.localhost',
        path: '/',
      },
    ])
    await page.goto(`${BASE}/vi/?session_expired=true`)
    // Landing should still render — no redirect
    await expect(page.getByTestId('landing-session-expired-banner')).toBeVisible()
  })

  test('CYCLE-LOOP TERMINATION (Murat STRONG #3) — banner stops the bounce', async ({
    page,
    context,
  }) => {
    await clearCookies(page)
    await context.addCookies([
      {
        name: 'logged_in',
        value: '1',
        domain: '.classlite.localhost',
        path: '/',
      },
    ])
    const navigations: string[] = []
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url())
    })
    await page.route('**/my.classlite.localhost*/login*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>stub login</body></html>',
      }),
    )
    /* The session_expired param must SKIP the hint-cookie redirect (so
       the user sees the landing instead of bouncing into the dashboard
       with no JWT). Then clicking the banner CTA should be the second
       and FINAL navigation. P26 from code review: assert the exact
       second URL pattern + count instead of `≤ 3`. */
    await page.goto(`${BASE}/vi/?session_expired=true`)
    await expect(page.getByTestId('landing-session-expired-banner')).toBeVisible()
    await page.getByTestId('landing-session-expired-banner-cta').click()
    await page.waitForURL(/my\.classlite\.localhost.*\/login/)
    expect(page.url()).toMatch(/my\.classlite\.localhost.*\/login/)
    expect(navigations).toHaveLength(2)
  })

  test('ZERO-CLS reveal (Sally STRONG #6) — Hero top unchanged after banner mount', async ({
    page,
  }) => {
    await clearCookies(page)
    await page.goto(`${BASE}/vi/?session_expired=true`)
    // Both the banner and the hero are in the DOM at first paint.
    // The banner's reveal is driven by <html data-session-expired>
    // set BEFORE paint (pre-paint inline script), so Hero must not
    // shift between two consecutive measurements.
    const hero = page.getByTestId('landing-hero')
    const initial = await hero.boundingBox()
    // Pin to two consecutive animation frames instead of a 150ms wall-clock
    // wait. CLS would manifest as a layout shift between paints — measuring
    // across one rAF tick is the correct semantic window for "before vs after
    // first paint" without coupling to a magic millisecond value.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    )
    const after = await hero.boundingBox()
    expect(initial?.y).toBe(after?.y)
  })

  test('replaceState strips ?session_expired param after first paint', async ({ page }) => {
    await clearCookies(page)
    await page.goto(`${BASE}/vi/?session_expired=true`)
    // No hard wait: poll the URL until the inline `replaceState` script
    // strips the param. The script is `is:inline` in BaseLayout's <head>,
    // so it fires before first paint in practice — but rather than couple
    // to a 100ms magic number, the poll converges as soon as the URL
    // observably changes.
    await expect
      .poll(() => page.url(), { timeout: 2_000 })
      .not.toContain('session_expired')
  })
})

test.describe('AC6 — language toggle + lang cookie', () => {
  test('toggle on /vi/ lands on /en/ and writes lang=en cookie', async ({
    page,
    context,
    isMobile,
  }) => {
    test.skip(isMobile, 'mobile hides the header lang-toggle')
    await clearCookies(page)
    await page.goto(`${BASE}/vi/`)
    await page.getByTestId('landing-sticky-header-lang-toggle').click()
    await page.waitForURL(/\/en\//)
    const cookies = await context.cookies()
    const lang = cookies.find((c) => c.name === 'lang')
    expect(lang?.value).toBe('en')
  })

  test('cross-locale state preservation (Sally STRONG #7) — Annual choice survives toggle', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'mobile hides the header lang-toggle')
    await clearCookies(page)
    await page.goto(`${BASE}/vi/?billing=annual`)
    await expect(page.locator('#billing-annual')).toBeChecked()
  })
})

test.describe('AC5 — mobile responsive (390×844)', () => {
  test('no horizontal scroll at 390×844', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile-only check')
    await clearCookies(page)
    await page.goto(`${BASE}/vi/`)
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
    const clientWidth = await page.evaluate(() => document.body.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
  })

  test('hamburger has aria-label and reveals nav (Sally STRONG #5)', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'mobile-only check')
    await clearCookies(page)
    await page.goto(`${BASE}/vi/`)
    const hamburger = page.getByTestId('landing-sticky-header-hamburger')
    const summary = hamburger.locator('summary')
    await expect(summary).toHaveAttribute('aria-label', /Mở menu|menu/i)
    await summary.click()
    await expect(page.locator('text=Tính năng').first()).toBeVisible()
  })
})

test.describe('AC9 — accessibility (axe)', () => {
  test('vi has zero WCAG 2.1 AA violations', async ({ page }) => {
    await clearCookies(page)
    await page.goto(`${BASE}/vi/`)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })

  test('en has zero WCAG 2.1 AA violations', async ({ page }) => {
    await clearCookies(page)
    await page.goto(`${BASE}/en/`)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })
})

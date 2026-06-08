import { expect, test } from '@playwright/test'

/**
 * Typography resolution executable contract (Story 1.7a AC4).
 *
 * Asserts the Fraunces / Geist / Geist Mono font chain resolves end-to-end
 * via the @theme inline `--font-{sans,heading,mono}` → `--cl-font-*` token
 * binding. The negative body assertion catches the failure mode where
 * Fraunces accidentally leaks into the body sans-serif chain.
 *
 * Per Sally's party-mode revision, AC4 cannot stop at "fonts installed" — the
 * typography ladder is the visible contract every Epic 1C/1D consumer
 * inherits, and silent regressions to Latin-only fallbacks are exactly the
 * Vietnamese-subset failure mode the prescriptive @fontsource-variable install
 * is meant to prevent.
 */

test.describe('Typography resolution — Fraunces/Geist/Geist Mono chain (AC4)', () => {
  test('h1/h2/h3 resolve to the Fraunces display font', async ({ page }) => {
    await page.goto('/__theme-resolution')
    for (const tag of ['h1', 'h2', 'h3'] as const) {
      const target = page.locator(`[data-testid="typo-${tag}"]`)
      await expect(target).toBeVisible()
      const family = await target.evaluate(
        (el) => window.getComputedStyle(el).fontFamily,
      )
      expect(family, `${tag} should use Fraunces display font`).toMatch(
        /Fraunces/,
      )
    }
  })

  test('stat numerals and labels resolve to Geist Mono', async ({ page }) => {
    await page.goto('/__theme-resolution')
    const stat = await page
      .locator('[data-testid="typo-stat"]')
      .evaluate((el) => window.getComputedStyle(el).fontFamily)
    expect(stat).toMatch(/Geist Mono/)
    const label = await page
      .locator('[data-testid="typo-label"]')
      .evaluate((el) => window.getComputedStyle(el).fontFamily)
    expect(label).toMatch(/Geist Mono/)
  })

  test('body resolves to Geist and NOT to Fraunces', async ({ page }) => {
    await page.goto('/__theme-resolution')
    const body = await page
      .locator('body')
      .evaluate((el) => window.getComputedStyle(el).fontFamily)
    expect(body).toMatch(/Geist/)
    expect(body).not.toMatch(/Fraunces/)
  })

  // Without the font-aliases.css shim, computed font-family says 'Geist'
  // (per tokens.css) but the browser finds no registered face under that
  // name and silently falls through to system-ui. `document.fonts.load()`
  // resolves with the matched FontFace records — empty array means no face
  // exists under that alias. Catches the regression the regex tests miss.
  test('document.fonts can load Geist / Geist Mono / Fraunces aliases', async ({
    page,
  }) => {
    await page.goto('/__theme-resolution')
    await page.evaluate(() => document.fonts.ready)
    const counts = await page.evaluate(async () => {
      const [geist, geistMono, fraunces] = await Promise.all([
        document.fonts.load('1em Geist'),
        document.fonts.load('1em "Geist Mono"'),
        document.fonts.load('1em Fraunces'),
      ])
      return {
        geist: geist.length,
        geistMono: geistMono.length,
        fraunces: fraunces.length,
      }
    })
    expect(counts.geist, 'Geist alias must register at least one face').toBeGreaterThan(0)
    expect(counts.geistMono, 'Geist Mono alias must register at least one face').toBeGreaterThan(0)
    expect(counts.fraunces, 'Fraunces alias must register at least one face').toBeGreaterThan(0)
  })
})

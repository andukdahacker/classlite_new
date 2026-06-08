import { expect, test } from '@playwright/test'

/**
 * Theme resolution executable contract (Story 1.7a AC3).
 *
 * Asserts that the shadcn theme bridge resolves every load-bearing primitive
 * through the --cl-* token chain instead of the default oklch neutrals from
 * `npx shadcn init`. Four orthogonal token resolution paths are exercised:
 *
 *   1) Button default       → --primary           (--cl-ink)
 *   2) Button destructive   → --destructive       (--cl-red)
 *   3) Input border + focus → --input + --ring    (--cl-line-interactive, --cl-accent)
 *   4) Card surface         → --card + --card-foreground + --radius-lg
 *                                                 (--cl-surface, --cl-ink, 10px)
 *   5) Dialog overlay       → --popover + --popover-foreground
 *                                                 (--cl-surface, --cl-ink)
 *
 * Per Murat's party-mode revision, a Button-only test exercises ONLY --primary
 * and misses three of the four orthogonal paths. If --input or --card breaks
 * during the rewire but --primary works, the test still passes green and every
 * downstream Epic 2 form inherits broken focus rings. Covering all four catches
 * the entire silent-miswire class at the foundation layer.
 *
 * Token-value cite-check (assertions traced to tokens.css):
 *   --cl-ink            #1a1f2e → rgb(26, 31, 46)
 *   --cl-red            #991b1b → rgb(153, 27, 27)
 *   --cl-line-interactive #a8a095 → rgb(168, 160, 149)
 *   --cl-accent         #1e3a8a → rgb(30, 58, 138)
 *   --cl-surface        #ffffff → rgb(255, 255, 255)
 *   --cl-radius-sm      6px (button + input)
 *   --cl-radius-lg      10px (card)
 */

test.describe('Theme resolution — shadcn primitives bind to --cl-* tokens (AC3)', () => {
  test('Button default — --primary resolves to --cl-ink', async ({ page }) => {
    await page.goto('/__theme-resolution')
    const target = page.locator('[data-testid="btn-default"]')
    await expect(target).toBeVisible()

    const bg = await target.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    )
    expect(bg).toBe('rgb(26, 31, 46)')

    const radius = await target.evaluate(
      (el) => window.getComputedStyle(el).borderRadius,
    )
    expect(radius).toBe('6px')
  })

  test('Button destructive — --destructive resolves to --cl-red', async ({
    page,
  }) => {
    await page.goto('/__theme-resolution')
    const target = page.locator('[data-testid="btn-destructive"]')
    await expect(target).toBeVisible()

    // shadcn base-nova "destructive" variant renders red text on a tinted bg.
    // The token binding under test is the chain --destructive → --cl-red,
    // exposed via the text color in this variant.
    const color = await target.evaluate(
      (el) => window.getComputedStyle(el).color,
    )
    expect(color).toBe('rgb(153, 27, 27)')
  })

  test('Input — --input border + --ring focus outline bind correctly', async ({
    page,
  }) => {
    await page.goto('/__theme-resolution')
    const target = page.locator('[data-testid="input-default"]')
    await expect(target).toBeVisible()

    const borderColor = await target.evaluate(
      (el) => window.getComputedStyle(el).borderTopColor,
    )
    expect(borderColor).toBe('rgb(168, 160, 149)')

    await target.focus()
    const outlineColor = await target.evaluate(
      (el) => window.getComputedStyle(el).outlineColor,
    )
    expect(outlineColor).toBe('rgb(30, 58, 138)')
  })

  test('Card — --card bg + --card-foreground text + --radius-lg (10px)', async ({
    page,
  }) => {
    await page.goto('/__theme-resolution')
    const card = page.locator('[data-testid="card-default"]')
    await expect(card).toBeVisible()

    expect(
      await card.evaluate((el) => window.getComputedStyle(el).backgroundColor),
    ).toBe('rgb(255, 255, 255)')
    expect(
      await card.evaluate((el) => window.getComputedStyle(el).color),
    ).toBe('rgb(26, 31, 46)')
    expect(
      await card.evaluate((el) => window.getComputedStyle(el).borderRadius),
    ).toBe('10px')
  })

  test('Dialog overlay — --popover bg + --popover-foreground text', async ({
    page,
  }) => {
    await page.goto('/__theme-resolution')
    await page.locator('[data-testid="dialog-trigger"]').click()
    const overlay = page.locator('[data-testid="dialog-content"]')
    await expect(overlay).toBeVisible()

    expect(
      await overlay.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      ),
    ).toBe('rgb(255, 255, 255)')
    expect(
      await overlay.evaluate((el) => window.getComputedStyle(el).color),
    ).toBe('rgb(26, 31, 46)')
  })
})

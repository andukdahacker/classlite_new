/**
 * TopbarShell mobile pattern + collapse-toggle runtime contracts
 * (Story 1d-3 code-review D1 + D2 follow-up).
 *
 * Background: D1 added a `collapseToggle?` slot to `TopbarShell` so
 * `AppLayout` can wire a desktop-only hamburger to `useUIStore`. D2
 * shipped the AC8 mobile pattern — eyebrow row + optional title row
 * beneath, with the search slot hidden below `md` and the collapse
 * toggle hidden below `md`. Storybook's test-runner ignores
 * `parameters.viewport`, so the CSF play functions can only smoke
 * mount/presence; the responsive swap must be verified at a real
 * viewport. This spec runs the relevant stories at 375×667 (mobile)
 * and 1024×768 (desktop) and asserts the layout reflows correctly.
 */
import { expect, test } from '@playwright/test'

const COLLAPSE_TOGGLE_STORY =
  '/iframe.html?id=domain-topbarshell--with-collapse-toggle&viewMode=story'
const MOBILE_TITLE_STORY =
  '/iframe.html?id=domain-topbarshell--with-mobile-title&viewMode=story'

test.describe('TopbarShell collapse toggle — desktop only (D1)', () => {
  test('hamburger button is laid out at desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(COLLAPSE_TOGGLE_STORY)

    const toggle = page.getByTestId('sidebar-collapse-toggle')
    await toggle.waitFor({ state: 'attached' })
    const box = await toggle.boundingBox()
    expect(
      box !== null && box.width > 0 && box.height > 0,
      `collapse toggle should be painted on desktop (got box=${JSON.stringify(box)})`,
    ).toBe(true)
  })

  test('hamburger button is NOT laid out at mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto(COLLAPSE_TOGGLE_STORY)

    const toggle = page.getByTestId('sidebar-collapse-toggle')
    await toggle.waitFor({ state: 'attached' })
    const box = await toggle.boundingBox()
    // Wrapper carries `hidden md:flex` — at <768px the slot resolves to
    // display:none. Either null bounding box OR zero-width signals "not
    // painted" — both acceptable AT contracts. Single assertion that
    // counts both branches.
    expect(
      box === null || box.width === 0,
      `collapse toggle should not be painted on mobile (got box=${JSON.stringify(box)})`,
    ).toBe(true)
  })
})

test.describe('TopbarShell mobile eyebrow + title pattern (D2)', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('eyebrow row and mobile title row are both visible at mobile viewport', async ({
    page,
  }) => {
    await page.goto(MOBILE_TITLE_STORY)

    // Eyebrow row carries `text-xs uppercase tracking-wide` below `md`
    // and normal text above. The wrapper exists in the DOM at every
    // viewport (responsive utilities reflow the typography rather than
    // toggle the element). The contract for AC8 is: at mobile, the
    // mobile-title row is laid out beneath.
    const eyebrow = page.getByTestId('topbar-eyebrow')
    await expect(eyebrow).toBeVisible()

    // Mobile title row carries `md:hidden` — only painted below `md`.
    // At 375×667 it MUST be laid out.
    const mobileTitle = page.getByTestId('topbar-mobile-title')
    const titleBox = await mobileTitle.boundingBox()
    expect(
      titleBox !== null && titleBox.width > 0 && titleBox.height > 0,
      `mobile title should be painted at 375px (got box=${JSON.stringify(titleBox)})`,
    ).toBe(true)
  })

  test('search slot is NOT painted at mobile viewport', async ({ page }) => {
    await page.goto(MOBILE_TITLE_STORY)
    const search = page.getByTestId('search-pill')
    await search.waitFor({ state: 'attached' })
    // Search wrapper is `hidden md:flex`; below `md`, the wrapper
    // resolves to display:none. boundingBox should be null OR width 0.
    const box = await search.boundingBox()
    expect(
      box === null || box.width === 0,
      `search pill should not be painted on mobile (got box=${JSON.stringify(box)})`,
    ).toBe(true)
  })
})

test.describe('TopbarShell mobile title is hidden on desktop (D2)', () => {
  test('mobile title row is NOT painted at desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(MOBILE_TITLE_STORY)

    const mobileTitle = page.getByTestId('topbar-mobile-title')
    await mobileTitle.waitFor({ state: 'attached' })
    const box = await mobileTitle.boundingBox()
    // The mobile-title row carries `md:hidden` — desktop hides it via
    // display:none. Either null or zero-size signals "not painted."
    expect(
      box === null || box.width === 0 || box.height === 0,
      `mobile title should not be painted on desktop (got box=${JSON.stringify(box)})`,
    ).toBe(true)
  })
})

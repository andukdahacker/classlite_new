/**
 * SidebarNavItem keyboard-focus tooltip reveal (Story 1d-3 AC9 — closing
 * the gap surfaced by party-mode review 2026-06-21).
 *
 * Background: the Storybook test-runner play function for the
 * `LongVietnameseLabel` story originally used `userEvent.tab() +
 * toHaveFocus()` to verify the focus-reveals-tooltip contract. Amelia
 * removed both assertions during dev citing base-ui Tooltip `_r_b_`
 * portal-wrapper interference — the play function now only asserts
 * `aria-label` + `title` attribute presence. That covers the
 * screen-reader user and the no-JS fallback, but leaves Sally's
 * keyboard-sighted user path (Vietnamese teacher Tab-navigating
 * at 220px) unverified.
 *
 * This spec restores the contract at the Playwright layer where base-ui
 * portals work correctly. WCAG 2.1.1 says ALL operable elements must be
 * keyboard accessible — for the truncated Vietnamese label, "operable"
 * means the user can discover the full label without a mouse.
 *
 * Assertion shape:
 *   1. Open the LongVietnameseLabel story at locale=vi.
 *   2. Press Tab until focus lands on the nav link.
 *   3. Assert the tooltip is visible in the accessibility tree containing
 *      the full Vietnamese label ("Trung tâm kiến thức").
 *   4. The aria-label + native `title` attribute checks already covered
 *      by Storybook's play function are NOT duplicated here — that gap
 *      is closed by the existing CSF coverage.
 */
import { expect, test } from '@playwright/test'

const STORY_PATH =
  '/iframe.html?id=domain-sidebarnavitem--long-vietnamese-label&viewMode=story&globals=locale:vi'

test.describe('SidebarNavItem — Vietnamese truncation keyboard reveal', () => {
  test('Tab-focusing the nav link opens the tooltip with the full Vietnamese label', async ({
    page,
  }) => {
    await page.goto(STORY_PATH)

    // The link is the only interactive element in the story; wait for it
    // to attach so we don't tab into a half-rendered iframe.
    const link = page.getByTestId('sidebar-nav-knowledge-hub')
    await link.waitFor({ state: 'attached' })

    // Belt-check: the aria-label is the full Vietnamese string. This
    // covers the screen-reader path.
    await expect(link).toHaveAttribute('aria-label', 'Trung tâm kiến thức')

    // Tab through the body until focus lands on the link. The body has
    // no other tabbables in this story, so one Tab from `<body>` should
    // do it; if base-ui inserts a focusable shim we'll keep tabbing up
    // to a sensible cap.
    let attempts = 0
    while (attempts < 5) {
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(
        (testId) => document.activeElement?.getAttribute('data-testid') === testId,
        'sidebar-nav-knowledge-hub',
      )
      if (focused) break
      attempts += 1
    }
    expect(attempts).toBeLessThan(5)

    // The tooltip is portaled out of the link to `<body>`. base-ui's
    // Popup does NOT set `role="tooltip"`; instead it carries
    // `data-slot="tooltip-content"`. Wait for it to materialize and
    // assert its visible text is the full Vietnamese label — this is
    // the keyboard-sighted-user reveal path.
    const tooltip = page.locator('[data-slot="tooltip-content"]')
    await expect(tooltip).toBeVisible({ timeout: 2000 })
    await expect(tooltip).toHaveText('Trung tâm kiến thức')
  })
})

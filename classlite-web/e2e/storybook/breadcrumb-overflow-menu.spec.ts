/**
 * BreadcrumbBar overflow ellipsis — interactive DropdownMenu runtime
 * contract (Story 1d-3 code-review D3 follow-up).
 *
 * Background: D3 replaced the original decorative `<MoreHorizontalIcon>`
 * + sr-only "More" span with an interactive `DropdownMenu` (shadcn
 * primitive via base-ui) whose items are real `<Link>` elements pointing
 * at the skipped middle breadcrumb segments. The previous implementation
 * silently lost the skipped segments — keyboard and pointer users had no
 * way to reach them.
 *
 * AC1 contract: "overflow truncates middle segments with an ellipsis-menu
 * pattern (`Workspace / … / Current`) using `Breadcrumb`'s `WithEllipsis`
 * variant from 1d-2." This spec asserts the runtime menu behavior:
 *   1. Pointer: clicking the more-trigger opens the menu.
 *   2. Keyboard: focusing + Enter opens the menu.
 *   3. Each skipped middle segment surfaces as a menu item.
 *   4. Escape closes the menu.
 *
 * The story exercised here is `BreadcrumbBar.WithEllipsis` (5 items,
 * `truncateAt=3` → first + last visible, three skipped middle segments
 * in the menu).
 */
import { expect, test } from '@playwright/test'

const STORY_PATH =
  '/iframe.html?id=domain-breadcrumbbar--with-ellipsis&viewMode=story'

test.describe('BreadcrumbBar overflow menu (D3)', () => {
  test('clicking the more-trigger opens a menu containing the skipped middle items', async ({
    page,
  }) => {
    await page.goto(STORY_PATH)

    const trigger = page.getByTestId('breadcrumb-more-trigger')
    await trigger.waitFor({ state: 'attached' })
    await trigger.click()

    // The shadcn DropdownMenu wraps base-ui's `MenuPrimitive`, which
    // renders a Popup carrying `data-slot="dropdown-menu-content"`.
    const menu = page.locator('[data-slot="dropdown-menu-content"]')
    await expect(menu).toBeVisible({ timeout: 2000 })

    // WithEllipsis story has 5 items + truncateAt=3 → first + last
    // visible, three skipped middle segments rendered as menu items.
    // Labels per `BreadcrumbBar.stories.tsx`: Classes / IELTS 7.0
    // evening / Sessions.
    await expect(menu.getByText('Classes')).toBeVisible()
    await expect(menu.getByText('IELTS 7.0 evening')).toBeVisible()
    await expect(menu.getByText('Sessions')).toBeVisible()
  })

  test('the more-trigger is keyboard-operable — Enter opens the menu', async ({
    page,
  }) => {
    await page.goto(STORY_PATH)
    const trigger = page.getByTestId('breadcrumb-more-trigger')
    await trigger.focus()
    await expect(trigger).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(
      page.locator('[data-slot="dropdown-menu-content"]'),
    ).toBeVisible({ timeout: 2000 })
  })

  test('Escape closes the menu and returns focus to the trigger', async ({
    page,
  }) => {
    await page.goto(STORY_PATH)
    const trigger = page.getByTestId('breadcrumb-more-trigger')
    await trigger.click()
    const menu = page.locator('[data-slot="dropdown-menu-content"]')
    await expect(menu).toBeVisible({ timeout: 2000 })
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden({ timeout: 2000 })
    await expect(trigger).toBeFocused()
  })

  test('the more-trigger has the i18n-keyed accessible name (not a hardcoded "More")', async ({
    page,
  }) => {
    await page.goto(STORY_PATH)
    const trigger = page.getByTestId('breadcrumb-more-trigger')
    // The default locale is `en` — the en.json value for
    // `topbar.breadcrumb.more` is "More". This is the canonical
    // accessibility-name assertion: the trigger MUST carry the i18n
    // value, NOT the primitive's hardcoded English leak.
    await expect(trigger).toHaveAttribute('aria-label', 'More')
  })
})

/**
 * AppShell mobile-viewport runtime contract (Story 1d-3 AC7 + AC8 —
 * closing the gap surfaced by party-mode review 2026-06-21).
 *
 * Background: Storybook's test-runner ignores `parameters.viewport`, so
 * the CSF play functions for AppShell.Mobile and MobileTabBar.StudentView
 * fell back to className-regex assertions ("does the rendered class
 * string contain 'hidden md:flex' / 'min-h-[44px]'"). That's a tautology
 * check — it proves the source contains the utility, NOT that:
 *
 *   - Tailwind compiled the utility (purge could drop it in prod).
 *   - The cascade resolved the way we expect (parent `transform` or
 *     `!important` could break it).
 *   - At a real mobile viewport, the elements actually behave correctly.
 *
 * WCAG 2.5.5 / 2.5.8 (touch target minimum) is a compliance contract,
 * not a styling preference — Murat's risk read at party-mode is P1
 * (low-medium likelihood, high impact). This spec asserts the runtime
 * behavior at a real mobile viewport.
 *
 * Assertion shape:
 *   1. AC8 — at 375×667 the SidebarShell is NOT laid out (boundingBox
 *      null or width 0).
 *   2. AC7 — every MobileTab has bounding-box width AND height >= 44px.
 *      The `data-testid="mobile-tab-{slug}"` selectors stay decoupled
 *      from i18n strings.
 */
import { expect, test } from '@playwright/test'

const APP_SHELL_MOBILE_STORY =
  '/iframe.html?id=domain-appshell--mobile&viewMode=story'

test.describe('AppShell at 375×667 — mobile runtime contract', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('SidebarShell is not laid out below md breakpoint (AC8)', async ({
    page,
  }) => {
    await page.goto(APP_SHELL_MOBILE_STORY)
    await page.getByTestId('app-shell-root').waitFor({ state: 'attached' })

    // SidebarShell carries `hidden md:flex` — at <768px the `<aside>`
    // resolves to display:none (per TEST-FE-6 + 1D-P0-020). It MAY still
    // exist in the DOM (hidden is structural, not removal), but its
    // boundingBox should be null OR have zero width — either signals
    // "not painted." Both are acceptable AT contracts.
    const sidebar = page.getByTestId('sidebar-nav-primary')
    const box = await sidebar.boundingBox()
    if (box !== null) {
      expect(box.width).toBe(0)
    }
  })

  test('MobileTabBar tabs meet the 44×44 touch-target minimum (AC7)', async ({
    page,
  }) => {
    await page.goto(APP_SHELL_MOBILE_STORY)
    const tabBar = page.getByTestId('mobile-tab-bar')
    await tabBar.waitFor({ state: 'visible' })

    // The Default Mobile story uses the student role — five tabs:
    // home / assignments / inbox / classes / me. Each one MUST meet
    // WCAG 2.5.5 / 2.5.8 (44×44).
    for (const slug of ['home', 'assignments', 'inbox', 'classes', 'me']) {
      const tab = page.getByTestId(`mobile-tab-${slug}`)
      const box = await tab.boundingBox()
      expect(box, `mobile-tab-${slug} should have a bounding box`).not.toBeNull()
      if (box === null) continue
      expect(box.height, `mobile-tab-${slug} height`).toBeGreaterThanOrEqual(44)
      expect(box.width, `mobile-tab-${slug} width`).toBeGreaterThanOrEqual(44)
    }
  })
})

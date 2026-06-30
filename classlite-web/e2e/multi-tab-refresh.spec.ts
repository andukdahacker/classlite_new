/**
 * AC4 — Multi-tab `navigator.locks` + `BroadcastChannel` coordination.
 *
 * Two tabs hitting 401 simultaneously must produce exactly ONE
 * `/api/auth/refresh` call across both tabs. Without the
 * `navigator.locks.request` gate (or the `lastRefreshedAt` debounce
 * inside it) the second tab burns the refresh token that the first
 * just rotated, the server treats the reuse as a token-theft signal,
 * and the user gets logged out for "suspicious activity" they never
 * caused.
 *
 * This is the only test that exercises the cross-tab `BroadcastChannel`
 * path — Vitest can simulate the in-process coalesce but not two real
 * tabs. The dev-only `/__multi-tab-test-bait` route is the mount surface
 * (DEV-gated via `import.meta.env.DEV` in routes.tsx; the Task 11.7 grep
 * gate verifies the route is absent from `dist/`).
 */
import { expect, test } from '@playwright/test'

test.describe('Multi-tab refresh coordination (AC4 / UX-DR19)', () => {
  test('two tabs hitting 401 simultaneously fire ONE /api/auth/refresh', async ({
    browser,
  }) => {
    let refreshCount = 0
    const context = await browser.newContext()

    await context.route('**/api/auth/refresh', async (route) => {
      refreshCount++
      await new Promise((resolve) => setTimeout(resolve, 150))
      await route.fulfill({ status: 200 })
    })
    await context.route('**/api/__bait', async (route) => {
      await route.fulfill({ status: 401 })
    })

    const page1 = await context.newPage()
    const page2 = await context.newPage()

    await Promise.all([
      page1.goto('/__multi-tab-test-bait'),
      page2.goto('/__multi-tab-test-bait'),
    ])

    await Promise.all([
      page1.locator('[data-testid="fire-bait"]').click(),
      page2.locator('[data-testid="fire-bait"]').click(),
    ])

    // Wait deterministically for the FIRST refresh to fire (the route
    // injects 150ms latency so this resolves once the in-flight call has
    // landed). Replaces the prior `waitForLoadState('networkidle')` —
    // unreliable in an SPA where HMR / app polling keep the connection
    // counter non-zero.
    await expect
      .poll(() => refreshCount, {
        timeout: 5_000,
        message: 'expected at least one refresh to fire across two tabs',
      })
      .toBeGreaterThanOrEqual(1)

    // Bounded race observation. The coalesce window is the 150ms route
    // delay PLUS the in-process lock release; if a second refresh is
    // going to slip past the `navigator.locks` + `lastRefreshedAt`
    // debounce, it lands inside this window. Using a deliberately
    // bounded wait here (not as a deterministic signal) is OK — the
    // load-bearing assertion right after is what catches a coalesce
    // regression.
    await page1.waitForTimeout(300)

    // The load-bearing assertion: across two tabs, exactly one network
    // refresh fires. Coalescing is enforced by `navigator.locks` +
    // `lastRefreshedAt` debounce in src/lib/auth-refresh.ts.
    expect(refreshCount).toBe(1)

    await context.close()
  })
})

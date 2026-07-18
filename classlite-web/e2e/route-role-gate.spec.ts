/**
 * Story 2.6 (AC12) — Playwright role-gate smoke.
 *
 * Ships as `test.describe.skip()` per FU-2-5-N session-cache infra gap
 * (the same skip precedent used by Story 2-4 dashboard-first-run.spec.ts
 * and Story 2-5c settings-integrations-connect.spec.ts). The assertion
 * shape is green; the real run unblocks when the E2E session-cache
 * seed harness (FU-2-5-N) lands.
 *
 * Scenarios (skipped):
 *   1. Owner navigates to /settings → SettingsPage renders (tab strip
 *      visible; PermissionDenied section header absent).
 *   2. Teacher navigates to /settings → PermissionDenied renders with
 *      the Settings section header; tab strip absent.
 *   3. Admin navigates to /settings → same as Teacher (Owner-only route).
 *   4. Student navigates to /settings → same as Teacher.
 *   5. Boot probe stalled + user visits /settings → the
 *      "Checking access..." card renders (RouteAccessCheckingCard);
 *      neither the SettingsPage tab strip nor PermissionDenied render.
 */
import { test, expect } from '@playwright/test'

// Seed helper — placeholder until FU-2-5-N ships. Real implementation
// will hydrate the QueryClient's `['auth', 'session']` slot before the
// route-level `<RouteRoleGate>` reads it.
async function seedSessionRole(): Promise<void> {
  // NOTE: intentional no-op — see file header for the FU-2-5-N pointer.
  //
  // When the harness lands, this helper will:
  //   1. Set the refresh-token cookie via a test-only /api/__test/seed
  //      endpoint (or bypass the /login POST via cookies.setCookie).
  //   2. Populate localStorage with `classlite_last_refreshed_at` so the
  //      boot-probe debounce short-circuits.
  //   3. Call queryClient.setQueryData([...], { role: '<seeded>' }) via
  //      an exposed test-window seam.
}

test.describe.skip('Story 2.6 — Route role gate (FU-2-5-N session-cache infra pending)', () => {
  test('Owner sees /settings tab strip', async ({ page }) => {
    await seedSessionRole()
    await page.goto('/settings')
    await expect(page.getByTestId('settings-tab-strip')).toBeVisible()
    await expect(
      page.getByTestId('permission-denied-section-header'),
    ).toHaveCount(0)
  })

  test('Teacher hitting /settings sees PermissionDenied with Settings header', async ({
    page,
  }) => {
    await seedSessionRole()
    await page.goto('/settings')
    await expect(page.getByTestId('settings-tab-strip')).toHaveCount(0)
    const header = page.getByTestId('permission-denied-section-header')
    await expect(header).toBeVisible()
  })

  test('Admin hitting /settings sees PermissionDenied (Owner-only route)', async ({
    page,
  }) => {
    await seedSessionRole()
    await page.goto('/settings')
    await expect(page.getByTestId('settings-tab-strip')).toHaveCount(0)
    await expect(
      page.getByTestId('permission-denied-section-header'),
    ).toBeVisible()
  })

  test('Student hitting /settings sees PermissionDenied', async ({ page }) => {
    await seedSessionRole()
    await page.goto('/settings')
    await expect(page.getByTestId('settings-tab-strip')).toHaveCount(0)
    await expect(
      page.getByTestId('permission-denied-section-header'),
    ).toBeVisible()
  })

  test('Boot probe in flight — RouteAccessCheckingCard renders (Winston-STRONG-3)', async ({
    page,
  }) => {
    // TODO(FU-2-5-N): stall /api/auth/refresh so the probe stays in
    // flight while the assertion runs. Placeholder — the shape below
    // is what the real run will assert once the harness supports it.
    await page.goto('/settings')
    await expect(page.getByTestId('route-role-gate-checking')).toBeVisible()
    await expect(page.getByTestId('settings-tab-strip')).toHaveCount(0)
    await expect(
      page.getByTestId('permission-denied-section-header'),
    ).toHaveCount(0)
  })
})

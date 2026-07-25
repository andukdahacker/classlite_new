/**
 * Story 2.7 (AC1/AC3/AC5) — Bulk Student Import E2E (Journey J14).
 *
 * Ships as `test.describe.skip()` — the SAME infra-pending precedent used by
 * route-role-gate.spec.ts (FU-2-5-N session-cache seed) and
 * settings-integrations-connect.spec.ts. Two things must land before these run:
 *   1. The `/students/import` route + `features/people/ImportStudentsPage`
 *      (story Tasks 8/9) — the page under test does not exist yet.
 *   2. The FU-2-5-N E2E session-cache seed harness (owner/admin/student roles)
 *      + an R2 presign stub so the browser PUT resolves offline.
 *
 * The assertion SHAPE is authored green so activation is a one-line
 * `.skip → ''` flip per scenario once the harness lands. Selectors follow the
 * story's Task 8 test-ids (dropzone, preview table, aria-live summary banner,
 * confirm button, result roster, error-report download).
 *
 * SCENARIOS
 *   J14-001  owner imports a clean 50-row CSV → preview → confirm → result
 *            roster shows 50 persisted students (self-verification surface).
 *   J14-002  dupes + malformed rows → partial preview (Confirm ENABLED with
 *            error rows) → confirm → downloadable error-report CSV.
 *   J14-004  re-import the same file → idempotent (no duplicate rows in the
 *            result roster).
 *   ROLE-GATE  a student navigating to /students/import is route-gated
 *            (PermissionDenied; the importer UI is absent from the DOM).
 */
import { test, expect, type Page } from '@playwright/test'

const IMPORT_ROUTE = '/students/import'

// Seed helper — placeholder until FU-2-5-N ships (mirrors route-role-gate.spec.ts).
// Real impl hydrates the QueryClient ['auth','session'] slot with the given role
// and short-circuits the boot-probe debounce.
async function seedSessionRole(_page: Page, _role: 'owner' | 'admin' | 'student'): Promise<void> {
  // intentional no-op — see file header (FU-2-5-N).
}

// uploadFixture — placeholder for the presign→PUT→confirm upload the dropzone
// drives. Real impl sets an input[type=file] to a generated CSV blob and stubs
// the R2 presign PUT so the browser upload resolves offline.
async function uploadImportCsv(_page: Page, _rows: number, _opts?: { dupes?: boolean; malformed?: boolean }): Promise<void> {
  // intentional no-op — see file header.
}

test.describe.skip('Story 2.7 — Bulk student import (route + FU-2-5-N infra pending)', () => {
  test('J14-001 — owner imports a clean 50-row CSV end to end', async ({ page }) => {
    await seedSessionRole(page, 'owner')
    await page.goto(IMPORT_ROUTE)

    // Dropzone visible in its idle state.
    await expect(page.getByTestId('import-dropzone')).toBeVisible()

    await uploadImportCsv(page, 50)

    // Preview renders: 50 importable rows, summary banner announces the split.
    const banner = page.getByTestId('import-summary-banner')
    await expect(banner).toHaveAttribute('role', 'status')
    await expect(banner).toContainText('50')
    await expect(page.getByTestId('import-preview-row')).toHaveCount(50)

    // Confirm is enabled and commits.
    const confirm = page.getByTestId('import-confirm-button')
    await expect(confirm).toBeEnabled()
    await confirm.click()

    // Result screen self-verifies the persisted roster (s42 does not exist yet).
    await expect(page.getByTestId('import-result-roster-row')).toHaveCount(50)
  })

  test('J14-002 — dupes + malformed → partial import → error-report CSV', async ({ page }) => {
    await seedSessionRole(page, 'owner')
    await page.goto(IMPORT_ROUTE)
    await uploadImportCsv(page, 46, { dupes: true, malformed: true })

    // Summary banner shows the partial split; error rows carry accessible labels.
    const banner = page.getByTestId('import-summary-banner')
    await expect(banner).toContainText('skip')
    const errorRow = page.getByTestId('import-preview-row').filter({ hasText: 'error' }).first()
    await expect(errorRow).toBeVisible()

    // Confirm stays ENABLED with error rows present (partial-import contract, AC3).
    const confirm = page.getByTestId('import-confirm-button')
    await expect(confirm).toBeEnabled()
    await confirm.click()

    // Downloadable error report lists the failed rows.
    const download = page.waitForEvent('download')
    await page.getByTestId('import-error-report-download').click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.csv$/)
  })

  test('J14-004 — re-importing the same file is idempotent', async ({ page }) => {
    await seedSessionRole(page, 'owner')
    await page.goto(IMPORT_ROUTE)

    await uploadImportCsv(page, 10)
    await page.getByTestId('import-confirm-button').click()
    await expect(page.getByTestId('import-result-roster-row')).toHaveCount(10)

    // Second identical import — no new students created; roster reflects skips.
    await page.goto(IMPORT_ROUTE)
    await uploadImportCsv(page, 10)
    await page.getByTestId('import-confirm-button').click()
    await expect(page.getByTestId('import-result-skipped-count')).toContainText('10')
  })
})

test.describe.skip('Story 2.7 — /students/import role gate (FU-2-5-N infra pending)', () => {
  test('student cannot reach the importer — PermissionDenied, importer absent from DOM', async ({
    page,
  }) => {
    await seedSessionRole(page, 'student')
    await page.goto(IMPORT_ROUTE)

    // Route-gated: the PermissionDenied surface renders...
    await expect(page.getByTestId('permission-denied-section-header')).toBeVisible()
    // ...and the importer UI is ABSENT from the DOM (not merely hidden) — TEST-FE-6.
    await expect(page.getByTestId('import-dropzone')).toHaveCount(0)
    await expect(page.getByTestId('import-confirm-button')).toHaveCount(0)
  })
})

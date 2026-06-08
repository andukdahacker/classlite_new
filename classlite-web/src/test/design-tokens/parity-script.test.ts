/// <reference types="node" />
/**
 * Counter-fixture for AC2 (tokens.css parity enforcement) of Story 1.7a.
 *
 * Closes Murat's score-9 risk that "manual PR-description verification is a
 * vibe, not a test." Drives the sync mechanism the CI step uses:
 *
 *   bash scripts/sync-tokens.sh
 *   git diff --exit-code -- classlite-landing/src/styles/tokens.css
 *
 * Test 1 simulates the CI failure-mode the parity step is designed to catch:
 * a PR that edits dashboard tokens.css but forgets to run sync. The test
 * mutates the DASHBOARD source (not landing); sync propagates the new value
 * to landing's working tree, and `git diff -- landing` sees the working-tree
 * change against landing.HEAD and exits non-zero.
 *
 * An earlier version of this test mutated landing instead. That variant
 * only passed when the working tree was already dirty (uncommitted dashboard
 * changes made the diff non-zero by accident). On a clean post-merge
 * checkout, sync would overwrite landing back to landing.HEAD, the diff
 * would return 0, and the assertion `expect(...).not.toBe(0)` would fail.
 *
 * Both tests ALWAYS restore in `finally`. `afterAll` restores both files
 * even if a test body throws before reaching the inner try.
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
)
const DASHBOARD_TOKENS = resolve(REPO_ROOT, 'classlite-web/src/tokens.css')
const LANDING_TOKENS = resolve(
  REPO_ROOT,
  'classlite-landing/src/styles/tokens.css',
)
const ORIGINAL_DASHBOARD = readFileSync(DASHBOARD_TOKENS, 'utf8')
const ORIGINAL_LANDING = readFileSync(LANDING_TOKENS, 'utf8')

function runSyncAndDiffExitCode(): number {
  try {
    execSync(
      `bash scripts/sync-tokens.sh && git diff --exit-code -- classlite-landing/src/styles/tokens.css`,
      { cwd: REPO_ROOT, stdio: 'pipe' },
    )
    return 0
  } catch (err) {
    const status = (err as { status?: number }).status
    return typeof status === 'number' ? status : 1
  }
}

afterAll(() => {
  writeFileSync(DASHBOARD_TOKENS, ORIGINAL_DASHBOARD, 'utf8')
  writeFileSync(LANDING_TOKENS, ORIGINAL_LANDING, 'utf8')
})

describe('sync-tokens.sh + git diff parity check (AC2)', () => {
  test('the parity pair exits non-zero when dashboard tokens.css drifts ahead of landing', () => {
    try {
      const drifted = ORIGINAL_DASHBOARD.replace(
        '--cl-ink: #1a1f2e;',
        '--cl-ink: #000000;',
      )
      expect(drifted).not.toBe(ORIGINAL_DASHBOARD)
      writeFileSync(DASHBOARD_TOKENS, drifted, 'utf8')
      expect(runSyncAndDiffExitCode()).not.toBe(0)
    } finally {
      writeFileSync(DASHBOARD_TOKENS, ORIGINAL_DASHBOARD, 'utf8')
      writeFileSync(LANDING_TOKENS, ORIGINAL_LANDING, 'utf8')
    }
  })

  test('sync-tokens.sh restores landing parity with the dashboard source', () => {
    try {
      const drifted = ORIGINAL_LANDING.replace(
        '--cl-ink: #1a1f2e;',
        '--cl-ink: #000000;',
      )
      writeFileSync(LANDING_TOKENS, drifted, 'utf8')
      execSync('bash scripts/sync-tokens.sh', { cwd: REPO_ROOT, stdio: 'pipe' })
      const dashboardSource = readFileSync(DASHBOARD_TOKENS, 'utf8')
      const landingAfter = readFileSync(LANDING_TOKENS, 'utf8')
      expect(landingAfter).toBe(dashboardSource)
    } finally {
      writeFileSync(LANDING_TOKENS, ORIGINAL_LANDING, 'utf8')
    }
  })
})

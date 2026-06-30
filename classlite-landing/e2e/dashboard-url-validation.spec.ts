/**
 * dashboard-url-validation.spec — Story 1.10 AC7 R-NEW-55 ATDD red
 * specimen. Pinned BEFORE the validator ships per WF-8.
 *
 * Invokes `astro build` as a child process with a phishing
 * `PUBLIC_DASHBOARD_URL` and asserts the build exits non-zero with the
 * R-NEW-55 error. The validator at `scripts/validate-dashboard-url.mjs`
 * is wired as `prebuild`, so a bad URL stops the build before any
 * static HTML lands in `dist/`.
 *
 * The fast unit-test surface for the same logic lives at
 * `src/lib/test/__tests__/validate-dashboard-url.test.ts`.
 */
import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const LANDING_ROOT = join(dirname(__filename), '..')

function runValidator(env: Record<string, string>): {
  status: number
  stderr: string
} {
  const result = spawnSync(
    'node',
    [join(LANDING_ROOT, 'scripts/validate-dashboard-url.mjs')],
    {
      env: { ...process.env, ...env },
      cwd: LANDING_ROOT,
      encoding: 'utf8',
    },
  )
  return { status: result.status ?? 0, stderr: result.stderr ?? '' }
}

test.describe('R-NEW-55 — PUBLIC_DASHBOARD_URL allowlist', () => {
  test('production build with phishing URL fails non-zero with R-NEW-55 error', () => {
    const r = runValidator({
      NODE_ENV: 'production',
      PUBLIC_DASHBOARD_URL: 'https://phishing-classlite.example.com',
    })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('R-NEW-55')
  })

  test('production build with https://my.classlite.app passes', () => {
    const r = runValidator({
      NODE_ENV: 'production',
      PUBLIC_DASHBOARD_URL: 'https://my.classlite.app',
    })
    expect(r.status).toBe(0)
  })

  test('dev build with http://my.classlite.localhost:5173 passes', () => {
    const r = runValidator({
      NODE_ENV: 'development',
      PUBLIC_DASHBOARD_URL: 'http://my.classlite.localhost:5173',
    })
    expect(r.status).toBe(0)
  })

  test('dev build with http://localhost:5173 fails (allowlist mismatch)', () => {
    const r = runValidator({
      NODE_ENV: 'development',
      PUBLIC_DASHBOARD_URL: 'http://localhost:5173',
    })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('R-NEW-55')
  })
})

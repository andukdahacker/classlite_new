/**
 * validate-dashboard-url — Story 1.10 AC7 R-NEW-55 unit-test surface.
 *
 * Spawns `scripts/validate-dashboard-url.mjs` with controlled env vars
 * and asserts the exit code + stderr message. Faster than the
 * Playwright e2e (`e2e/dashboard-url-validation.spec.ts`); the e2e is
 * the WF-8 ATDD evidence and exercises the same script via Playwright.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const VALIDATOR = join(
  dirname(__filename),
  '../../../..',
  'scripts/validate-dashboard-url.mjs',
)

/* P23 from code review 2026-06-30 — the previous tests ran with the
   process default CWD (the landing project root), so the validator's
   `.env.production` fallback path resolved to the real file in the
   repo. The "empty env var" test passed locally because the file
   exists with a valid URL; on a fresh CI clone or contributor laptop
   without `.env.production`, that test would either fail (file
   missing) or pass for the wrong reason. The fix: spawn the
   validator with `cwd` set to a tmpdir for every test, so the
   `.env`/`.env.production` lookup is isolated from the repo. The
   spec lookup still resolves `VALIDATOR` absolutely. */
let cwd: string

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'classlite-validate-url-'))
})

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true })
})

afterEach(() => {
  /* Remove any .env files a test wrote so the next test starts from a
     clean slate. */
  for (const name of ['.env', '.env.production']) {
    const path = join(cwd, name)
    if (existsSync(path)) unlinkSync(path)
  }
})

function writeEnvFile(name: '.env' | '.env.production', body: string): void {
  writeFileSync(join(cwd, name), body, 'utf8')
}

function run(env: Record<string, string>): {
  status: number
  stderr: string
} {
  const result = spawnSync('node', [VALIDATOR], {
    env: { ...process.env, ...env, LANDING_ROOT: cwd },
    encoding: 'utf8',
  })
  return { status: result.status ?? 0, stderr: result.stderr ?? '' }
}

describe('validate-dashboard-url — R-NEW-55 allowlist', () => {
  test('NODE_ENV=production + https://my.classlite.app → pass', () => {
    const r = run({
      NODE_ENV: 'production',
      PUBLIC_DASHBOARD_URL: 'https://my.classlite.app',
    })
    expect(r.status).toBe(0)
  })

  test('NODE_ENV=production + phishing URL → fail with R-NEW-55', () => {
    const r = run({
      NODE_ENV: 'production',
      PUBLIC_DASHBOARD_URL: 'https://phishing-classlite.example.com',
    })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('R-NEW-55')
  })

  test('NODE_ENV=production + http (not https) → fail', () => {
    const r = run({
      NODE_ENV: 'production',
      PUBLIC_DASHBOARD_URL: 'http://my.classlite.app',
    })
    expect(r.status).not.toBe(0)
  })

  test('NODE_ENV=development + http://my.classlite.localhost:5173 → pass', () => {
    const r = run({
      NODE_ENV: 'development',
      PUBLIC_DASHBOARD_URL: 'http://my.classlite.localhost:5173',
    })
    expect(r.status).toBe(0)
  })

  test('NODE_ENV=development + http://localhost:5173 → fail (not in allowlist)', () => {
    const r = run({
      NODE_ENV: 'development',
      PUBLIC_DASHBOARD_URL: 'http://localhost:5173',
    })
    expect(r.status).not.toBe(0)
  })

  test('NODE_ENV unset → defaults to development behavior', () => {
    const r = run({
      NODE_ENV: '',
      PUBLIC_DASHBOARD_URL: 'http://my.classlite.localhost:5173',
    })
    expect(r.status).toBe(0)
  })

  test('empty PUBLIC_DASHBOARD_URL env var falls back to .env.production (intentional)', () => {
    /* The validator falls back to .env.production when the env var is
       empty — that's the documented dev/preview pattern (Winston
       STRONG #8 branch-to-env mapping). P23 isolates this test from
       the repo's real .env.production by writing the file into the
       tmpdir referenced by LANDING_ROOT. */
    writeEnvFile('.env.production', 'PUBLIC_DASHBOARD_URL=https://my.classlite.app\n')
    const r = run({
      NODE_ENV: 'production',
      PUBLIC_DASHBOARD_URL: '',
    })
    expect(r.status).toBe(0)
  })

  test('quoted PUBLIC_DASHBOARD_URL in .env.production passes the allowlist (P7)', () => {
    /* `.env` files commonly quote values; the previous parser kept the
       quotes and the regex rejected the value with a misleading
       "allowlist mismatch" error. */
    writeEnvFile(
      '.env.production',
      'PUBLIC_DASHBOARD_URL="https://my.classlite.app"\n',
    )
    const r = run({
      NODE_ENV: 'production',
      PUBLIC_DASHBOARD_URL: '',
    })
    expect(r.status).toBe(0)
  })

  test('`export PUBLIC_DASHBOARD_URL=…` form in .env is accepted (P7)', () => {
    writeEnvFile(
      '.env',
      'export PUBLIC_DASHBOARD_URL=http://my.classlite.localhost:5173\n',
    )
    const r = run({
      NODE_ENV: 'development',
      PUBLIC_DASHBOARD_URL: '',
    })
    expect(r.status).toBe(0)
  })

  test('trailing whitespace / CRLF on the env var is trimmed (P7)', () => {
    const r = run({
      NODE_ENV: 'production',
      PUBLIC_DASHBOARD_URL: 'https://my.classlite.app\r\n',
    })
    expect(r.status).toBe(0)
  })

  test('both env var AND .env.production absent → fail with R-NEW-55', () => {
    const r = run({
      NODE_ENV: 'production',
      PUBLIC_DASHBOARD_URL: '',
    })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('R-NEW-55')
  })

  test('NODE_ENV=test is recognised as development (P25)', () => {
    const r = run({
      NODE_ENV: 'test',
      PUBLIC_DASHBOARD_URL: 'http://my.classlite.localhost:5173',
    })
    expect(r.status).toBe(0)
  })

  test('NODE_ENV=staging is not a recognised allowlist target (P25)', () => {
    const r = run({
      NODE_ENV: 'staging',
      PUBLIC_DASHBOARD_URL: 'https://my.classlite.app',
    })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/not a recognised allowlist target/i)
  })
})

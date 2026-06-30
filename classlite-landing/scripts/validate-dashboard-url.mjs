#!/usr/bin/env node
/**
 * validate-dashboard-url — Story 1.10 AC7 R-NEW-55 mitigation.
 *
 * Wired as `prebuild` in package.json so `astro build` cannot run
 * without it passing. Production mode requires the URL to match the
 * production allowlist; dev mode allows the localhost surface only.
 * A staging misconfig pointing PUBLIC_DASHBOARD_URL at a phishing
 * clone would fail the build here — closes the open-redirect surface
 * Amelia BLOCKER #7 + Murat R-NEW-55 surfaced.
 *
 * ≤25 lines per AC7 spec (script body, excluding the comment block).
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PROD_ALLOW = /^https:\/\/my\.classlite\.app$/
const DEV_ALLOW = /^https?:\/\/my\.classlite\.localhost(:\d+)?$/

const rawEnv = process.env.NODE_ENV || 'development'
/* `vitest run` sets NODE_ENV=test by default, which would silently
   fall through to DEV_ALLOW and pass on a misconfigured URL. Treat
   `test` as dev explicitly so the intent is in the code, not implicit
   in the regex. P25 from code review 2026-06-30. */
const env = rawEnv === 'test' ? 'development' : rawEnv
const isProd = env === 'production'
const KNOWN_ENVS = ['production', 'development']
if (!KNOWN_ENVS.includes(env)) {
  console.error(
    `\n❌ R-NEW-55: NODE_ENV "${rawEnv}" is not a recognised allowlist target.\n` +
      `   Recognised: production, development (test → development).\n`,
  )
  process.exit(1)
}

// Load the appropriate .env file ourselves — astro's env loader runs
// AFTER prebuild, so the validator can't rely on import.meta.env.
// Mirrors the CF Pages branch-to-env mapping documented in
// docs/landing-deploy.md (production → .env.production; preview → .env).
const HERE = dirname(fileURLToPath(import.meta.url))
/* `LANDING_ROOT` lets tests override the project root used to look up
   `.env` / `.env.production`. P23 from code review 2026-06-30 — the
   test suite passes a tmpdir so the lookup doesn't leak the repo's
   real `.env.production`. Defaults to one level above this script. */
const ROOT = process.env.LANDING_ROOT || join(HERE, '..')
const envFile = isProd ? '.env.production' : '.env'
const envPath = join(ROOT, envFile)
const fromFile = {}
function stripWrappingQuotes(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1)
    }
  }
  return value
}
if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    /* P7 — trim CR (Windows line endings, CI shell heredocs) and
       optional `export ` prefix for source-friendly .env files; strip
       matching surrounding `"`/`'` quotes after `=`. */
    const trimmed = rawLine.replace(/\r$/, '').trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const stripped = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed
    const eq = stripped.indexOf('=')
    if (eq === -1) continue
    const key = stripped.slice(0, eq).trim()
    const value = stripWrappingQuotes(stripped.slice(eq + 1).trim())
    fromFile[key] = value
  }
}
const rawUrl = process.env.PUBLIC_DASHBOARD_URL || fromFile.PUBLIC_DASHBOARD_URL
const url = typeof rawUrl === 'string' ? rawUrl.trim() : rawUrl
const allow = isProd ? PROD_ALLOW : DEV_ALLOW
const allowSrc = isProd ? PROD_ALLOW.source : DEV_ALLOW.source

if (!url) {
  console.error(
    `\n❌ R-NEW-55: PUBLIC_DASHBOARD_URL is unset (NODE_ENV=${env}).\n` +
      `   Set in .env (dev) or .env.production (prod), or via CI env.\n`,
  )
  process.exit(1)
}

if (!allow.test(url)) {
  console.error(
    `\n❌ R-NEW-55: PUBLIC_DASHBOARD_URL "${url}" does not match allowlist for NODE_ENV=${env}.\n` +
      `   Expected: /${allowSrc}/\n` +
      `   Either reject the misconfig (most likely cause: staging deploy with wrong env var)\n` +
      `   OR update the allowlist regex in scripts/validate-dashboard-url.mjs with PM sign-off.\n`,
  )
  process.exit(1)
}

console.log(`✅ R-NEW-55: PUBLIC_DASHBOARD_URL "${url}" matches ${env} allowlist.`)

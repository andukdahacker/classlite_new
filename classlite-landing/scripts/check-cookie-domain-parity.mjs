#!/usr/bin/env node
/**
 * check-cookie-domain-parity — Story 1.10 Task 9.7 (Winston STRONG #3).
 *
 * The landing site cannot import from `classlite-web/` (WF-7 cross-
 * service ban), so `BaseLayout.astro`'s inline lang-cookie script
 * embeds a byte-identical copy of `computeCookieDomain` between
 * `/* CL-COOKIE-DOMAIN-PARITY-START / END * /` sentinel comments.
 * This script extracts both bodies and asserts byte-identity. Drift
 * fails CI with a readable diff so a future engineer who modifies
 * `cookie-domain.ts` can't ship without mirroring it into landing.
 *
 * Replaces "documentation is enforcement" hope with an actual ratchet.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const LANDING_ROOT = join(HERE, '..')
const REPO_ROOT = join(LANDING_ROOT, '..')

const DASHBOARD_PATH = join(REPO_ROOT, 'classlite-web/src/lib/cookie-domain.ts')
const LANDING_PATH = join(LANDING_ROOT, 'src/layouts/BaseLayout.astro')

const SENTINEL_RE =
  /\/\*\s*CL-COOKIE-DOMAIN-PARITY-START\s*\*\/([\s\S]*?)\/\*\s*CL-COOKIE-DOMAIN-PARITY-END\s*\*\//

function fail(message) {
  console.error(`\n❌ check-cookie-domain-parity FAILED:\n   ${message}\n`)
  process.exit(1)
}

function extractBetweenSentinels(path) {
  if (!existsSync(path)) {
    fail(`File not found: ${path}`)
  }
  const src = readFileSync(path, 'utf8')
  const match = src.match(SENTINEL_RE)
  if (!match) {
    fail(
      `Sentinel comments not found in ${relative(REPO_ROOT, path)}.\n` +
        `   Expected /* CL-COOKIE-DOMAIN-PARITY-START */ … /* CL-COOKIE-DOMAIN-PARITY-END */.`,
    )
  }
  return match[1]
}

// The dashboard's TS version uses TS-only syntax (`function name(): string | null`).
// The landing copy is plain JS (`function name()`). Normalize before comparing —
// the contract is the BODY logic, not the surface annotation.
function normalize(body) {
  return body
    .replace(/:\s*string\s*\|\s*null/g, '')
    .replace(/\bexport\s+function\b/g, 'function')
    .replace(/\s+/g, ' ')
    .trim()
}

const dashboardBody = extractBetweenSentinels(DASHBOARD_PATH)
const landingBody = extractBetweenSentinels(LANDING_PATH)

if (normalize(dashboardBody) !== normalize(landingBody)) {
  console.error(
    `\n❌ Cookie-domain logic drift between:\n` +
      `   - ${relative(REPO_ROOT, DASHBOARD_PATH)} (canonical)\n` +
      `   - ${relative(REPO_ROOT, LANDING_PATH)} (inline copy)\n\n` +
      `--- dashboard (normalized) ---\n${normalize(dashboardBody)}\n\n` +
      `--- landing (normalized) ---\n${normalize(landingBody)}\n\n` +
      `   Mirror the canonical body into BaseLayout.astro between the\n` +
      `   sentinel comments OR extract a shared package and update both\n` +
      `   sites (tracked as 1-10-followup-cookie-domain-package, P2).\n`,
  )
  process.exit(1)
}

console.log(
  `✅ check-cookie-domain-parity OK — cookie-domain body matches across\n` +
    `   ${relative(REPO_ROOT, DASHBOARD_PATH)} and\n` +
    `   ${relative(REPO_ROOT, LANDING_PATH)}.`,
)

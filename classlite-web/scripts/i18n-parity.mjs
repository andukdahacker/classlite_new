#!/usr/bin/env node
// i18n-parity.mjs — CI guard that fails the build if en.json and vi.json
// drift apart. Run via `npm run i18n-parity`.
//
// Why this exists: R38 from the test design. Vietnamese is co-primary
// (NFR-1, UX-DR17). A missing key in vi.json renders as the raw key
// string to half the user base — invisible to English-speaking devs.
//
// Story 1d-3 — namespace-coverage assertion (Murat, party-mode 2026-06-18;
// closed 2026-06-18 by Ducdo: ship-now). Every key whose path starts with
// one of the COVERED_NAMESPACES MUST be claimed by some `STORY_1D_*_KEYS`
// array in `src/lib/test/__tests__/i18n-parity-coverage.test.ts`. An
// orphan key (in JSON but not enumerated anywhere) fails with code 1.
// Closes the vacuous-pass loophole where a new key passes parity (both
// locales have it) but isn't claimed by any story discharge block, so the
// per-story coverage matrix silently rots.
//
// Exit codes:
//   0  — keysets match
//   1  — keysets diverge OR orphan keys exist
//   2  — usage error (missing file, malformed JSON)

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripComments } from './lib/strip-comments-and-strings.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const localesDir = resolve(here, '..', 'src', 'locales')
const coverageTestPath = resolve(
  here,
  '..',
  'src',
  'lib',
  'test',
  '__tests__',
  'i18n-parity-coverage.test.ts',
)

const LOCALES = ['en', 'vi']

/**
 * Namespaces covered by the per-story discharge contract. Any key whose
 * path starts with one of these prefixes MUST be claimed by some
 * `STORY_1D_*_KEYS` array in `i18n-parity-coverage.test.ts`. The
 * `pageHead.fixture.*` keys are Storybook-only demo copy and stay under
 * this rule via the `pageHead.` namespace — they ARE claimed in 1d-3's
 * key list.
 */
const COVERED_NAMESPACES = [
  'sidebar.',
  'topbar.',
  'mobileTab.',
  'pageHead.',
  'userPill.',
  'appShell.',
]

function fail(code, msg) {
  process.stderr.write(`i18n-parity: ${msg}\n`)
  process.exit(code)
}

/**
 * Recursively flatten a nested object into dot-notation [key, value] pairs.
 * { a: { b: 1 }, c: 2 } -> [['a.b', 1], ['c', 2]]
 * Handles both nested and flat locale file shapes.
 */
function flatten(obj, prefix = '') {
  const pairs = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      pairs.push(...flatten(v, path))
    } else {
      pairs.push([path, v])
    }
  }
  return pairs
}

function isEmptyValue(v) {
  if (v == null) return true
  if (typeof v === 'string') return v.trim().length === 0
  return false
}

function loadLocale(code) {
  const path = join(localesDir, `${code}.json`)
  if (!existsSync(path)) {
    fail(2, `locale file not found: ${path}`)
  }
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    fail(2, `read ${path}: ${err.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    fail(2, `parse ${path}: ${err.message}`)
  }
  const pairs = flatten(parsed)
  return {
    keys: new Set(pairs.map(([k]) => k)),
    empty: pairs.filter(([, v]) => isEmptyValue(v)).map(([k]) => k).sort(),
  }
}

/**
 * Extract every string literal claimed by a `STORY_*_KEYS = [...]` array
 * in the coverage test file. Cheap text-level extraction so the script
 * stays plain Node without a TS compile step.
 *
 * Recognises:
 *   const STORY_1D_3_KEYS = [ 'foo.bar', 'baz' ] as const
 *   export const STORY_1D_3_KEYS = [...] as const
 */
function extractClaimedKeys() {
  if (!existsSync(coverageTestPath)) {
    fail(2, `coverage test file not found: ${coverageTestPath}`)
  }
  const raw = readFileSync(coverageTestPath, 'utf8')
  // Strip comments only — the key names we're hunting for live inside
  // string literals in the `STORY_*_KEYS` arrays, so we MUST preserve
  // strings. The earlier hand-rolled stripper missed apostrophes inside
  // JSDoc and ate real source; the shared util applies block-comment
  // and line-comment passes sequentially so they can't false-match
  // across boundaries.
  const content = stripComments(raw)
  const claimed = new Set()
  const arrayPattern = /STORY_[A-Z0-9_]+_KEYS\s*=\s*\[([\s\S]*?)\]\s*as\s*const/g
  let arrayMatch
  while ((arrayMatch = arrayPattern.exec(content)) !== null) {
    const body = arrayMatch[1]
    const stringPattern = /'([^']+)'/g
    let strMatch
    while ((strMatch = stringPattern.exec(body)) !== null) {
      claimed.add(strMatch[1])
    }
  }
  return claimed
}

function diff(setA, setB) {
  return [...setA].filter((k) => !setB.has(k)).sort()
}

function findOrphans(localeKeys, claimedKeys) {
  const orphans = []
  for (const key of localeKeys) {
    for (const ns of COVERED_NAMESPACES) {
      if (key.startsWith(ns) && !claimedKeys.has(key)) {
        orphans.push({ key, namespace: ns })
        break
      }
    }
  }
  return orphans.sort((a, b) => a.key.localeCompare(b.key))
}

const locales = Object.fromEntries(LOCALES.map((c) => [c, loadLocale(c)]))

const [a, b] = LOCALES
const missingInB = diff(locales[a].keys, locales[b].keys)
const missingInA = diff(locales[b].keys, locales[a].keys)
const emptyA = locales[a].empty
const emptyB = locales[b].empty

// Namespace coverage check — run against `en.json` keys (locales are
// already parity-checked above; orphan detection on one locale suffices).
const claimedKeys = extractClaimedKeys()
const orphans = findOrphans(locales[a].keys, claimedKeys)

if (
  missingInA.length === 0 &&
  missingInB.length === 0 &&
  emptyA.length === 0 &&
  emptyB.length === 0 &&
  orphans.length === 0
) {
  const count = locales[a].keys.size
  process.stdout.write(
    `i18n-parity: OK — ${count} keys present in both ${LOCALES.join(', ')} with non-empty values; namespace coverage clean (${claimedKeys.size} claimed)\n`,
  )
  process.exit(0)
}

process.stderr.write(`i18n-parity: FAIL — locale keysets diverge, contain empty values, or have orphan namespace coverage\n\n`)
if (missingInB.length > 0) {
  process.stderr.write(`Keys in ${a}.json missing from ${b}.json (${missingInB.length}):\n`)
  for (const k of missingInB) process.stderr.write(`  - ${k}\n`)
  process.stderr.write('\n')
}
if (missingInA.length > 0) {
  process.stderr.write(`Keys in ${b}.json missing from ${a}.json (${missingInA.length}):\n`)
  for (const k of missingInA) process.stderr.write(`  - ${k}\n`)
  process.stderr.write('\n')
}
if (emptyA.length > 0) {
  process.stderr.write(`Keys with empty values in ${a}.json (${emptyA.length}):\n`)
  for (const k of emptyA) process.stderr.write(`  - ${k}\n`)
  process.stderr.write('\n')
}
if (emptyB.length > 0) {
  process.stderr.write(`Keys with empty values in ${b}.json (${emptyB.length}):\n`)
  for (const k of emptyB) process.stderr.write(`  - ${k}\n`)
  process.stderr.write('\n')
}
if (orphans.length > 0) {
  process.stderr.write(
    `Orphan keys in covered namespaces — not claimed by any STORY_1D_*_KEYS array (${orphans.length}):\n`,
  )
  for (const { key, namespace } of orphans) {
    process.stderr.write(`  - ORPHAN: ${key} belongs to namespace ${namespace} but isn't claimed by any STORY_1D_*_KEYS\n`)
  }
  process.stderr.write(
    `Fix by adding the orphan key(s) to the appropriate STORY_1D_*_KEYS array in src/lib/test/__tests__/i18n-parity-coverage.test.ts.\n\n`,
  )
}
process.stderr.write(`Fix by addressing the failures above.\n`)
process.exit(1)

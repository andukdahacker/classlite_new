#!/usr/bin/env node
// i18n-parity.mjs — CI guard that fails the build if en.json and vi.json
// drift apart. Run via `npm run i18n-parity`.
//
// Why this exists: R38 from the test design. Vietnamese is co-primary
// (NFR-1, UX-DR17). A missing key in vi.json renders as the raw key
// string to half the user base — invisible to English-speaking devs.
//
// Exit codes:
//   0  — keysets match
//   1  — keysets diverge; report printed to stderr
//   2  — usage error (missing file, malformed JSON)

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const localesDir = resolve(here, '..', 'src', 'locales')

const LOCALES = ['en', 'vi']

function fail(code, msg) {
  process.stderr.write(`i18n-parity: ${msg}\n`)
  process.exit(code)
}

/**
 * Recursively flatten a nested object into dot-notation keys.
 * { a: { b: 1 }, c: 2 } -> ['a.b', 'c']
 * Handles both nested and flat locale file shapes.
 */
function flatten(obj, prefix = '') {
  const keys = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flatten(v, path))
    } else {
      keys.push(path)
    }
  }
  return keys
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
  return new Set(flatten(parsed))
}

function diff(setA, setB) {
  return [...setA].filter((k) => !setB.has(k)).sort()
}

const sets = Object.fromEntries(LOCALES.map((c) => [c, loadLocale(c)]))

const [a, b] = LOCALES
const missingInB = diff(sets[a], sets[b])
const missingInA = diff(sets[b], sets[a])

if (missingInA.length === 0 && missingInB.length === 0) {
  const count = sets[a].size
  process.stdout.write(`i18n-parity: OK — ${count} keys present in both ${LOCALES.join(', ')}\n`)
  process.exit(0)
}

process.stderr.write(`i18n-parity: FAIL — locale keysets diverge\n\n`)
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
process.stderr.write(`Fix by adding the missing keys to the affected locale file(s).\n`)
process.exit(1)

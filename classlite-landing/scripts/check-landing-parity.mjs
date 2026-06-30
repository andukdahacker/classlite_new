#!/usr/bin/env node
/**
 * check-landing-parity — Story 1.10 AC8 R38 Layer 4 (CI script).
 *
 * Three checks, each a hard fail:
 *
 *   1. Symmetric key parity — flattened keys of vi.ts and en.ts match
 *      character-for-character. Catches `key in vi.ts but not en.ts`
 *      and vice versa.
 *
 *   2. Non-empty values — every leaf value in both modules is a
 *      non-empty string. Catches the "wired the key but forgot to
 *      translate" failure mode that Layer 1 (`as const satisfies`)
 *      cannot see.
 *
 *   3. **LOCKED_PRICES ratchet (BLOCKER A8 / Murat STRONG #6)** —
 *      every VND price string in both locales matches the locked
 *      table below. Bumping `pricing.pro.priceMonthly` from
 *      `399.000` to `499.000` without simultaneously updating
 *      `LOCKED_PRICES` here fails with a PM-sign-off-required error.
 *
 *   4. Orphan-key scan — every key in either locale is referenced at
 *      least once by some `src/components/landing/**.astro` or
 *      `src/pages/**.astro` file. Dead translations rot, mislead
 *      reviewers, and inflate the VN-fluent pass surface area.
 *
 * Runs ahead of `astro build` in CI per `.github/workflows/ci-landing.yml`.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const PROJECT_ROOT = join(dirname(__filename), '..')
const VI_PATH = join(PROJECT_ROOT, 'src/content/vi.ts')
const EN_PATH = join(PROJECT_ROOT, 'src/content/en.ts')
const COMPONENTS_DIR = join(PROJECT_ROOT, 'src/components/landing')
const PAGES_DIR = join(PROJECT_ROOT, 'src/pages')

/**
 * LOCKED_PRICES — the BLOCKER A8 (2026-06-04) VND price table.
 * Mismatch fails the build with a PM-sign-off-required error.
 * Updating this table requires a PM-approved PR.
 */
const LOCKED_PRICES = {
  'pricing.free.priceMonthly': '0',
  'pricing.free.priceAnnual': '0',
  'pricing.pro.priceMonthly': '399.000',
  'pricing.pro.priceAnnual': '3.990.000',
  'pricing.studio.priceMonthly': '999.000',
  'pricing.studio.priceAnnual': '9.990.000',
}

function flattenKeys(root, prefix = '') {
  if (root === null || typeof root !== 'object') return []
  const result = []
  for (const [key, value] of Object.entries(root)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') {
      result.push(...flattenKeys(value, path))
    } else {
      result.push(path)
    }
  }
  return result
}

function getDotPath(root, path) {
  return path.split('.').reduce((cur, seg) => {
    if (cur && typeof cur === 'object' && seg in cur) return cur[seg]
    return undefined
  }, root)
}

async function walkAstro(dir) {
  let entries
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const files = []
  for (const name of entries) {
    const path = join(dir, name)
    const stats = await stat(path)
    if (stats.isDirectory()) {
      files.push(...(await walkAstro(path)))
    } else if (path.endsWith('.astro')) {
      files.push(path)
    }
  }
  return files
}

async function collectReferencedKeys() {
  /* Layer 4 source-of-truth: scan every `.astro` file under
     `src/components/landing/**` and `src/pages/**` for `strings.X.Y`
     references. Ancestor paths are recorded so destructured-prop
     children (e.g. `<PricingCard pricing={strings.pricing.free} />`)
     are matched via `reachableViaSubtree` below. P10 from code review
     2026-06-30. Previously this script trusted the hand-maintained
     STORY_*_KEYS enumeration as authoritative — a tautology that let
     orphans like `painCalculator.units` survive. */
  const files = [
    ...(await walkAstro(COMPONENTS_DIR)),
    ...(await walkAstro(PAGES_DIR)),
  ]
  const referenced = new Set()
  const re = /strings\.([a-zA-Z0-9_.]+)/g
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    let match
    while ((match = re.exec(source)) !== null) {
      referenced.add(match[1])
    }
  }
  return referenced
}

function reachableViaSubtree(referenced, key) {
  const segments = key.split('.')
  for (let i = segments.length - 1; i >= 1; i--) {
    const prefix = segments.slice(0, i).join('.')
    if (referenced.has(prefix)) return true
  }
  return false
}

async function importLocaleModule(path) {
  // Both modules are TypeScript. Use a child Node process with a
  // tsconfig-aware loader would be heavy; instead, statically parse
  // the literal object via regex stripping `import type` + the
  // surrounding `as const satisfies Strings` and eval the literal.
  // Stays small (≤120 lines total for the script) per AC8 spec.
  const src = await readFile(path, 'utf8')
  // Extract the `export const strings = { ... } as const satisfies Strings`
  // payload. The literal is the {...} between the first `=` and the
  // first ` as const satisfies`.
  const startMarker = 'export const strings ='
  const endMarker = '} as const satisfies'
  const startIdx = src.indexOf(startMarker)
  const endIdx = src.indexOf(endMarker)
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Cannot parse locale module ${path}: missing markers`)
  }
  const literal = src.slice(startIdx + startMarker.length, endIdx + 1).trim()
  // Safe eval — the input is repository-controlled code, not user input.
  // The Function constructor avoids polluting the module scope.
  // eslint-disable-next-line no-new-func
  const value = new Function(`return (${literal});`)()
  return value
}

function fail(message) {
  console.error(`\n❌ check-landing-parity FAILED:\n   ${message}\n`)
  process.exit(1)
}

async function main() {
  const vi = await importLocaleModule(VI_PATH)
  const en = await importLocaleModule(EN_PATH)

  // 1. Symmetric parity
  const viKeys = flattenKeys(vi).sort()
  const enKeys = flattenKeys(en).sort()
  if (viKeys.join('|') !== enKeys.join('|')) {
    const inViOnly = viKeys.filter((k) => !enKeys.includes(k))
    const inEnOnly = enKeys.filter((k) => !viKeys.includes(k))
    fail(
      `Symmetric key drift between vi.ts and en.ts.\n` +
        `   vi-only: ${inViOnly.join(', ') || '(none)'}\n` +
        `   en-only: ${inEnOnly.join(', ') || '(none)'}`,
    )
  }

  // 2. Non-empty values
  const empties = []
  for (const key of viKeys) {
    for (const [name, root] of [
      ['vi', vi],
      ['en', en],
    ]) {
      const value = getDotPath(root, key)
      if (typeof value !== 'string' || value.trim().length === 0) {
        empties.push(`[${name}] ${key}`)
      }
    }
  }
  if (empties.length > 0) {
    fail(`Empty or non-string values:\n   ${empties.join('\n   ')}`)
  }

  // 3. LOCKED_PRICES ratchet (BLOCKER A8)
  const priceFailures = []
  for (const [key, expected] of Object.entries(LOCKED_PRICES)) {
    for (const [name, root] of [
      ['vi', vi],
      ['en', en],
    ]) {
      const actual = getDotPath(root, key)
      if (actual !== expected) {
        priceFailures.push(
          `[${name}] ${key} = "${actual}" (expected "${expected}")`,
        )
      }
    }
  }
  if (priceFailures.length > 0) {
    fail(
      `BLOCKER A8 — price changes require PM sign-off. Mismatches:\n   ` +
        priceFailures.join('\n   ') +
        `\n   Revert the locale change OR update the LOCKED_PRICES table` +
        `\n   in scripts/check-landing-parity.mjs in the same PR with linked PM approval.`,
    )
  }

  // 4. Orphan-key scan — every locale key must be reachable from a
  //    landing `.astro` file (direct reference OR ancestor passed as
  //    a subtree prop). Catches dead translations that the closed-
  //    enumeration meta-assertion alone cannot detect.
  const referenced = await collectReferencedKeys()
  const orphans = viKeys.filter(
    (k) => !referenced.has(k) && !reachableViaSubtree(referenced, k),
  )
  if (orphans.length > 0) {
    const preview = orphans.slice(0, 10).map((k) => `     - ${k}`).join('\n')
    const rest = orphans.length > 10 ? `\n     ... ${orphans.length - 10} more` : ''
    fail(
      `${orphans.length} orphan key(s) — declared in vi.ts/en.ts but not referenced (directly\n` +
        `   or via ancestor subtree prop) by any .astro file under\n` +
        `   ${relative(PROJECT_ROOT, COMPONENTS_DIR)}/ or ${relative(PROJECT_ROOT, PAGES_DIR)}/:\n${preview}${rest}\n` +
        `   Render the key in the matching component OR delete it from the locale modules.`,
    )
  }

  console.log(
    `✅ check-landing-parity OK — ${viKeys.length} keys, ${Object.keys(LOCKED_PRICES).length} prices locked, ${referenced.size} direct + subtree refs, 0 orphans.`,
  )
}

main().catch((err) => {
  console.error(`\n❌ check-landing-parity crashed: ${err.message}\n`)
  process.exit(1)
})

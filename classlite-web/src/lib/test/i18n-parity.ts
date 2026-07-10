/**
 * assertI18nParity — Vitest helper that asserts every i18n key a component
 * uses exists in every locale you ship.
 *
 * Why this exists: R38 from the test design. Component-level tests catch
 * regressions before they reach the CI parity step. Use this in every
 * component test that calls `t(...)`.
 *
 * Example:
 *
 *   import { assertI18nParity } from '@/lib/test/i18n-parity'
 *
 *   test('LoginForm i18n keys exist in en + vi', () => {
 *     assertI18nParity([
 *       'auth.login.title',
 *       'auth.login.submit',
 *       'auth.login.errors.invalid_credentials',
 *     ])
 *   })
 */

import { expect } from 'vitest'
import en from '@/locales/en.json'
import vi from '@/locales/vi.json'

type LocaleCode = 'en' | 'vi'

/**
 * Recursively flatten a nested locale object to dot-notation keys.
 * Identical semantics to scripts/i18n-parity.mjs so the helper and the
 * CI script never disagree.
 */
function flatten(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return []
  }
  const out: string[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatten(v, path))
    } else {
      out.push(path)
    }
  }
  return out
}

const KEYSETS: Record<LocaleCode, Set<string>> = {
  en: new Set(flatten(en)),
  vi: new Set(flatten(vi)),
}

/**
 * Assert every key in `usedKeys` exists in every locale listed (default:
 * both en and vi). Fails the test with a readable diff when keys are
 * missing.
 */
export function assertI18nParity(
  usedKeys: readonly string[],
  locales: readonly LocaleCode[] = ['en', 'vi'],
): void {
  const missing: Record<LocaleCode, string[]> = { en: [], vi: [] }

  for (const key of usedKeys) {
    for (const locale of locales) {
      if (!KEYSETS[locale].has(key)) {
        missing[locale].push(key)
      }
    }
  }

  const anyMissing = locales.some((l) => missing[l].length > 0)
  if (!anyMissing) return

  const lines: string[] = ['i18n parity check failed:']
  for (const locale of locales) {
    if (missing[locale].length > 0) {
      lines.push(`  ${locale}.json missing ${missing[locale].length} key(s):`)
      for (const k of missing[locale]) lines.push(`    - ${k}`)
    }
  }
  expect.fail(lines.join('\n'))
}

/**
 * keysFor returns the flat keyset of a single locale. Useful for tests
 * that want to assert overall coverage shape rather than specific keys.
 */
export function keysFor(locale: LocaleCode): Set<string> {
  return KEYSETS[locale]
}

/**
 * assertI18nInterpolationParity — Story 2-3a Murat-S2 fold.
 *
 * assertI18nParity checks that keys exist in every locale, but does NOT
 * verify that the `{{token}}` interpolation shape is identical across
 * locales. R38 owns 40+ new keys × several interpolation shapes
 * (`{{seconds}}` / `{{max}}` / `{{requestId}}` / `{{centerName}}` /
 * `{{shortCode}}` / `{{current}}` / `{{total}}`) — a translator
 * renaming a token in `vi.json` would ship `{{giay}}` verbatim to
 * Vietnamese users at runtime.
 *
 * For every key in `usedKeys`, extract the set of `{{token}}` occurrences
 * from every locale's value and assert they match. Missing keys are
 * skipped (`assertI18nParity` covers those); this helper is purely a
 * token-shape guard.
 */
const INTERPOLATION_TOKEN_REGEX = /\{\{\s*([\w.]+)\s*\}\}/g

function localeMapFor(locale: LocaleCode): Record<string, string> {
  const source = locale === 'en' ? en : vi
  const map: Record<string, string> = {}
  const walk = (obj: unknown, prefix: string) => {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k
      if (typeof v === 'string') {
        map[path] = v
      } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, path)
      }
    }
  }
  walk(source, '')
  return map
}

const LOCALE_MAPS: Record<LocaleCode, Record<string, string>> = {
  en: localeMapFor('en'),
  vi: localeMapFor('vi'),
}

function extractTokens(value: string): Set<string> {
  const tokens = new Set<string>()
  for (const match of value.matchAll(INTERPOLATION_TOKEN_REGEX)) {
    tokens.add(match[1])
  }
  return tokens
}

export function assertI18nInterpolationParity(
  usedKeys: readonly string[],
  locales: readonly LocaleCode[] = ['en', 'vi'],
): void {
  // R1-P27: guard against silent single-locale runs. `assertI18nParity`
  // is responsible for "key is present in both locales"; this helper's
  // sole reason to exist is CROSS-locale token comparison, so a single-
  // locale caller is a caller bug. Fail loudly rather than short-circuit.
  if (locales.length < 2) {
    expect.fail(
      `assertI18nInterpolationParity requires ≥2 locales (got ${locales.length}: [${locales.join(', ')}]) — pair with assertI18nParity for single-locale presence checks.`,
    )
  }
  const mismatches: string[] = []
  const missingSecondLocale: string[] = []
  for (const key of usedKeys) {
    const perLocale: Partial<Record<LocaleCode, Set<string>>> = {}
    for (const locale of locales) {
      const value = LOCALE_MAPS[locale][key]
      if (typeof value !== 'string') continue // presence is assertI18nParity's job
      perLocale[locale] = extractTokens(value)
    }
    const localeCodes = Object.keys(perLocale) as LocaleCode[]
    if (localeCodes.length < 2) {
      // A key present in one locale but missing from another is a bug —
      // assertI18nParity should catch it, but note it here in case that
      // helper wasn't called alongside.
      if (localeCodes.length === 1) {
        missingSecondLocale.push(`  ${key} (only in ${localeCodes[0]})`)
      }
      continue
    }
    const base = perLocale[localeCodes[0]]!
    for (let i = 1; i < localeCodes.length; i++) {
      const other = perLocale[localeCodes[i]]!
      if (
        base.size !== other.size ||
        [...base].some((token) => !other.has(token))
      ) {
        mismatches.push(
          `  ${key}: ${localeCodes[0]}={${[...base].sort().join(', ')}} vs ${localeCodes[i]}={${[...other].sort().join(', ')}}`,
        )
      }
    }
  }
  if (mismatches.length === 0 && missingSecondLocale.length === 0) return
  const parts: string[] = []
  if (mismatches.length > 0) {
    parts.push('i18n interpolation-token parity check failed:', ...mismatches)
  }
  if (missingSecondLocale.length > 0) {
    parts.push(
      'Also — the following keys were present in only one locale (should be caught by assertI18nParity):',
      ...missingSecondLocale,
    )
  }
  expect.fail(parts.join('\n'))
}

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

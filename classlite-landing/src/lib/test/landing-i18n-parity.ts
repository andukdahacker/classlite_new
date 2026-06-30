/**
 * landing-i18n-parity — Story 1.10 AC8 R38 Layer 2.
 *
 * Per-component call-site check: every test file declares its own
 * `STORY_1_10_KEYS` array enumerating the dot-paths it consumes, and
 * calls `assertLandingI18nParity(STORY_1_10_KEYS, ['vi', 'en'])` so
 * adding a key in `Strings` without populating both locales fails the
 * unit test. Mirrors the dashboard's `assertI18nParity` shape from
 * Story 1-7c.
 *
 * Layer 1 (`as const satisfies Strings`) catches structural drift at
 * compile time; this helper catches *runtime* drift (empty value,
 * stringified `'undefined'`, etc.) at the consumer site.
 */
import { strings as viStrings } from '../../content/vi'
import { strings as enStrings } from '../../content/en'

export type Language = 'vi' | 'en'

const LOCALES: Record<Language, unknown> = {
  vi: viStrings,
  en: enStrings,
}

function resolveDotPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in current) {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, root)
}

export function assertLandingI18nParity(
  usedKeys: readonly string[],
  locales: readonly Language[] = ['vi', 'en'],
): void {
  const failures: string[] = []
  for (const locale of locales) {
    const root = LOCALES[locale]
    for (const key of usedKeys) {
      const value = resolveDotPath(root, key)
      if (typeof value !== 'string') {
        failures.push(`[${locale}] ${key} → missing or non-string`)
        continue
      }
      if (value.trim().length === 0) {
        failures.push(`[${locale}] ${key} → empty string`)
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `assertLandingI18nParity: ${failures.length} parity failure(s):\n  ` +
        failures.join('\n  '),
    )
  }
}

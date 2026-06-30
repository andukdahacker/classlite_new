/**
 * Hero.test — AC8 R38 Layer 2 (per-component parity).
 *
 * Enumerates the strings keys the Hero component renders. Adding a key
 * to `strings.hero.*` without populating both locales fails this
 * test — closes the call-site parity surface that Layer 1
 * (`as const satisfies Strings`) cannot see at runtime.
 */
import { describe, test } from 'vitest'
import { assertLandingI18nParity } from '../../../lib/test/landing-i18n-parity'

const STORY_1_10_KEYS = [
  'hero.eyebrow',
  'hero.headline',
  'hero.cta',
] as const

describe('Hero — i18n parity', () => {
  test('every key resolves to a non-empty string in both locales', () => {
    assertLandingI18nParity(STORY_1_10_KEYS, ['vi', 'en'])
  })
})

/**
 * StickyHeader.test — AC8 R38 Layer 2 (per-component parity).
 */
import { describe, test } from 'vitest'
import { assertLandingI18nParity } from '../../../lib/test/landing-i18n-parity'

const STORY_1_10_KEYS = [
  'header.cta',
  'header.nav.features',
  'header.nav.pricing',
  'header.nav.proof',
  'header.langToggleLabel',
  'header.hamburgerLabel',
] as const

describe('StickyHeader — i18n parity', () => {
  test('every key resolves to a non-empty string in both locales', () => {
    assertLandingI18nParity(STORY_1_10_KEYS, ['vi', 'en'])
  })
})

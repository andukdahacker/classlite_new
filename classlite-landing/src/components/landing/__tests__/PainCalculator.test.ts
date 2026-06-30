/**
 * PainCalculator.test — AC8 R38 Layer 2 (per-component parity).
 */
import { describe, test } from 'vitest'
import { assertLandingI18nParity } from '../../../lib/test/landing-i18n-parity'

const STORY_1_10_KEYS = [
  'painCalculator.line1',
  'painCalculator.line2',
  'painCalculator.footnote',
  'painCalculator.moneyConversion',
  'painCalculator.assumption',
] as const

describe('PainCalculator — i18n parity', () => {
  test('every key resolves to a non-empty string in both locales', () => {
    assertLandingI18nParity(STORY_1_10_KEYS, ['vi', 'en'])
  })
})

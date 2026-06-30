/**
 * PricingSection.test — AC8 R38 Layer 2 (per-component parity).
 *
 * The section itself owns the heading, both toggle labels, and the
 * below-grid CTA. Tier prices are covered by `PricingCard.test.ts`.
 */
import { describe, test } from 'vitest'
import { assertLandingI18nParity } from '../../../lib/test/landing-i18n-parity'

const STORY_1_10_KEYS = [
  'pricing.heading',
  'pricing.toggleMonthly',
  'pricing.toggleAnnual',
  'pricing.belowCta',
] as const

describe('PricingSection — i18n parity', () => {
  test('every key resolves to a non-empty string in both locales', () => {
    assertLandingI18nParity(STORY_1_10_KEYS, ['vi', 'en'])
  })
})

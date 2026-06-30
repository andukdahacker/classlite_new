/**
 * PricingCard.test — AC8 R38 Layer 2 (per-component parity).
 *
 * Covers the three tier subtrees passed in as the `pricing` prop, plus
 * the popular/annual badges. The price keys are also ratcheted at
 * byte-level by `scripts/check-landing-parity.mjs` (BLOCKER A8).
 */
import { describe, test } from 'vitest'
import { assertLandingI18nParity } from '../../../lib/test/landing-i18n-parity'

const STORY_1_10_KEYS = [
  'pricing.popularBadge',
  'pricing.annualBadge',
  'pricing.free.name',
  'pricing.free.priceMonthly',
  'pricing.free.priceAnnual',
  'pricing.free.vatNote',
  'pricing.free.description',
  'pricing.free.cta',
  'pricing.pro.name',
  'pricing.pro.priceMonthly',
  'pricing.pro.priceAnnual',
  'pricing.pro.vatNote',
  'pricing.pro.description',
  'pricing.pro.cta',
  'pricing.studio.name',
  'pricing.studio.priceMonthly',
  'pricing.studio.priceAnnual',
  'pricing.studio.vatNote',
  'pricing.studio.description',
  'pricing.studio.cta',
] as const

describe('PricingCard — i18n parity', () => {
  test('every key resolves to a non-empty string in both locales', () => {
    assertLandingI18nParity(STORY_1_10_KEYS, ['vi', 'en'])
  })
})

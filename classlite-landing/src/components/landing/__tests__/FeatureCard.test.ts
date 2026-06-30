/**
 * FeatureCard.test — AC8 R38 Layer 2 (per-component parity).
 *
 * FeatureCard takes `title` + `body` props; the page wires the three
 * `feature.{writing,qa,analytics}.{title,body}` subtrees into the
 * three cards. Tests the keys passed to the cards in both locales.
 */
import { describe, test } from 'vitest'
import { assertLandingI18nParity } from '../../../lib/test/landing-i18n-parity'

const STORY_1_10_KEYS = [
  'feature.writing.title',
  'feature.writing.body',
  'feature.qa.title',
  'feature.qa.body',
  'feature.analytics.title',
  'feature.analytics.body',
] as const

describe('FeatureCard — i18n parity', () => {
  test('every key resolves to a non-empty string in both locales', () => {
    assertLandingI18nParity(STORY_1_10_KEYS, ['vi', 'en'])
  })
})

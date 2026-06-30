/**
 * SocialProofCard.test — AC8 R38 Layer 2 (per-component parity).
 */
import { describe, test } from 'vitest'
import { assertLandingI18nParity } from '../../../lib/test/landing-i18n-parity'

const STORY_1_10_KEYS = [
  'socialProof.sectionHeader',
  'socialProof.sectionNote',
  'socialProof.card1.center',
  'socialProof.card1.outcomeLabel',
  'socialProof.card1.outcomeValue',
  'socialProof.card1.quote',
  'socialProof.card1.attribution',
  'socialProof.card1.stats',
  'socialProof.card2.center',
  'socialProof.card2.outcomeLabel',
  'socialProof.card2.outcomeValue',
  'socialProof.card2.quote',
  'socialProof.card2.attribution',
  'socialProof.card2.stats',
] as const

describe('SocialProofCard — i18n parity', () => {
  test('every key resolves to a non-empty string in both locales', () => {
    assertLandingI18nParity(STORY_1_10_KEYS, ['vi', 'en'])
  })
})

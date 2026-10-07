/**
 * archiveI18nParity.test.ts — Story 10-2 · AC10 (i18n parity ratchet, red-first).
 *
 * RED (parity): the STORY_10_2_KEYS below do NOT yet exist in en.json / vi.json, so
 * assertI18nParity FAILS until the dev adds every key to BOTH locales (VN co-primary,
 * UX-2). This is the lightweight FE WF-8 control for the parity class, mirroring the
 * 10-1b / 10-1c inboxI18nParity reds.
 *
 * GREEN SEAM: add all STORY_10_2_KEYS to en.json + vi.json, THEN fold STORY_10_2_KEYS
 * into the master ratchet `src/lib/test/__tests__/i18n-parity-coverage.test.ts`
 * (the exhaustive-coverage guard), exactly as STORY_10_1B_KEYS / STORY_10_1C_KEYS
 * are wired.
 */
import { describe, it } from 'vitest'

import { assertI18nParity, assertI18nInterpolationParity } from '@/lib/test/i18n-parity'

import { STORY_10_2_KEYS } from './archiveI18nKeys'

describe('Story 10-2 i18n parity (en ⇄ vi)', () => {
  it('every net-new key exists in both locales', () => {
    assertI18nParity(STORY_10_2_KEYS)
  })

  it('interpolation tokens match across locales ({{skill}}, {{targetBand}}, {{endedAt}})', () => {
    assertI18nInterpolationParity(STORY_10_2_KEYS)
  })
})

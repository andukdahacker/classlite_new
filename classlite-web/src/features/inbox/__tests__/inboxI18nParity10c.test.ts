/**
 * inboxI18nParity10c.test.ts — Story 10-1c · AC10 (i18n parity ratchet, red-first).
 *
 * RED (parity): the STORY_10_1C_KEYS below do NOT yet exist in en.json / vi.json, so
 * assertI18nParity FAILS until the dev adds every key to BOTH locales (VN co-primary,
 * UX-2). This is the lightweight WF-8 control for the R38 parity class, mirroring the
 * 10-1b inboxI18nParity red.
 *
 * GREEN SEAM: add all STORY_10_1C_KEYS to en.json + vi.json, THEN fold
 * STORY_10_1C_KEYS into the master ratchet `src/lib/test/__tests__/i18n-parity-coverage.test.ts`
 * (the exhaustive-coverage guard), exactly as STORY_10_1B_KEYS is wired.
 */
import { describe, it } from 'vitest'

import { assertI18nParity, assertI18nInterpolationParity } from '@/lib/test/i18n-parity'

import { STORY_10_1C_KEYS } from './inboxI18nKeys10c'

describe('Story 10-1c i18n parity (en ⇄ vi)', () => {
  it('every net-new key exists in both locales', () => {
    assertI18nParity(STORY_10_1C_KEYS)
  })

  it('interpolation tokens match across locales ({{class}}, {{count}})', () => {
    assertI18nInterpolationParity(STORY_10_1C_KEYS)
  })
})

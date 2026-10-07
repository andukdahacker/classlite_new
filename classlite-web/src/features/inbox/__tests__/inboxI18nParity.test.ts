/**
 * inboxI18nParity.test.ts — Story 10-1b · AC10 (the R38 i18n-parity gate).
 *
 * RED (runtime): STORY_10_1B_KEYS enumerates NET-NEW keys that are NOT YET in
 * en.json / vi.json, so `assertI18nParity` throws until the dev adds them to BOTH
 * locales. This is the lightweight WF-8 control for the R38 "maps-to-6" risk, wired
 * RED-FIRST per the ATDD convention.
 *
 * GREEN: dev adds every STORY_10_1B_KEYS entry to en.json AND vi.json (VN co-primary),
 * then — matching the STORY_8_4B_KEYS precedent — folds STORY_10_1B_KEYS into the
 * master ratchet (`src/lib/test/__tests__/i18n-parity-coverage.test.ts`) import list
 * so the orphan/duplicate guard also tracks it. This standalone spec keeps the red
 * isolated during the red phase; it may be removed once the master ratchet owns the array.
 */
import { describe, test } from 'vitest'

import { assertI18nParity, assertI18nInterpolationParity } from '@/lib/test/i18n-parity'
import { STORY_10_1B_KEYS } from './inboxI18nKeys'

describe('Story 10-1b — inbox i18n parity (AC10, red-first)', () => {
  test('every new inbox key exists in BOTH en and vi', () => {
    assertI18nParity(STORY_10_1B_KEYS)
  })

  test('interpolation tokens match across locales (header unread·total, relativeTime count)', () => {
    assertI18nInterpolationParity(STORY_10_1B_KEYS)
  })
})

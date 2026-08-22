/**
 * Story 6.3a (AC4 · D8) — RED PHASE. The TWINNED client overall-band math for
 * SPEAKING, over SPEAKING_CRITERION_KEYS. Must match the server scorer
 * (grading.OverallBandFromFour) and the writing twin (computeOverallBand.test.ts)
 * on the SAME eight-fraction table — the client preview must never disagree with
 * the persisted server value.
 *
 * FAILS at import today: `@/features/grading/lib/speakingOverallBand` does not exist.
 *
 * SEAM (dev, green phase — D8: twin/parameterize the writing math, do NOT reuse the
 * writing CRITERION_KEYS):
 *   - SPEAKING_CRITERION_KEYS = ['fluencyCoherence','lexicalResource','grammaticalRange','pronunciation'] as const
 *   - type SpeakingCriterionScores = Record<(typeof SPEAKING_CRITERION_KEYS)[number], number>
 *   - computeSpeakingOverallBand(scores: SpeakingCriterionScores): number
 *   - speakingOverallBandMath(scores): { avg: number; band: number }
 *   - isValidBand is per-scalar → REUSE from computeOverallBand (MIN_BAND|MAX_BAND|BAND_STEP)
 */
import { describe, expect, test } from 'vitest'

import {
  SPEAKING_CRITERION_KEYS,
  computeSpeakingOverallBand,
  speakingOverallBandMath,
  type SpeakingCriterionScores,
} from '@/features/grading/lib/speakingOverallBand'

const s = (fc: number, lr: number, gr: number, pr: number): SpeakingCriterionScores => ({
  fluencyCoherence: fc,
  lexicalResource: lr,
  grammaticalRange: gr,
  pronunciation: pr,
})

describe('computeSpeakingOverallBand — mirrors the server scorer exactly (AC4)', () => {
  test('the key set is the four SPEAKING criteria, in order (D8 — not writing keys)', () => {
    expect([...SPEAKING_CRITERION_KEYS]).toEqual([
      'fluencyCoherence',
      'lexicalResource',
      'grammaticalRange',
      'pronunciation',
    ])
  })

  // The SAME eight-fraction table asserted on the Go side + the writing twin.
  test.each([
    ['frac .0 exact 6.0', s(6, 6, 6, 6), 6.0],
    ['frac .125 → 6.0 (integer-not-float)', s(6, 6, 6, 6.5), 6.0],
    ['frac .25 → 6.5 (special up)', s(6, 6, 6.5, 6.5), 6.5],
    ['frac .375 → 6.5', s(6, 6.5, 6.5, 6.5), 6.5],
    ['frac .5 exact 6.5', s(6.5, 6.5, 6.5, 6.5), 6.5],
    ['frac .625 → 6.5', s(6.5, 6.5, 6.5, 7), 6.5],
    ['frac .75 → 7.0 (special up)', s(6.5, 6.5, 7, 7), 7.0],
    ['frac .875 → 7.0', s(6.5, 7, 7, 7), 7.0],
    ['all min 1.0', s(1, 1, 1, 1), 1.0],
    ['all max 9.0', s(9, 9, 9, 9), 9.0],
    ['7.75 → 8.0', s(7.5, 7.5, 8, 8), 8.0],
  ])('%s', (_name, scores, expected) => {
    expect(computeSpeakingOverallBand(scores)).toBe(expected)
  })
})

describe('speakingOverallBandMath — shows the math (AC4)', () => {
  test('returns avg + band for a complete set', () => {
    expect(speakingOverallBandMath(s(6, 6, 6.5, 6.5))).toEqual({ avg: 6.25, band: 6.5 })
  })
})

import { describe, expect, test } from 'vitest'

import {
  computeOverallBand,
  isValidBand,
  overallBandMath,
  type CriterionScores,
} from '../computeOverallBand'

const s = (tr: number, cc: number, lr: number, gr: number): CriterionScores => ({
  taskResponse: tr,
  coherenceCohesion: cc,
  lexicalResource: lr,
  grammaticalRange: gr,
})

describe('computeOverallBand — mirrors the server scorer exactly (AC7/AC14)', () => {
  // The SAME eight-fraction table asserted on the Go side (scorer_test.go). Client
  // preview must never disagree with the persisted server value.
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
    expect(computeOverallBand(scores)).toBe(expected)
  })
})

describe('overallBandMath — shows the math (AC14)', () => {
  test('returns avg + band for a complete set', () => {
    expect(overallBandMath(s(6, 6, 6.5, 6.5))).toEqual({ avg: 6.25, band: 6.5 })
  })
  test('returns null while any criterion is unset', () => {
    expect(overallBandMath({ taskResponse: 6, coherenceCohesion: 6 })).toBeNull()
  })
})

describe('isValidBand — 1.0–9.0 on the 0.5 grid', () => {
  test.each([
    [6, true],
    [6.5, true],
    [1, true],
    [9, true],
    [0.5, false],
    [9.5, false],
    [6.25, false],
    [6.1, false],
  ])('isValidBand(%s) = %s', (v, expected) => {
    expect(isValidBand(v)).toBe(expected)
  })
})

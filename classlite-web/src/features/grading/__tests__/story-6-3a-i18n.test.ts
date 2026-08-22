/**
 * Story 6.3a (AC13 / TEST-FE-4 / R38) — i18n parity for the SPEAKING grading
 * surface. Closed-literal key list + prefix ratchet + interpolation-token parity,
 * asserting BOTH en.json AND vi.json. The list IS the documentation — a new
 * `speakingGrading.*` key MUST be added here in the same change.
 *
 * RED PHASE: these keys do not exist in the locale files yet, so `assertI18nParity`
 * fails until the dev adds them to en.json AND vi.json (green work).
 *
 * The pin-tip copy fix (D7): the tip must NOT say "click the waveform to pin" — the
 * waveform is seek-only; pinning is the dedicated "Pin here" control (+ `P`).
 */
import { describe, expect, test } from 'vitest'

import { assertI18nInterpolationParity, assertI18nParity } from '@/lib/test/i18n-parity'
import en from '@/locales/en.json'

export const STORY_6_3A_KEYS = [
  // Player transport + waveform controls (AC1/AC14).
  'speakingGrading.player.play',
  'speakingGrading.player.pause',
  'speakingGrading.player.speed',
  'speakingGrading.player.speedLabel', // e.g. "Speed {{rate}}×"
  'speakingGrading.player.timeReadout', // aria-live "{{current}} of {{total}}"
  'speakingGrading.player.seekBackward',
  'speakingGrading.player.seekForward',
  // Pinning (AC6) — the corrected tip copy (D7): NOT "click the waveform to pin".
  'speakingGrading.pin.here',
  'speakingGrading.pin.tip',
  'speakingGrading.pin.keyboardHint',
  'speakingGrading.pin.delete',
  'speakingGrading.pin.edit',
  // Notes rail (AC6/AC7/D9) — timeline-shaped, general zone.
  'speakingGrading.rail.title',
  'speakingGrading.rail.generalZone',
  'speakingGrading.rail.empty',
  // States (AC3/AC12).
  'speakingGrading.state.preparingAudio', // labeled skeleton
  'speakingGrading.state.reRecord', // "Ask student to re-record"
  'speakingGrading.state.reRecordBody',
  'speakingGrading.state.audioRetry', // transient → inline retry (NOT re-record)
  // Criterion group heading for the speaking 2×2 (criterion.* keys reused for the four names).
  'speakingGrading.criteria.title',
] as const

const ALLOWED_PREFIXES_6_3A = ['speakingGrading.'] as const

describe('Story 6.3a i18n parity (R38)', () => {
  test('every Story 6.3a key exists in both en.json and vi.json', () => {
    assertI18nParity(STORY_6_3A_KEYS)
  })

  test('interpolation-token parity holds across en / vi for ALL Story 6.3a keys', () => {
    assertI18nInterpolationParity(STORY_6_3A_KEYS)
  })

  test.each(STORY_6_3A_KEYS)('%s belongs to a 6.3a allowed prefix (AC13 ratchet)', (key) => {
    expect(ALLOWED_PREFIXES_6_3A.some((prefix) => key.startsWith(prefix))).toBe(true)
  })

  test('the pin tip does NOT tell the teacher to click the waveform to pin (D7 gesture fix)', () => {
    const tip = (en as Record<string, string>)['speakingGrading.pin.tip']
    expect(typeof tip).toBe('string') // red until the key lands
    expect((tip ?? '').toLowerCase()).not.toContain('click the waveform')
  })
})

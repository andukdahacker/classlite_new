/**
 * Story 6.3c (AC19 / TEST-FE-4 / R38) — RED-PHASE ATDD scaffold (/bmad-tea AT 6-3c).
 *
 * i18n parity for the AI-assisted SPEAKING grading FRONTEND. Closed-literal key
 * list + prefix ratchet + interpolation-token parity, asserting BOTH en.json AND
 * vi.json. The list IS the documentation — a new `speakingGrading.ai.*` key MUST
 * be added here in the same change (mirrors story-6-2b-i18n.test.ts /
 * story-6-3a-i18n.test.ts).
 *
 * RED PHASE: none of these `speakingGrading.ai.*` keys exist in the locale files
 * yet, so `assertI18nParity` fails until Task 6 adds them to en.json AND vi.json.
 * That is the intended red signal (import-the-contract, keys-missing → fail).
 *
 * GREEN-PHASE SEAMS (Task 6):
 *   • Reuse — do NOT re-key — the four criterion labels (`criterion.fluencyCoherence`,
 *     `criterion.lexicalResource`, `criterion.grammaticalRange`,
 *     `criterion.pronunciation`) and the skill-agnostic confirm dialog copy
 *     (`grading.ai.confirm.*`, reused as-is per SD4). Neither belongs in the
 *     `speakingGrading.ai.*` ratchet below.
 *   • Reuse `speakingGrading.state.reRecord` / `.reRecordBody` (shipped by 6-3a)
 *     for the audio-unavailable failed-state body — not re-keyed here.
 *   • The two exact-copy strings (SD7 partial_success value-first, SD8
 *     audio_unavailable refund toast) are literal-asserted below — the copy is
 *     the contract, not a paraphrase.
 */
import { describe, expect, test } from 'vitest'

import { assertI18nInterpolationParity, assertI18nParity } from '@/lib/test/i18n-parity'
import en from '@/locales/en.json'

export const STORY_6_3C_KEYS = [
  // Run control + panel (AC1/AC3).
  'speakingGrading.ai.run',
  'speakingGrading.ai.rerun',
  'speakingGrading.ai.panel.title',
  // Band strip (AC5) + transcription meta (SD7) + overall preview.
  'speakingGrading.ai.bandStrip.label',
  'speakingGrading.ai.overall.label',
  'speakingGrading.ai.disclaimer',
  'speakingGrading.ai.transcriptionMeta', // "Audio {{duration}} · analysed in {{seconds}}s"
  'speakingGrading.ai.band.editLabel',
  // Interleaved AI moment cards (AC6/AC8).
  'speakingGrading.ai.avatar',
  'speakingGrading.ai.general', // general (unpinned) zone label for null-timestamp moments
  'speakingGrading.ai.momentLabel',
  'speakingGrading.ai.moment.editLabel',
  'speakingGrading.ai.acceptAllPraise',
  // Teacher-only confidence badge (AC6/AC9).
  'speakingGrading.ai.confidence.high',
  'speakingGrading.ai.confidence.medium',
  // Per-item actions (AC5/AC6/AC8).
  'speakingGrading.ai.action.accept',
  'speakingGrading.ai.action.edit',
  'speakingGrading.ai.action.dismiss',
  'speakingGrading.ai.action.bandApplied',
  'speakingGrading.ai.action.momentApplied',
  // Transcript panel (AC10/AC11).
  'speakingGrading.ai.transcript.view',
  'speakingGrading.ai.transcript.hide',
  'speakingGrading.ai.transcript.unavailable', // SD7 value-first header (literal-asserted below)
  // Generating / slow / stuck (AC14/AC18).
  'speakingGrading.ai.generating.title',
  'speakingGrading.ai.generating.body',
  'speakingGrading.ai.slow.slower',
  'speakingGrading.ai.slow.verySlow',
  'speakingGrading.ai.stuck.title',
  'speakingGrading.ai.stuck.body',
  // Non-blocking ready overlay (AC15).
  'speakingGrading.ai.ready.overlay',
  'speakingGrading.ai.ready.review',
  // Failure + enqueue-rejection copy (AC4/AC16/AC17/AC18).
  'speakingGrading.ai.tooLong', // 409 SUBMISSION_TOO_LONG inline (no credit spent)
  'speakingGrading.ai.notGradable', // 409 SUBMISSION_NOT_GRADABLE inline
  'speakingGrading.ai.invalidScores', // invalid_band_scores → empty-form
  'speakingGrading.ai.retry',
  'speakingGrading.ai.pollError',
  'speakingGrading.ai.failed',
  'speakingGrading.ai.toast.audioUnavailable', // SD8 refund toast (literal-asserted below)
  'speakingGrading.ai.toast.invalidOutput',
  'speakingGrading.ai.toast.enqueueFailed',
] as const

const ALLOWED_PREFIXES_6_3C = ['speakingGrading.ai.'] as const

describe('Story 6.3c i18n parity (R38)', () => {
  test('every Story 6.3c key exists in both en.json and vi.json', () => {
    assertI18nParity(STORY_6_3C_KEYS)
  })

  test('interpolation-token parity holds across en / vi for ALL Story 6.3c keys', () => {
    assertI18nInterpolationParity(STORY_6_3C_KEYS)
  })

  test.each(STORY_6_3C_KEYS)('%s belongs to a 6.3c allowed prefix (AC19 ratchet)', (key) => {
    expect(ALLOWED_PREFIXES_6_3C.some((prefix) => key.startsWith(prefix))).toBe(true)
  })

  test('the partial_success header leads with VALUE, not a transcript apology (SD7/AC11)', () => {
    const record = en as Record<string, string>
    expect(record['speakingGrading.ai.transcript.unavailable']).toBe(
      'Transcript unavailable — band proposals below',
    )
  })

  test('the audio-unavailable toast uses the exact refund copy (SD8/AC16)', () => {
    const record = en as Record<string, string>
    expect(record['speakingGrading.ai.toast.audioUnavailable']).toBe(
      "We couldn't process this recording — your AI credit has been returned. Try again.",
    )
  })

  test('the disclaimer uses the em-dash acceptance-contract copy (AC5, parity with writing)', () => {
    const record = en as Record<string, string>
    expect(record['speakingGrading.ai.disclaimer']).toBe(
      'Suggestion — teacher always decides the final band.',
    )
  })
})

/**
 * Story 6.2b (AC17 / TEST-FE-4 / R38) — i18n parity for the AI-assisted writing
 * grading FRONTEND. Closed-literal key list + prefix ratchet + interpolation-token
 * parity, asserting BOTH en.json AND vi.json. The list is the documentation — a new
 * `grading.ai.*` / first-run key MUST be added here in the same change.
 *
 * The Vietnamese first-run progress string is pinned to the exact spec copy
 * ("AI đang phân tích bài viết…", FD8 / AC16).
 */
import { describe, expect, test } from 'vitest'
import { assertI18nInterpolationParity, assertI18nParity } from '@/lib/test/i18n-parity'
import en from '@/locales/en.json'
import vi from '@/locales/vi.json'

export const STORY_6_2B_KEYS = [
  // AI suggestion panel + confirm gate + slow/failure copy (grading.ai.*).
  'grading.ai.run',
  'grading.ai.rerun',
  'grading.ai.panel.title',
  'grading.ai.comments.title',
  'grading.ai.comments.empty',
  'grading.ai.commentLabel',
  'grading.ai.avatar',
  'grading.ai.general',
  'grading.ai.acceptAllPraise',
  'grading.ai.disclaimer',
  'grading.ai.analyzedMeta',
  'grading.ai.overall.label',
  'grading.ai.bandStrip.label',
  'grading.ai.band.editLabel',
  'grading.ai.comment.editLabel',
  'grading.ai.confidence.high',
  'grading.ai.confidence.medium',
  'grading.ai.action.accept',
  'grading.ai.action.edit',
  'grading.ai.action.dismiss',
  'grading.ai.action.bandApplied',
  'grading.ai.action.commentApplied',
  'grading.ai.confirm.title',
  'grading.ai.confirm.cost',
  'grading.ai.confirm.rerunWarning',
  'grading.ai.confirm.confirm',
  'grading.ai.confirm.cancel',
  'grading.ai.generating.title',
  'grading.ai.generating.body',
  'grading.ai.slow.slower',
  'grading.ai.slow.verySlow',
  'grading.ai.stuck.title',
  'grading.ai.stuck.body',
  'grading.ai.invalidScores',
  'grading.ai.ready.overlay',
  'grading.ai.ready.review',
  'grading.ai.retry',
  'grading.ai.pollError',
  'grading.ai.failed',
  'grading.ai.toast.failed',
  'grading.ai.toast.invalidOutput',
  'grading.ai.toast.enqueueFailed',
  // First-run card live-simulated upgrade (dashboard.aiSample.* additions, FD8).
  'dashboard.aiSample.tryCta',
  'dashboard.aiSample.analyzing',
  'dashboard.aiSample.progressLabel',
  'dashboard.aiSample.runAgain',
] as const

const ALLOWED_PREFIXES_6_2B = ['grading.ai.', 'dashboard.aiSample.'] as const

describe('Story 6.2b i18n parity (R38)', () => {
  test('every Story 6.2b key exists in both en.json and vi.json', () => {
    assertI18nParity(STORY_6_2B_KEYS)
  })

  test('interpolation-token parity holds across en / vi for ALL Story 6.2b keys', () => {
    assertI18nInterpolationParity(STORY_6_2B_KEYS)
  })

  test.each(STORY_6_2B_KEYS)('%s belongs to a 6.2b allowed prefix (AC17 ratchet)', (key) => {
    expect(ALLOWED_PREFIXES_6_2B.some((prefix) => key.startsWith(prefix))).toBe(true)
  })

  test('the Vietnamese first-run progress string matches the spec copy exactly (FD8/AC16)', () => {
    const record = vi as Record<string, string>
    expect(record['dashboard.aiSample.analyzing']).toBe('AI đang phân tích bài viết…')
  })

  test('the disclaimer uses the em-dash acceptance-contract copy (FD6.2)', () => {
    const record = en as Record<string, string>
    expect(record['grading.ai.disclaimer']).toBe(
      'Suggestion — teacher always decides the final band.',
    )
  })
})

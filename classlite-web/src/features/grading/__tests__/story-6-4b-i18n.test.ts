/**
 * Story 6.4b (AC13 / TEST-FE / R38) — RED-PHASE ATDD scaffold (/bmad-tea AT 6-4b).
 *
 * i18n parity for the Auto-Grading objective-sections FRONTEND. Closed-literal key
 * list + prefix ratchet + interpolation-token parity, asserting BOTH en.json AND
 * vi.json. The list IS the documentation — a new `objectiveGrading.*` key MUST be
 * added here in the same change (mirrors story-6-3c-i18n.test.ts).
 *
 * RED PHASE: none of these `objectiveGrading.*` keys exist in the locale files yet, so
 * `assertI18nParity` fails until Task N adds them to en.json AND vi.json. That is the
 * intended red signal (import-the-contract, keys-missing → fail).
 *
 * GREEN-PHASE SEAMS (Task N):
 *   • Reuse — do NOT re-key — the skill-agnostic grading chrome the objective surface
 *     shares: `grading.error.*` (generic/retry/unsupportedSkill), `grading.release.*`
 *     (confirm/cancel/success/title/description — the reckoning dialog's confirm/cancel/
 *     success toast), `grading.queue.*` (prev/next queue nav), `grading.overall.*`, and
 *     `grading.mobileSeam.*` (the desktop-only seam). None of these belong in the
 *     `objectiveGrading.*` ratchet below; their continued existence is asserted separately.
 *   • The NEW namespace is `objectiveGrading.*` only.
 */
import { describe, expect, test } from 'vitest'

import { assertI18nInterpolationParity, assertI18nParity } from '@/lib/test/i18n-parity'
import en from '@/locales/en.json'
import vi from '@/locales/vi.json'

export const STORY_6_4B_KEYS = [
  // AC16 — objective skill, no autoGrade fall-through (NOT unsupportedSkill).
  'objectiveGrading.autoGradeUnavailable.title',
  'objectiveGrading.autoGradeUnavailable.body',
  'objectiveGrading.autoGradeUnavailable.retry',
  // AC3 — summary band (server numbers, no client math).
  'objectiveGrading.summary.title',
  'objectiveGrading.summary.rawScore', // "{{rawScore}} / {{maxScore}}"
  'objectiveGrading.summary.provisionalBand', // "Provisional band {{band}}"
  'objectiveGrading.summary.afterOverrides',
  // AC4 — needs_review reckoning + resolve nudge.
  'objectiveGrading.summary.needsReviewNote', // "{{count}}"
  'objectiveGrading.summary.resolveNudge', // "{{count}}"
  // AC5/AC6 — per-answer breakdown rows + resolution actions.
  'objectiveGrading.row.studentAnswer',
  'objectiveGrading.row.correctAnswer',
  'objectiveGrading.row.acceptedVariants',
  'objectiveGrading.row.studentFlagged',
  'objectiveGrading.row.edited', // D10 override affordance
  'objectiveGrading.row.acceptCorrect',
  'objectiveGrading.row.markWrong',
  // Result chip — driven by effectiveMark.
  'objectiveGrading.mark.correct',
  'objectiveGrading.mark.wrong',
  'objectiveGrading.mark.needsReview',
  // AC10 — release reckoning dialog.
  'objectiveGrading.release.cta',
  'objectiveGrading.release.dialogTitle',
  'objectiveGrading.release.reckoning', // "{{count}}"
  'objectiveGrading.release.projection', // "{{provisional}} → {{released}}"
  // AC12 — post-release read-only.
  'objectiveGrading.released.badge',
  'objectiveGrading.released.definitiveBand', // "{{band}}"
  // AC9/AC11 — the SIX distinct error codes (discriminate on error.code, not status).
  'objectiveGrading.error.alreadyReleased', // 409 SUBMISSION_ALREADY_RELEASED
  'objectiveGrading.error.notObjective', // 409 SUBMISSION_NOT_OBJECTIVE
  'objectiveGrading.error.autoGradeNotFound', // 409 AUTO_GRADE_NOT_FOUND
  'objectiveGrading.error.invalidQuestionRef', // 422 INVALID_QUESTION_REF
  'objectiveGrading.error.submissionNotFound', // 404 SUBMISSION_NOT_FOUND
] as const

const ALLOWED_PREFIXES_6_4B = ['objectiveGrading.'] as const

// Reused skill-agnostic grading chrome the objective surface shares verbatim (SD — not
// re-keyed). Their continued existence in BOTH locales is a 6.4b regression guard.
const REUSED_GRADING_KEYS = [
  'grading.error.generic',
  'grading.error.retry',
  'grading.error.unsupportedSkill',
  'grading.release.confirm',
  'grading.release.cancel',
  'grading.release.success',
  'grading.release.title',
  'grading.release.description',
  'grading.queue.prev',
  'grading.queue.next',
  'grading.overall.label',
  'grading.mobileSeam.title',
  'grading.mobileSeam.body',
  'grading.mobileSeam.copyLink',
  'grading.mobileSeam.copied',
] as const

function flatten(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return []
  const out: string[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, path))
    else out.push(path)
  }
  return out
}

describe('Story 6.4b i18n parity (R38 / AC13)', () => {
  test('every Story 6.4b objectiveGrading.* key exists in both en.json and vi.json', () => {
    assertI18nParity(STORY_6_4B_KEYS)
  })

  test('interpolation-token parity holds across en / vi for ALL Story 6.4b keys', () => {
    assertI18nInterpolationParity(STORY_6_4B_KEYS)
  })

  test.each(STORY_6_4B_KEYS)('%s belongs to a 6.4b allowed prefix (AC13 ratchet)', (key) => {
    expect(ALLOWED_PREFIXES_6_4B.some((prefix) => key.startsWith(prefix))).toBe(true)
  })

  test('the reused skill-agnostic grading chrome keys still exist in both locales', () => {
    assertI18nParity(REUSED_GRADING_KEYS)
  })

  test('objectiveGrading.* key SET is identical across en.json and vi.json (no orphan translations)', () => {
    const enKeys = flatten(en).filter((k) => k.startsWith('objectiveGrading.')).sort()
    const viKeys = flatten(vi).filter((k) => k.startsWith('objectiveGrading.')).sort()
    expect(enKeys).toEqual(viKeys)
  })
})

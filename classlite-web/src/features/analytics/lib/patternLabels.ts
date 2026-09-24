/**
 * patternLabels — shared label helpers for the student-performance mistake/pattern
 * rows (Story 8-3b). The skill-source-split (D-COFINAL) means the human-readable
 * label is the `questionType` for auto_graded rows and the IELTS `criterion` for
 * human_comment rows. Both the teacher `StudentMistakesList` and the softened
 * student `StudentPatternsList` use these so the criterion/questionType logic never
 * drifts (also the shared `StudentMistakeRow` and the class `MistakePatternRow`).
 */
import type { TFunction } from 'i18next'
import type { components } from '@/lib/api/client'

export type MistakePattern = components['schemas']['MistakePattern']
export type SkillSource = MistakePattern['skillSource']

/** The four skills in a stable display order (filter chips + zones). */
export const SKILL_SOURCES: readonly SkillSource[] = [
  'reading',
  'listening',
  'writing',
  'speaking',
]

const CRITERION_LABEL_KEY: Record<string, string> = {
  taskResponse: 'criterion.taskResponse',
  coherenceCohesion: 'criterion.coherenceCohesion',
  lexicalResource: 'criterion.lexicalResource',
  grammaticalRange: 'criterion.grammaticalRange',
}

/** The IELTS criterion label for human_comment rows; the questionType label for
 *  auto_graded rows. The auto_graded vs human_comment split keys off the
 *  authoritative `patternSource` discriminator — NOT `criterion === ''`, which a
 *  human_comment row with an empty criterion would spuriously match (code-review
 *  2026-09-23 P2). An unknown/absent questionType resolves to the localized
 *  "Other question type" rather than a raw wire token (P1/P7). */
export function patternLabel(t: TFunction, pattern: MistakePattern): string {
  if (pattern.patternSource === 'auto_graded') {
    const qt = pattern.questionType ?? ''
    return t(`analytics.questionType.${qt}`, {
      defaultValue: t('analytics.questionType.other'),
    })
  }
  return t(CRITERION_LABEL_KEY[pattern.criterion] ?? pattern.criterion)
}

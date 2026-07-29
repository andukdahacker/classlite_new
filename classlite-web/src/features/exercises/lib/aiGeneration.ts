/**
 * aiGeneration — Story 4.3b. The client-side shape of an AI generation: the
 * three modes, the section-form chip options, the compose-into-topic seed
 * builder, and the preview summariser.
 *
 * WHY compose-into-topic: 4.3a's enqueue handler strictly decodes params
 * (`DisallowUnknownFields`), so `AIGenerateSectionParams` accepts EXACTLY
 * `{ topic }` — the AC1 section chips (type / band / count / mix) cannot ride as
 * structured fields (they would 422). Ducdo's ratified call (2026-07-28) is to
 * fold them into the single free-text `topic` seed the backend forwards to
 * Gemini, so the chips genuinely shape output with zero backend change. The
 * questions/distractors contracts consume only `count` (+ the id handle), so
 * their forms are count-only (dropped AC1 topic/type/difficulty → FU-4-3-B).
 */
import type {
  ExerciseContent,
  ExerciseSectionType,
  QuestionGroupType,
} from './editorTypes'
import { SECTION_TYPES, isPromptOnlySection } from './sectionTypes'
import { QUESTION_GROUP_TYPES } from './questionTypes'

export type AiGenerationMode = 'section' | 'questions' | 'distractors'

/** Every generation costs one credit (est. shown before confirm — AC1). The
 * authoritative deduction is the server's (4.3a); this is the pre-confirm
 * estimate only. */
export const EST_CREDIT_COST = 1

/** The monthly AI-credit allowance shown in the display-only counter. The live
 * balance + the 402 hard limit are Story 6.5 — this is the denominator only. */
export const MONTHLY_AI_CREDIT_ALLOWANCE = 50

/** Section-type chips align to the editor's five real types (4.2), NOT the
 * mockup's "Vocabulary" chip (deferred). Writing/Speaking are prompt-only. */
export const AI_SECTION_TYPES: readonly ExerciseSectionType[] = SECTION_TYPES

/** Target-band chips (IELTS half-bands). Optional — omitted from the seed when
 * unset. */
export const AI_TARGET_BAND_OPTIONS: readonly number[] = [
  4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8,
]

/** Question-count chips for a section generation (ignored for prompt-only). */
export const AI_SECTION_QUESTION_COUNTS: readonly number[] = [5, 10, 15]

/** Question-mix chips = the editor's five group types (multi-select). */
export const AI_QUESTION_MIX_TYPES: readonly QuestionGroupType[] = QUESTION_GROUP_TYPES

/** Count chips for the standalone questions generation (bounded 1..20 server-side). */
export const AI_QUESTIONS_COUNTS: readonly number[] = [3, 5, 10]

/** Count chips for the distractors generation. */
export const AI_DISTRACTORS_COUNTS: readonly number[] = [3, 4, 5]

/** The section-form field values (RHF). Bands/counts are nullable (chip unset);
 * mix is a possibly-empty multi-select. */
export interface SectionFormValues {
  sectionType: ExerciseSectionType
  topic: string
  targetBand: number | null
  questionCount: number | null
  questionMix: QuestionGroupType[]
}

/**
 * composeSectionTopicSeed — fold the section chips into the single free-text
 * `topic` string the backend forwards to Gemini. Prompt-only sections
 * (writing/speaking) omit the question count/mix and ask the model to draft the
 * prompt text. The seed is English scaffolding around the user's own (any-locale)
 * `topic` free text, which is preserved verbatim.
 */
export function composeSectionTopicSeed(values: SectionFormValues): string {
  const promptOnly = isPromptOnlySection(values.sectionType)
  const parts: string[] = [`${values.sectionType} section`]
  if (values.targetBand !== null) parts.push(`target band ${values.targetBand}`)
  if (promptOnly) {
    parts.push('draft the prompt text only (no question groups)')
  } else {
    if (values.questionCount !== null) parts.push(`${values.questionCount} questions`)
    if (values.questionMix.length > 0) {
      parts.push(`question types: ${values.questionMix.join(', ')}`)
    }
  }
  return `${parts.join(', ')}. Topic/material: ${values.topic.trim()}`
}

/** A preview-summary of a generated fragment (counts + band-agnostic shape). */
export interface FragmentSummary {
  sectionType: ExerciseSectionType | null
  words: number
  groupCount: number
  questionCount: number
  optionCount: number
}

function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return trimmed.split(/\s+/).length
}

/**
 * summarizeFragment — reduce a generated `ExerciseContent` fragment to the
 * counts the preview panel renders. Works for all three modes: section (passage
 * words + groups + questions), questions (groups + questions), distractors
 * (options on the single carrier MCQ question).
 */
export function summarizeFragment(content: ExerciseContent): FragmentSummary {
  const sections = content.sections ?? []
  let words = 0
  let groupCount = 0
  let questionCount = 0
  let optionCount = 0
  for (const section of sections) {
    words += countWords(section.content)
    for (const group of section.questionGroups) {
      groupCount += 1
      for (const question of group.questions) {
        questionCount += 1
        optionCount += question.options.length
      }
    }
  }
  return {
    sectionType: sections[0]?.type ?? null,
    words,
    groupCount,
    questionCount,
    optionCount,
  }
}

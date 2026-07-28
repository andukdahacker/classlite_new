/**
 * editorTypes — the structured-editor working-document shape (Story 4.2).
 *
 * The editor is a DOCUMENT editor (FW-8 exemption), not a validated form, so —
 * unlike TS-2 which forbids deriving RHF form state from generated API types —
 * the working document IS the wire content shape: it is edited in place and
 * full-replace PATCHed. Aliasing the generated `ExerciseContent` here keeps the
 * editor pinned to the api.yaml contract (a schema drift is a compile error).
 */
import type { components } from '@/lib/api/client'

export type ExerciseContent = components['schemas']['ExerciseContent']
export type ExerciseSection = components['schemas']['ExerciseSection']
export type QuestionGroup = components['schemas']['QuestionGroup']
export type ExerciseQuestion = components['schemas']['ExerciseQuestion']
export type ExerciseSettings = components['schemas']['ExerciseSettings']
export type ExerciseSectionType = components['schemas']['ExerciseSectionType']
export type QuestionGroupType = components['schemas']['QuestionGroupType']
export type ExerciseSkill = components['schemas']['ExerciseSkill']

/** The full in-memory editor document — metadata + content blob. Seeded from
 * GET /api/exercises/{id}, full-replace PATCHed by the autosave. */
export interface EditorDocument {
  title: string
  description: string | null
  skill: ExerciseSkill
  tags: string[]
  targetBand: number | null
  content: ExerciseContent
}

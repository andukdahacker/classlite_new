/**
 * sectionTypes — Story 4.2. The five editor section types (AC2 5-set), their
 * i18n label keys, prompt-only flag, and the empty-section factory. Section
 * type is independent of the exercise `skill` (4.1 Dev Note #8).
 */
import type { ExerciseSection, ExerciseSectionType } from './editorTypes'

/** The five section cards in the type picker (AC2). No `vocabulary` (declared
 * in 4.1 but not enabled — server + api.yaml enforce the 5-set, AC7). */
export const SECTION_TYPES: ExerciseSectionType[] = [
  'reading',
  'listening',
  'writing',
  'speaking',
  'grammar',
]

/** Writing/Speaking are prompt-only — no question groups (server-enforced, AC7). */
export function isPromptOnlySection(type: ExerciseSectionType): boolean {
  return type === 'writing' || type === 'speaking'
}

/** Reading/Grammar host a fill-text passage; Listening an audio URL. */
export function isAudioSection(type: ExerciseSectionType): boolean {
  return type === 'listening'
}

export function sectionTypeLabelKey(type: ExerciseSectionType): string {
  return `exercises.editor.sectionType.${type}`
}

/** The skill-palette CSS token for a section's type badge (design-system
 * token, never a raw hex — mirrors exerciseCode.ts). */
export function sectionTypeColor(type: ExerciseSectionType): string {
  return `var(--cl-skill-${type}, var(--cl-skill-general))`
}

export function sectionContentLabelKey(type: ExerciseSectionType): string {
  if (isAudioSection(type)) return 'exercises.editor.section.audioUrlLabel'
  if (isPromptOnlySection(type)) return 'exercises.editor.section.promptLabel'
  return 'exercises.editor.section.passageLabel'
}

/** Empty-section factory — a fresh section of the given type, zero groups. */
export function newSection(type: ExerciseSectionType): ExerciseSection {
  return { type, title: '', content: '', questionGroups: [] }
}

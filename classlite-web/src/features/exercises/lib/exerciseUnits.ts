/**
 * exerciseUnits — Story 4.1 (AC1/AC9). Maps a skill to its count-unit noun key
 * (`exercises.unit.<key>`). The unit is skill-appropriate — never a flat
 * "questions" for every skill: Writing counts PROMPTS, Speaking counts CUE
 * CARDS, everything else counts QUESTIONS. The noun is passed as an ICU param
 * into the compound meta-line message (never concatenated) so Vietnamese can
 * reorder freely.
 */
import type { ExerciseSkill } from '../api/useExercises'

export type UnitKey = 'questions' | 'prompts' | 'cueCards'

export function unitKeyForSkill(skill: ExerciseSkill): UnitKey {
  switch (skill) {
    case 'writing':
      return 'prompts'
    case 'speaking':
      return 'cueCards'
    default:
      // reading, listening, grammar, vocabulary, general
      return 'questions'
  }
}
